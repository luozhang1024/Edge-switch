mod editor;
mod ordering;
mod providers;
mod resources;
mod secrets;
mod settings;
mod store;
mod tasks;
mod transport;

use fs2::FileExt;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
};
use store::{Profile, Store};
use tauri::{Emitter, Manager};
use tokio::sync::{watch, Mutex as AsyncMutex, Semaphore};

type RpcSlot = Arc<AsyncMutex<Option<transport::Rpc>>>;
pub struct Core {
    pub(crate) mutation: AsyncMutex<()>,
    pub(crate) store: Mutex<Store>,
    pub(crate) connections: AsyncMutex<HashMap<String, RpcSlot>>,
    pub(crate) resources: AsyncMutex<HashMap<String, resources::Managed>>,
    pub(crate) active: Mutex<HashMap<String, (String, watch::Sender<bool>)>>,
    pub(crate) history: Mutex<Vec<tasks::TaskInfo>>,
    pub(crate) permits: Arc<Semaphore>,
    volatile_keys: Mutex<HashMap<String, String>>,
    _lock: fs::File,
}
pub struct State(Arc<Core>);

impl Core {
    pub(crate) async fn call(
        &self,
        p: &Profile,
        scope: &str,
        action: &str,
        mut payload: Value,
        seconds: u64,
    ) -> Result<Value, String> {
        payload["action"] = json!(action);
        payload["scope"] = json!(scope);
        let slot = {
            let mut map = self.connections.lock().await;
            map.entry(p.id.clone())
                .or_insert_with(|| Arc::new(AsyncMutex::new(None)))
                .clone()
        };
        let mut guard = slot.lock().await;
        // Take ownership so cancellation drops and kills an in-flight SSH process.
        let mut rpc = match guard.take() {
            Some(mut rpc) => {
                if rpc.child_alive() {
                    rpc
                } else {
                    transport::Rpc::connect(p).await?
                }
            }
            None => transport::Rpc::connect(p).await?,
        };
        let result = rpc.call(payload, seconds).await;
        // A failed operation is never replayed; discard the stream to avoid stale replies.
        if result.is_ok() {
            *guard = Some(rpc);
        }
        result
    }
    async fn route(&self, p: &Profile, tool: &str) -> Result<String, String> {
        if !p.uses_proxy(tool) {
            return Ok(String::new());
        }
        let key = format!("{}:proxy", p.id);
        let mut map = self.resources.lock().await;
        if !map.contains_key(&key) {
            let (cache, signature) = {
                let store = self.store.lock().unwrap();
                (
                    store
                        .directory
                        .join("network")
                        .join(format!("{}.json", store.scope(&p.id))),
                    json!([p.host, p.port, p.user, p.identity, p.proxy_port]),
                )
            };
            let saved = fs::read(&cache)
                .ok()
                .and_then(|v| serde_json::from_slice::<Value>(&v).ok());
            let port = saved
                .filter(|s| s["target"] == signature)
                .and_then(|s| s["port"].as_u64())
                .filter(|n| *n <= 65535)
                .unwrap_or(0) as u16;
            let resource =
                resources::Managed::start(p.clone(), p.proxy_port, port, true, true, None).await?;
            let port = resource.status.lock().unwrap().remote_port;
            store::atomic_write(
                &cache,
                json!({"target":signature,"port":port})
                    .to_string()
                    .as_bytes(),
            )?;
            map.insert(key.clone(), resource);
        }
        let status = map[&key].status.lock().unwrap().clone();
        if status.state != "已连接" {
            return Err("代理尚未恢复，请稍后重试".into());
        }
        Ok(format!("http://127.0.0.1:{}", status.remote_port))
    }
}

#[tauri::command]
fn snapshot(state: tauri::State<'_, State>) -> Value {
    let mut value = state.0.store.lock().unwrap().snapshot();
    value["tasks"] = json!(*state.0.history.lock().unwrap());
    value
}

#[tauri::command]
async fn connection_status(state: tauri::State<'_, State>) -> Result<Value, String> {
    let map = state.0.resources.lock().await;
    Ok(json!(map
        .iter()
        .map(|(key, r)| (key.clone(), r.status.lock().unwrap().clone()))
        .collect::<HashMap<_, _>>()))
}

#[tauri::command]
async fn save_profile(state: tauri::State<'_, State>, profile: Profile) -> Result<Value, String> {
    let _mutation = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&profile.id) {
        return Err("请等待此环境任务结束再编辑".into());
    }
    if state
        .0
        .resources
        .lock()
        .await
        .keys()
        .any(|k| k.starts_with(&format!("{}:", profile.id)))
    {
        return Err("请先断开此环境代理和网页连接再编辑".into());
    }
    state.0.connections.lock().await.remove(&profile.id);
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut store = core.store.lock().unwrap();
        store.save_profile(profile)?;
        Ok(store.snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn select_profile(state: tauri::State<'_, State>, id: String) -> Result<(), String> {
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut store = core.store.lock().unwrap();
        store.profile(&id)?;
        store.data["selected_profile"] = json!(id);
        store.save()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_profile(state: tauri::State<'_, State>, id: String) -> Result<Value, String> {
    let _mutation = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&id) {
        return Err("此环境任务进行中".into());
    }
    if state
        .0
        .resources
        .lock()
        .await
        .keys()
        .any(|k| k.starts_with(&format!("{id}:")))
    {
        return Err("请先断开此环境所有连接".into());
    }
    state.0.connections.lock().await.remove(&id);
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut live = core.store.lock().unwrap();
        let mut s = live.clone();
        s.profile(&id)?;
        if s.data["profiles"].as_array().unwrap().len() <= 1 {
            return Err("至少保留一个工作环境".into());
        }
        let service_ids: Vec<String> = s.data["services"][&id]
            .as_array()
            .map(|v| {
                v.iter()
                    .filter_map(|x| x["id"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        for sid in &service_ids {
            s.data["secrets"].as_object_mut().unwrap().remove(sid);
        }
        s.data["profiles"]
            .as_array_mut()
            .unwrap()
            .retain(|p| p["id"] != id);
        for field in ["services", "official", "applied"] {
            s.data[field].as_object_mut().unwrap().remove(&id);
        }
        if s.data["selected_profile"] == id {
            s.data["selected_profile"] = s.data["profiles"][0]["id"].clone();
        }
        s.save()?;
        for sid in service_ids {
            core.volatile_keys.lock().unwrap().remove(&sid);
        }
        *live = s;
        Ok(live.snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_service(
    state: tauri::State<'_, State>,
    profile_id: String,
    entry: Value,
    key: Option<String>,
    remember: bool,
) -> Result<Value, String> {
    let _mutation = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请等待此环境任务结束".into());
    }
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || save_service_inner(&core, profile_id, entry, key, remember))
        .await
        .map_err(|e| e.to_string())?
}
fn save_service_inner(
    core: &Core,
    profile_id: String,
    entry: Value,
    key: Option<String>,
    remember: bool,
) -> Result<Value, String> {
    let mut live = core.store.lock().unwrap();
    let mut s = live.clone();
    let mut profile = s.profile(&profile_id)?;
    let id = entry["id"].as_str().ok_or("服务 ID 无效")?;
    if !store::valid_id(id) || entry["name"].as_str().unwrap_or("").trim().is_empty() {
        return Err("服务 ID 或名称无效".into());
    }
    store::validate_url(entry["base_url"].as_str().unwrap_or(""))?;
    let tool = entry["tool"].as_str().unwrap_or("codex");
    let protocol = entry["protocol"].as_str().unwrap_or("");
    // Legacy chat records remain editable; activation still enforces Codex Responses.
    if !(tool == "codex" && protocol == "chat") {
        store::validate_tool_protocol(tool, protocol)?;
    }
    let provider = entry["provider"].as_str().unwrap_or("custom");
    let scope = entry["scope"].as_str().unwrap_or("cli");
    if !["cli", "universal"].contains(&scope) {
        return Err("供应商范围无效".into());
    }
    providers::validate_icon(entry["icon"].as_str().unwrap_or(""))?;
    if !["openai", "deepseek", "anthropic", "google", "custom"].contains(&provider) {
        return Err("供应商无效".into());
    }
    if s.data["services"][&profile_id]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["id"] == id && e["tool"].as_str().unwrap_or("codex") != tool)
    {
        return Err("不能更改已有服务所属工具，请在目标工具下添加服务".into());
    }
    if s.data["services"]
        .as_object()
        .unwrap()
        .iter()
        .any(|(pid, list)| {
            pid != &profile_id
                && list
                    .as_array()
                    .is_some_and(|entries| entries.iter().any(|e| e["id"] == id))
        })
    {
        return Err("服务 ID 已被其他环境使用".into());
    }
    if key.as_deref().is_none_or(str::is_empty)
        && s.data["services"][&profile_id]
            .as_array()
            .unwrap()
            .iter()
            .any(|old| old["id"] == id && old["base_url"] != entry["base_url"])
    {
        return Err("API 地址已更改，请重新填写该地址对应的 API Key".into());
    }
    let effective_key = match key.filter(|v| !v.is_empty()) {
        Some(key) => Some(key),
        None => match core.volatile_keys.lock().unwrap().get(id).cloned() {
            Some(key) => Some(key),
            None => s.data["secrets"][id]
                .as_str()
                .map(secrets::unprotect)
                .transpose()?,
        },
    };
    let encrypted = if remember {
        effective_key.as_deref().map(secrets::protect).transpose()?
    } else {
        None
    };
    let clean = json!({"id":id,"name":entry["name"],"base_url":entry["base_url"],"model":entry["model"],"protocol":entry["protocol"],"tool":tool,"provider":provider,"scope":scope,"icon":entry["icon"].as_str().unwrap_or(""),"preset":entry["preset"].as_str().unwrap_or("custom")});
    let entries = s.data["services"][&profile_id]
        .as_array_mut()
        .ok_or("服务列表损坏")?;
    if let Some(old) = entries.iter_mut().find(|e| e["id"] == id) {
        *old = clean;
    } else {
        entries.push(clean);
    }
    if let Some(encrypted) = encrypted {
        s.data["secrets"][id] = json!(encrypted);
    } else {
        s.data["secrets"].as_object_mut().unwrap().remove(id);
    }
    if profile.active_api == id {
        profile.base_url = entry["base_url"].as_str().unwrap_or("").into();
        profile.model = entry["model"].as_str().unwrap_or("").into();
        profile.protocol = if scope == "universal" {
            "responses"
        } else {
            entry["protocol"].as_str().unwrap_or("responses")
        }
        .into();
        s.save_profile(profile)?;
    } else {
        s.data["applied"]
            .as_object_mut()
            .unwrap()
            .remove(&profile_id);
        s.save()?;
    }
    if let Some(key) = effective_key {
        core.volatile_keys.lock().unwrap().insert(id.into(), key);
    }
    *live = s;
    Ok(live.snapshot())
}

#[tauri::command]
async fn activate_service(
    state: tauri::State<'_, State>,
    profile_id: String,
    service_id: String,
    tool: Option<String>,
) -> Result<Value, String> {
    let _mutation = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请等待此环境任务结束".into());
    }
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut live = core.store.lock().unwrap();
        let mut s = live.clone();
        let mut p = s.profile(&profile_id)?;
        let tool = tool.as_deref().unwrap_or("codex");
        if !store::TOOLS.contains(&tool) {
            return Err("工具无效".into());
        }
        if service_id == "official" {
            if ["claude", "gemini", "opencode"].contains(&tool) {
                p.tool_services.insert(tool.into(), "official".into());
            } else if tool == "codex" {
                if !s.official_ready(&p) {
                    return Err("请先在设置 → 认证中登录官方账号或导入凭据".into());
                }
                p.codex_auth = "chatgpt".into();
            } else {
                return Err("此工具需要配置 API".into());
            }
        } else {
            let entry = s.data["services"][&profile_id]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["id"] == service_id)
                .ok_or("服务不存在")?;
            let selected = providers::apply_service(&p, entry, tool)?;
            if tool != "codex" {
                p.tool_services.insert(tool.into(), service_id);
                s.save_profile(p)?;
                *live = s;
                return Ok(live.snapshot());
            }
            p = selected;
        }
        s.save_profile(p)?;
        *live = s;
        Ok(live.snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_service(
    state: tauri::State<'_, State>,
    profile_id: String,
    service_id: String,
) -> Result<Value, String> {
    let _mutation = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请等待此环境任务结束".into());
    }
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || delete_service_inner(&core, profile_id, service_id))
        .await
        .map_err(|e| e.to_string())?
}
fn delete_service_inner(
    core: &Core,
    profile_id: String,
    service_id: String,
) -> Result<Value, String> {
    let mut live = core.store.lock().unwrap();
    let mut s = live.clone();
    let mut p = s.profile(&profile_id)?;
    let entries = s.data["services"][&profile_id]
        .as_array_mut()
        .ok_or("服务列表损坏")?;
    if !entries.iter().any(|e| e["id"] == service_id) {
        return Err("服务不存在或不属于此环境".into());
    }
    entries.retain(|e| e["id"] != service_id);
    s.data["secrets"]
        .as_object_mut()
        .unwrap()
        .remove(&service_id);
    p.tool_services.retain(|_, id| id != &service_id);
    if p.active_api == service_id {
        p.active_api = String::new();
        p.model = String::new();
        s.save_profile(p)?;
    } else {
        s.save_profile(p)?;
    }
    core.volatile_keys.lock().unwrap().remove(&service_id);
    *live = s;
    Ok(live.snapshot())
}

#[tauri::command]
async fn save_official(
    state: tauri::State<'_, State>,
    profile_id: String,
    name: String,
    note: String,
    path: Option<String>,
    icon: Option<String>,
) -> Result<Value, String> {
    let _mutation = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请等待此环境任务结束".into());
    }
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || {
        if let Some(ref icon) = icon {
            providers::validate_icon(icon)?;
        }
        if name.trim().is_empty() {
            return Err("请填写账号名称".into());
        }
        let credentials = if let Some(path) = path.filter(|s| !s.is_empty()) {
            let meta = fs::metadata(&path).map_err(|_| "无法读取凭据文件")?;
            if !meta.is_file() || meta.len() > 256 * 1024 {
                return Err("auth.json 必须为不超过 256 KB 的文件".into());
            }
            let text = fs::read_to_string(&path).map_err(|_| "凭据文件编码无效")?;
            let auth: Value = serde_json::from_str(&text).map_err(|_| "auth.json 格式无效")?;
            if auth["tokens"]["access_token"]
                .as_str()
                .unwrap_or("")
                .trim()
                .is_empty()
                || auth.get("OPENAI_API_KEY").is_some_and(|v| !v.is_null())
                || auth.get("auth_mode").is_some_and(|v| v != "chatgpt")
            {
                return Err("只接受含 tokens.access_token 的官方 OAuth auth.json".into());
            }
            Some(secrets::protect(&text)?)
        } else {
            None
        };
        let mut live = core.store.lock().unwrap();
        let mut s = live.clone();
        s.profile(&profile_id)?;
        if !s.data["official"][&profile_id].is_object() {
            s.data["official"][&profile_id] = json!({});
        }
        s.data["official"][&profile_id]["name"] = json!(name.trim());
        s.data["official"][&profile_id]["note"] = json!(note);
        if let Some(icon) = icon {
            s.data["official"][&profile_id]["icon"] = json!(icon);
        }
        if let Some(credentials) = credentials {
            s.data["official"][&profile_id]["credentials"] = json!(credentials);
        }
        s.save()?;
        *live = s;
        Ok(live.snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_official(
    state: tauri::State<'_, State>,
    profile_id: String,
) -> Result<Value, String> {
    let _mutation = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请等待此环境任务结束".into());
    }
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut live = core.store.lock().unwrap();
        let mut s = live.clone();
        s.profile(&profile_id)?;
        s.data["official"]
            .as_object_mut()
            .unwrap()
            .remove(&profile_id);
        s.save()?;
        *live = s;
        Ok(live.snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle, state: tauri::State<'_, State>) -> Result<(), String> {
    shutdown(app, state.0.clone()).await
}

async fn shutdown(app: tauri::AppHandle, core: Arc<Core>) -> Result<(), String> {
    let _mutation = core.mutation.lock().await;
    if !core.active.lock().unwrap().is_empty() {
        return Err("任务进行中，请等待完成或取消后退出".into());
    }
    let foreground: Vec<String> = {
        let map = core.resources.lock().await;
        map.iter()
            .filter(|(_, r)| {
                let status = r.status.lock().unwrap();
                status.kind == "harness" && !status.background
            })
            .map(|(key, _)| key.split(':').next().unwrap().to_string())
            .collect()
    };
    for id in foreground {
        let (p, scope) = {
            let s = core.store.lock().unwrap();
            (s.profile(&id)?, s.scope(&id))
        };
        core.call(&p, &scope, "harness_stop", json!({}), 30).await?;
    }
    let resources = std::mem::take(&mut *core.resources.lock().await);
    for (_, resource) in resources {
        resource.stop().await;
    }
    core.connections.lock().await.clear();
    app.exit(0);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let directory = std::env::var_os("LOCALAPPDATA")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_local_data_dir()?)
                .join("EdgeSSHAI");
            fs::create_dir_all(&directory)?;
            let lock = fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(directory.join("workbench.lock"))?;
            lock.try_lock_exclusive()
                .map_err(|_| "旧版或另一个工作台正在运行，请先从托盘退出")?;
            let core = Arc::new(Core {
                mutation: Default::default(),
                store: Mutex::new(Store::load(directory).map_err(std::io::Error::other)?),
                connections: Default::default(),
                resources: Default::default(),
                active: Default::default(),
                history: Default::default(),
                volatile_keys: Default::default(),
                permits: Arc::new(Semaphore::new(4)),
                _lock: lock,
            });
            app.manage(State(core));
            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
            };
            let show = MenuItem::with_id(app, "show", "打开工作台", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../../image/EdgeAI.ico"
                ))?)
                .tooltip("Edge Switch")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "show" {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    } else if event.id.as_ref() == "quit" {
                        let app = app.clone();
                        let core = app.state::<State>().0.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = shutdown(app.clone(), core).await {
                                if let Some(w) = app.get_webview_window("main") {
                                    let _ = w.show();
                                }
                                let _ = app.emit("app-error", error);
                            }
                        });
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings::save_preferences,
            settings::check_update,
            settings::open_release_page,
            settings::open_project_page,
            ordering::reorder_items,
            snapshot,
            connection_status,
            save_profile,
            select_profile,
            delete_profile,
            save_service,
            activate_service,
            delete_service,
            providers::get_service_key,
            providers::duplicate_service,
            providers::fetch_models,
            save_official,
            delete_official,
            tasks::start_task,
            tasks::cancel_task,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("Edge Switch 启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(crate) fn core() -> Core {
        let dir = std::env::temp_dir().join(store::new_id());
        fs::create_dir_all(&dir).unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(dir.join("lock"))
            .unwrap();
        Core {
            mutation: Default::default(),
            store: Mutex::new(Store::load(dir).unwrap()),
            connections: Default::default(),
            resources: Default::default(),
            active: Default::default(),
            history: Default::default(),
            permits: Arc::new(Semaphore::new(4)),
            volatile_keys: Default::default(),
            _lock: lock,
        }
    }
    #[test]
    fn service_edits_update_active_profile_and_preserve_session_key() {
        let core = core();
        let pid = core.store.lock().unwrap().data["profiles"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let sid = store::new_id();
        let entry = json!({"id":sid,"name":"test","base_url":"https://example.com/v1","model":"first","protocol":"responses"});
        save_service_inner(
            &core,
            pid.clone(),
            entry.clone(),
            Some("session-secret".into()),
            false,
        )
        .unwrap();
        {
            let mut s = core.store.lock().unwrap();
            let mut p = s.profile(&pid).unwrap();
            p.active_api = sid.clone();
            s.save_profile(p).unwrap();
        }
        let mut changed = entry;
        changed["model"] = json!("second");
        save_service_inner(&core, pid.clone(), changed, None, false).unwrap();
        assert_eq!(
            core.store.lock().unwrap().profile(&pid).unwrap().model,
            "second"
        );
        assert_eq!(core.volatile_keys.lock().unwrap()[&sid], "session-secret");
        assert!(core.store.lock().unwrap().data["secrets"]
            .get(&sid)
            .is_none());
        delete_service_inner(&core, pid.clone(), sid.clone()).unwrap();
        assert!(!core.volatile_keys.lock().unwrap().contains_key(&sid));
        assert!(core
            .store
            .lock()
            .unwrap()
            .profile(&pid)
            .unwrap()
            .active_api
            .is_empty());
    }
    #[test]
    fn deleting_foreign_service_cannot_clear_its_key() {
        let core = core();
        let pid = core.store.lock().unwrap().data["profiles"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let sid = store::new_id();
        core.volatile_keys
            .lock()
            .unwrap()
            .insert(sid.clone(), "keep".into());
        assert!(delete_service_inner(&core, pid, sid.clone()).is_err());
        assert_eq!(core.volatile_keys.lock().unwrap()[&sid], "keep");
    }
    #[cfg(windows)]
    #[test]
    fn universal_metadata_and_masked_credentials_survive_reload() {
        let core = core();
        let pid = core.store.lock().unwrap().data["profiles"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let sid = store::new_id();
        let icon = format!("data:image/png;base64,{}", {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\n")
        });
        let entry = json!({"id":sid,"tool":"codex","scope":"universal","preset":"newapi","icon":icon,"provider":"custom","name":"New API","base_url":"https://newapi.example/v1","model":"model","protocol":"responses"});
        save_service_inner(
            &core,
            pid.clone(),
            entry,
            Some("saved-test-key".into()),
            true,
        )
        .unwrap();
        core.volatile_keys.lock().unwrap().clear();
        assert_eq!(
            providers::service_key(&core, &pid, &sid).unwrap(),
            "saved-test-key"
        );
        let other = store::Profile::default();
        core.store
            .lock()
            .unwrap()
            .save_profile(other.clone())
            .unwrap();
        assert!(providers::service_key(&core, &other.id, &sid).is_err());
        let s = core.store.lock().unwrap();
        let loaded = Store::load(s.directory.clone()).unwrap();
        let record = loaded.data["services"][&pid]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == sid)
            .unwrap();
        assert_eq!(record["scope"], "universal");
        assert_eq!(record["icon"], icon);
        assert!(!loaded.snapshot().to_string().contains("saved-test-key"));
        let claude =
            providers::apply_service(&loaded.profile(&pid).unwrap(), record, "claude").unwrap();
        assert_eq!(claude.base_url, "https://newapi.example");
        assert_eq!(claude.protocol, "anthropic");
    }
    #[cfg(windows)]
    #[test]
    fn encrypted_key_can_be_switched_to_session_only_and_back() {
        let core = core();
        let pid = core.store.lock().unwrap().data["profiles"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let sid = store::new_id();
        let entry = json!({"id":sid,"name":"test","base_url":"https://example.com/v1","model":"model","protocol":"responses"});
        save_service_inner(
            &core,
            pid.clone(),
            entry.clone(),
            Some("secret-value".into()),
            true,
        )
        .unwrap();
        core.volatile_keys.lock().unwrap().clear();
        save_service_inner(&core, pid.clone(), entry.clone(), None, false).unwrap();
        assert_eq!(core.volatile_keys.lock().unwrap()[&sid], "secret-value");
        assert!(core.store.lock().unwrap().data["secrets"]
            .get(&sid)
            .is_none());
        save_service_inner(&core, pid, entry, None, true).unwrap();
        assert_eq!(
            secrets::unprotect(
                core.store.lock().unwrap().data["secrets"][&sid]
                    .as_str()
                    .unwrap()
            )
            .unwrap(),
            "secret-value"
        );
    }
    #[cfg(windows)]
    #[test]
    fn native_lock_conflicts_with_legacy_msvcrt_lock() {
        let dir = std::env::temp_dir().join(store::new_id());
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("workbench.lock");
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        lock.try_lock_exclusive().unwrap();
        let code="import sys,msvcrt; f=open(sys.argv[1],'a+b'); f.seek(0)\ntry: msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)\nexcept OSError: sys.exit(0)\nsys.exit(9)";
        let status = std::process::Command::new("python")
            .args(["-c", code])
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success());
        drop(lock);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn tool_metadata_and_active_bindings_survive_reload_and_delete() {
        let core = core();
        let (pid, codex) = {
            let s = core.store.lock().unwrap();
            let pid = s.data["profiles"][0]["id"].as_str().unwrap().to_string();
            let p = s.profile(&pid).unwrap();
            (pid, p.active_api)
        };
        let sid = store::new_id();
        let entry = json!({"id":sid,"tool":"harness","provider":"openai","name":"Harness OpenAI","base_url":"https://api.openai.com/v1","model":"test-model","protocol":"responses"});
        save_service_inner(
            &core,
            pid.clone(),
            entry.clone(),
            Some("private".into()),
            false,
        )
        .unwrap();
        {
            let mut s = core.store.lock().unwrap();
            let mut p = s.profile(&pid).unwrap();
            p.tool_services.insert("harness".into(), sid.clone());
            s.save_profile(p).unwrap();
            let loaded = store::Store::load(s.directory.clone()).unwrap();
            assert_eq!(loaded.profile(&pid).unwrap().tool_services["harness"], sid);
            assert_eq!(
                loaded.data["services"][&pid]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|e| e["id"] == sid)
                    .unwrap()["provider"],
                "openai"
            );
        }
        let mut invalid = entry.clone();
        invalid["tool"] = json!("claude");
        assert!(save_service_inner(&core, pid.clone(), invalid, None, false).is_err());
        let mut new_url = entry;
        new_url["base_url"] = json!("https://different.example/v1");
        assert!(save_service_inner(&core, pid.clone(), new_url, None, false).is_err());
        delete_service_inner(&core, pid.clone(), sid.clone()).unwrap();
        let s = core.store.lock().unwrap();
        let p = s.profile(&pid).unwrap();
        assert!(!p.tool_services.contains_key("harness"));
        assert_eq!(p.active_api, codex);
        assert!(!core.volatile_keys.lock().unwrap().contains_key(&sid));
    }
}
