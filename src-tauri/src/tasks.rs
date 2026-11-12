use crate::{
    store::{self, Profile},
    transport, Core, State,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
pub struct TaskInfo {
    pub id: String,
    pub profile_id: String,
    pub label: String,
    pub state: String,
    pub started_at: u64,
    pub message: String,
    pub result: Value,
}

pub fn progress(app: &tauri::AppHandle, id: &str, message: &str) {
    let state = app.state::<State>();
    if let Some(t) = state
        .0
        .history
        .lock()
        .unwrap()
        .iter_mut()
        .find(|t| t.id == id)
    {
        t.message = message.into();
    }
    let _ = app.emit("task-progress", json!({"id":id,"message":message}));
}
#[tauri::command]
pub async fn start_task(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    profile_id: String,
    action: String,
    payload: Value,
) -> Result<TaskInfo, String> {
    let _mutation = state.0.mutation.lock().await;
    if !payload.is_object() {
        return Err("任务参数必须为对象".into());
    }
    let label = match action.as_str() {
        "diagnose" => "检查设备",
        "versions" => "查询工具版本",
        "install_runtime" => "安装独立 Node.js",
        "install_tool" => "安装工具",
        "reuse_tools" => "接入已有工具",
        "sync_api" => "同步模型服务",
        "api_test" => "测试 API",
        "official_test" => "检查官方账号",
        "setup_ssh" => "配置 SSH 登录",
        "ssh_console" => "打开 SSH 终端",
        "codex" => "打开 Codex",
        "login" => "登录官方账号",
        "login_browser" => "ChatGPT 浏览器登录",
        "harness_login" => "DeepSeek 账号登录",
        "harness_account_sync" => "同步 DeepSeek 账号",
        "auth_status" => "检测官方登录状态",
        "tool_login" => "打开工具官方登录",
        "harness" => "打开 Harness",
        "claude" => "打开 Claude Code",
        "gemini" => "打开 Gemini CLI",
        "opencode" => "打开 OpenCode",
        "harness_stop" => "停止 Harness",
        "proxy_start" => "连接代理",
        "disconnect" => "断开本地连接",
        "vscode" => "打开 VS Code",
        "editor_pin" => "固定编辑器版本",
        "vscode_diagnostics" => "读取连接日志",
        "import_server" => "导入服务端安装包",
        _ => return Err("不支持的任务".into()),
    };
    let (p, scope) = {
        let s = state.0.store.lock().unwrap();
        let p = s.profile(&profile_id)?;
        p.validate()?;
        (p, s.scope(&profile_id))
    };
    let id = store::new_id();
    let (stop, mut cancel) = tokio::sync::watch::channel(false);
    {
        let mut active = state.0.active.lock().unwrap();
        if active.contains_key(&profile_id) {
            return Err("此环境已有任务正在执行".into());
        }
        active.insert(profile_id.clone(), (id.clone(), stop));
    }
    let item = TaskInfo {
        id: id.clone(),
        profile_id: profile_id.clone(),
        label: label.into(),
        state: "等待执行".into(),
        started_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        message: String::new(),
        result: Value::Null,
    };
    {
        let mut h = state.0.history.lock().unwrap();
        if h.len() >= 200 {
            if let Some(i) = h
                .iter()
                .position(|t| ["已完成", "失败", "已取消"].contains(&t.state.as_str()))
            {
                h.remove(i);
            }
        }
        h.push(item.clone());
    }
    let core = state.0.clone();
    tauri::async_runtime::spawn(async move {
        let work = async {
            let _permit = core
                .permits
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| "任务调度器关闭")?;
            if let Some(t) = core.history.lock().unwrap().iter_mut().find(|t| t.id == id) {
                t.state = "运行中".into();
            }
            progress(&app, &id, "任务已开始");
            execute(core.clone(), &app, &id, &p, &scope, &action, payload).await
        };
        let result = tokio::select! {_=cancel.changed()=>Err("任务已取消；远端操作可能尚未结束，请刷新设备核对状态".to_string()),r=work=>r};
        let cancelled = *cancel.borrow();
        let (result, message, ok) = match result {
            Ok(v) => {
                let ok = v.get("ok") != Some(&Value::Bool(false));
                let msg = v["message"]
                    .as_str()
                    .unwrap_or(if ok {
                        "操作已完成"
                    } else {
                        "检查未通过"
                    })
                    .to_string();
                (v, msg, ok)
            }
            Err(e) => (Value::Null, redact(&core, &p, &e), false),
        };
        let message = redact(&core, &p, &message);
        let result = redact_value(&core, &p, result);
        if let Some(t) = core.history.lock().unwrap().iter_mut().find(|t| t.id == id) {
            t.state = if cancelled {
                "已取消"
            } else if ok {
                "已完成"
            } else {
                "失败"
            }
            .into();
            t.message = message.clone();
            t.result = result;
        }
        core.active.lock().unwrap().remove(&profile_id);
        let _ = app.emit(
            "task-finished",
            json!({"id":id,"profile_id":profile_id,"message":message}),
        );
    });
    Ok(item)
}
fn redact(core: &Core, p: &Profile, text: &str) -> String {
    let s = core.store.lock().unwrap();
    let mut result = text.to_string();
    if let Ok(key) = s.key(p) {
        if !key.is_empty() {
            result = result.replace(&key, "[已隐藏]");
        }
    }
    for encrypted in s.data["secrets"]
        .as_object()
        .unwrap()
        .values()
        .filter_map(Value::as_str)
    {
        if let Ok(key) = crate::secrets::unprotect(encrypted) {
            if !key.is_empty() {
                result = result.replace(&key, "[已隐藏]");
            }
        }
    }
    for key in core.volatile_keys.lock().unwrap().values() {
        if !key.is_empty() {
            result = result.replace(key, "[已隐藏]");
        }
    }
    if result.contains("access_token") || result.contains("refresh_token") {
        return "操作未完成，请检查凭据和网络；敏感信息已隐藏".into();
    }
    result
}
fn redact_value(core: &Core, p: &Profile, value: Value) -> Value {
    match value {
        Value::String(s) => json!(redact(core, p, &s)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|v| redact_value(core, p, v))
                .collect(),
        ),
        Value::Object(items) => Value::Object(
            items
                .into_iter()
                .map(|(k, v)| {
                    let hidden = [
                        "key",
                        "token",
                        "access_token",
                        "refresh_token",
                        "auth_json",
                        "credentials",
                    ]
                    .contains(&k.as_str());
                    (
                        k,
                        if hidden {
                            json!("[已隐藏]")
                        } else {
                            redact_value(core, p, v)
                        },
                    )
                })
                .collect(),
        ),
        v => v,
    }
}
#[tauri::command]
pub fn cancel_task(state: tauri::State<'_, State>, task_id: String) -> Result<(), String> {
    let active = state.0.active.lock().unwrap();
    let (_, stop) = active
        .values()
        .find(|(id, _)| *id == task_id)
        .ok_or("任务已结束")?;
    stop.send(true).map_err(|_| "任务已结束".into())
}
fn tool_profile(core: &Core, p: &Profile, tool: &str) -> Result<Profile, String> {
    if tool == "codex" {
        return Ok(p.clone());
    }
    if !store::TOOLS.contains(&tool) {
        return Err("工具无效".into());
    }
    let id = p
        .tool_services
        .get(tool)
        .ok_or("请先为当前工具选择模型服务")?;
    let s = core.store.lock().unwrap();
    let entry = s.data["services"][&p.id]
        .as_array()
        .ok_or("服务列表损坏")?
        .iter()
        .find(|e| e["id"] == *id)
        .ok_or("工具的模型服务不存在")?;
    crate::providers::apply_service(p, entry, tool)
}
async fn configure_tool(
    core: &Core,
    p: &Profile,
    scope: &str,
    tool: &str,
) -> Result<Value, String> {
    if tool == "harness" && p.tool_services.get(tool).is_some_and(|id| id == "official") {
        return crate::accounts::sync_harness(core, p, scope).await;
    }
    if ["claude", "gemini", "opencode"].contains(&tool)
        && p.tool_services.get(tool).is_none_or(|id| id == "official")
    {
        let proxy = core.route(p, tool).await?;
        return core
            .call(
                p,
                scope,
                "configure_tool",
                json!({"tool":tool,"auth_mode":"official","project":p.project,"proxy":proxy}),
                120,
            )
            .await;
    }
    let selected = tool_profile(core, p, tool)?;
    if tool == "codex" {
        return configure(core, &selected, scope, true).await;
    }
    store::validate_tool_protocol(tool, &selected.protocol)?;
    if selected.model.trim().is_empty() {
        return Err("请填写模型 ID".into());
    }
    let mut payload = api(core, &selected).await?;
    payload["tool"] = json!(tool);
    payload["project"] = json!(p.project);
    payload["proxy"] = json!(core.route(p, tool).await?);
    core.call(p, scope, "configure_tool", payload, 120).await
}

pub async fn api(core: &Core, p: &Profile) -> Result<Value, String> {
    if p.codex_auth == "chatgpt" {
        return Ok(json!({"auth_mode":"chatgpt"}));
    }
    let memory = core
        .volatile_keys
        .lock()
        .unwrap()
        .get(&p.active_api)
        .cloned();
    let key = match memory {
        Some(key) => key,
        None => core.store.lock().unwrap().key(p)?,
    };
    Ok(
        json!({"base_url":p.base_url,"model":p.model,"protocol":p.protocol,"key":key,"service_id":p.active_api,"legacy_service":p.active_api==p.id,"reuse":key.is_empty()}),
    )
}
pub async fn configure(core: &Core, p: &Profile, scope: &str, ide: bool) -> Result<Value, String> {
    if p.codex_auth == "api" && (p.protocol != "responses" || p.model.trim().is_empty()) {
        return Err("Codex 需要 Responses 协议和明确的模型 ID".into());
    }
    if p.codex_auth == "chatgpt" {
        import_auth(core, p, scope).await?;
    }
    let mut v = api(core, p).await?;
    v["project"] = json!(p.project);
    v["proxy"] = json!(core.route(p, "codex").await?);
    if ide {
        v["private_server"] = json!(true);
    }
    core.call(
        p,
        scope,
        if ide { "configure_ide" } else { "configure" },
        v,
        100,
    )
    .await
}
async fn import_auth(core: &Core, p: &Profile, scope: &str) -> Result<(), String> {
    let auth = {
        let s = core.store.lock().unwrap();
        s.data["official"][&p.id]["credentials"]
            .as_str()
            .map(crate::secrets::unprotect)
            .transpose()?
    };
    if let Some(auth) = auth {
        core.call(
            p,
            scope,
            "import_official_auth",
            json!({"auth_json":auth}),
            60,
        )
        .await?;
    }
    Ok(())
}
fn remember_auth(
    core: &Core,
    p: &Profile,
    authenticated: bool,
    fresh_login: bool,
) -> Result<(), String> {
    let mut live = core.store.lock().unwrap();
    let mut next = live.clone();
    if !next.data["official"][&p.id].is_object() {
        next.data["official"][&p.id] = json!({"name":"OpenAI Official"});
    }
    let entry = &mut next.data["official"][&p.id];
    entry["remote_authenticated"] = json!(authenticated);
    entry["verified_target"] = store::Store::auth_target(p);
    entry["verified_at"] = json!(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs());
    if fresh_login {
        entry.as_object_mut().unwrap().remove("credentials");
    }
    next.save()?;
    *live = next;
    Ok(())
}
async fn execute(
    core: Arc<Core>,
    app: &tauri::AppHandle,
    id: &str,
    p: &Profile,
    scope: &str,
    action: &str,
    v: Value,
) -> Result<Value, String> {
    if p.is_local() {
        if action == "harness_account_sync" {
            let account = crate::accounts::local_harness_account().await?;
            if account["signed_in"] != true || account["expired"] == true {
                return Err("请先在授权中心登录有效的 DeepSeek 账号".into());
            }
            let mut store = core.store.lock().unwrap();
            let mut current = store.profile(&p.id)?;
            current
                .tool_services
                .insert("harness".into(), "official".into());
            store.save_profile(current)?;
            return Ok(json!({"message":"已选择本机 DeepSeek 账号，工具沿用本机账号配置"}));
        }
        return crate::local::execute(p, action).await;
    }
    match action {
        "login_browser" => crate::accounts::chatgpt_browser(&core, p).await,
        "harness_login" => crate::accounts::harness_browser().await,
        "harness_account_sync" => crate::accounts::sync_harness(&core, p, scope).await,
        "diagnose" => core.call(p, scope, "diagnose", json!({}), 60).await,
        "versions" => crate::editor::versions(p).await,
        "install_runtime" => crate::editor::install_runtime(&core, app, id, p, scope).await,
        "install_tool" => {
            let tool = v["tool"].as_str().ok_or("请选择工具")?;
            if !store::TOOLS.contains(&tool) {
                return Err("工具无效".into());
            }
            let version = v["version"].as_str().ok_or("请选择版本")?;
            progress(app, id, "正在安装，首次可能需要数分钟；成功后才切换版本");
            core.call(
                p,
                scope,
                "install_tool",
                json!({"tool":tool,"version":version,"proxy":core.route(p,tool).await?}),
                1860,
            )
            .await
        }
        "reuse_tools" => {
            let info = core.call(p, scope, "diagnose", json!({}), 60).await?;
            let tools: Vec<_> = store::TOOLS
                .into_iter()
                .filter(|t| {
                    info.get(*t)
                        .is_some_and(|v| !v.is_null() && *v != Value::Bool(false))
                })
                .collect();
            core.call(p, scope, "reuse_tools", json!({"tools":tools}), 100)
                .await
        }
        "sync_api" => configure_tool(&core, p, scope, v["tool"].as_str().unwrap_or("codex")).await,
        "api_test" => {
            let tool = v["tool"].as_str().unwrap_or("codex");
            let selected = if let Some(sid) = v["service_id"].as_str() {
                let s = core.store.lock().unwrap();
                let entry = s.data["services"][&p.id]
                    .as_array()
                    .ok_or("服务列表损坏")?
                    .iter()
                    .find(|e| e["id"] == sid)
                    .ok_or("服务不存在")?;
                crate::providers::apply_service(p, entry, tool)?
            } else {
                tool_profile(&core, p, tool)?
            };
            let mut api = api(&core, &selected).await?;
            api["tool"] = json!(tool);
            if api["key"].as_str().unwrap_or("").is_empty() {
                return Err("请先保存此 API 的密钥".into());
            }
            api["infer"] = json!(v["infer"] == true);
            api["proxy"] = json!(core.route(p, tool).await?);
            core.call(p, scope, "api_test", api, 100).await
        }
        "official_test" => {
            import_auth(&core, p, scope).await?;
            let result = core
                .call(
                    p,
                    scope,
                    "official_test",
                    json!({"infer":v["infer"]==true,"proxy":core.route(p,"codex").await?}),
                    100,
                )
                .await?;
            if let Some(authenticated) = result["authenticated"].as_bool() {
                remember_auth(&core, p, authenticated, false)?;
            }
            Ok(result)
        }
        "auth_status" => {
            let result = core
                .call(p, scope, "codex_auth_status", json!({}), 60)
                .await?;
            let authenticated = result["authenticated"] == true;
            remember_auth(&core, p, authenticated, false)?;
            Ok(
                json!({"authenticated":authenticated,"message":if authenticated {"已确认官方账号登录，可在模型服务中启用"}else{"尚未登录，请完成账号授权"}}),
            )
        }
        "setup_ssh" => setup_ssh(&core, app, id, p, scope).await,
        "tool_login" => {
            let tool = v["tool"]
                .as_str()
                .filter(|t| ["claude", "gemini", "opencode"].contains(t))
                .ok_or("此工具不支持官方终端登录")?;
            let mut official = p.clone();
            official
                .tool_services
                .insert(tool.into(), "official".into());
            configure_tool(&core, &official, scope, tool).await?;
            let args = match tool {
                "claude" => " auth login",
                "opencode" => " auth login",
                _ => "",
            };
            console(
                p,
                Some(format!(
                    "python3 ~/.local/share/edge-ssh-ai/{scope}/run-{tool}.py{args}"
                )),
                false,
            )
            .await?;
            Ok(
                json!({"message":"已打开板卡官方登录终端，请在终端按提示完成授权；打开终端不代表登录已完成"}),
            )
        }
        "ssh_console" => {
            console(p, None, false).await?;
            Ok(json!({"message":"已打开 SSH 终端"}))
        }
        "claude" | "gemini" | "opencode" => {
            configure_tool(&core, p, scope, action).await?;
            let command = format!("python3 ~/.local/share/edge-ssh-ai/{scope}/run-{action}.py");
            console(p, Some(command), false).await?;
            Ok(json!({"message":"已打开板卡工具终端"}))
        }
        "codex" | "login" => {
            if action == "login" {
                let mut login_profile = p.clone();
                login_profile.codex_auth = "chatgpt".into();
                let payload = json!({"auth_mode":"chatgpt","project":p.project,"proxy":core.route(p,"codex").await?});
                core.call(&login_profile, scope, "configure", payload, 100)
                    .await?;
            } else {
                configure(&core, p, scope, false).await?;
            }
            let command = format!(
                "python3 ~/.local/share/edge-ssh-ai/{scope}/run-codex.py{}",
                if action == "login" {
                    " login --device-auth"
                } else {
                    ""
                }
            );
            progress(app, id, "请查看弹出的终端窗口");
            console(p, Some(command), action == "login").await?;
            if action == "login" {
                let authenticated = core
                    .call(p, scope, "codex_auth_status", json!({}), 60)
                    .await?["authenticated"]
                    == true;
                remember_auth(&core, p, authenticated, authenticated)?;
                if !authenticated {
                    return Err("尚未确认官方登录，请检查终端授权结果".into());
                }
            }
            Ok(json!({"message":if action=="login"{"已确认官方账号登录"}else{"已打开 Codex 终端"}}))
        }
        "proxy_start" => {
            let mut p = p.clone();
            p.codex_proxy = Some(true);
            let url = core.route(&p, "codex").await?;
            Ok(json!({"message":format!("代理隧道已连接：{url}")}))
        }
        "disconnect" => {
            for kind in ["harness", "proxy"] {
                let r = core
                    .resources
                    .lock()
                    .await
                    .remove(&format!("{}:{kind}", p.id));
                if let Some(r) = r {
                    r.stop().await;
                }
            }
            core.connections.lock().await.remove(&p.id);
            Ok(json!({"message":"已断开本地连接，板卡后台服务保留"}))
        }
        "harness_stop" => {
            let r = core
                .resources
                .lock()
                .await
                .remove(&format!("{}:harness", p.id));
            if let Some(r) = r {
                r.stop().await;
            }
            core.call(p, scope, "harness_stop", json!({}), 30).await
        }
        "harness" => harness(&core, app, id, p, scope).await,
        "vscode" => crate::editor::open(&core, app, id, p, scope).await,
        "editor_pin" => crate::editor::pin(&core, app, id, v["path"].as_str()).await,
        "vscode_diagnostics" => crate::editor::diagnostics(&core, scope),
        "import_server" => {
            crate::editor::import_server(&core, p, scope, v["path"].as_str().ok_or("请选择安装包")?)
                .await
        }
        _ => Err("未知任务".into()),
    }
}
async fn setup_ssh(
    core: &Core,
    app: &tauri::AppHandle,
    id: &str,
    p: &Profile,
    scope: &str,
) -> Result<Value, String> {
    let dir = core.store.lock().unwrap().directory.join("ssh");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let key = dir.join(format!("id_ed25519_{scope}"));
    if !key.exists() {
        let mut c = transport::command("ssh-keygen");
        c.args([
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            &format!("EdgeAI-{scope}"),
            "-f",
        ])
        .arg(&key);
        transport::output(c, 30).await?;
    }
    let public = std::fs::read_to_string(key.with_extension("pub")).map_err(|e| e.to_string())?;
    if !regex::Regex::new(r"^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?\s*$")
        .unwrap()
        .is_match(&public)
    {
        return Err("SSH 公钥格式无效".into());
    }
    let script=format!("umask 077; mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qxF -- {key} ~/.ssh/authorized_keys || printf '\\n%s\\n' {key} >> ~/.ssh/authorized_keys)",key=transport::quote(public.trim()));
    let mut updated = p.clone();
    updated.identity = key.to_string_lossy().into_owned();
    progress(app, id, "请在终端核验主机指纹并输入板卡密码");
    console(&updated, Some(script), true).await?;
    core.connections.lock().await.remove(&p.id);
    core.call(&updated, scope, "diagnose", json!({}), 60)
        .await?;
    core.store.lock().unwrap().save_profile(updated)?;
    Ok(json!({"message":"SSH 授权已确认"}))
}
async fn harness(
    core: &Arc<Core>,
    app: &tauri::AppHandle,
    id: &str,
    p: &Profile,
    scope: &str,
) -> Result<Value, String> {
    if p.tool_services
        .get("harness")
        .is_some_and(|v| v != "official")
    {
        configure_tool(core, p, scope, "harness").await?;
    }
    let mut info = core
        .call(
            p,
            scope,
            "harness_status",
            json!({"include_token":true}),
            30,
        )
        .await?;
    let route = core.route(p, "harness").await?;
    if info["running"] == true
        && (info["project"] != p.project || info["proxy"].as_str().unwrap_or("") != route)
    {
        return Err(
            "Harness 已在其他工程或网络配置下运行，请先明确停止再启动，避免中断现有任务".into(),
        );
    }
    let key = format!("{}:harness", p.id);
    let old = core.resources.lock().await.remove(&key);
    if let Some(r) = old {
        r.stop().await;
    }
    let local = if info["running"] == true {
        info["local_port"].as_u64().ok_or("后台端口记录无效")? as u16
    } else {
        crate::resources::free_port()?
    };
    if info["running"] != true {
        info=core.call(p,scope,"harness_start",json!({"project":p.project,"proxy":route,"local_port":local,"background":p.harness_background}),60).await?;
    }
    let remote = info["port"].as_u64().ok_or("后台服务端口无效")? as u16;
    let r = crate::resources::Managed::start(
        p.clone(),
        local,
        remote,
        false,
        info["background"].as_bool().unwrap_or(true),
        Some(crate::resources::HarnessIdentity {
            core: Arc::downgrade(core),
            scope: scope.into(),
            pid: info["pid"].as_u64().ok_or("后台进程记录无效")?,
        }),
    )
    .await?;
    core.resources.lock().await.insert(key, r);
    let client = crate::editor::client(false, p.proxy_port)?;
    progress(app, id, "等待 Harness 网页就绪，后台任务会保留");
    for _ in 0..60 {
        let info = core
            .call(
                p,
                scope,
                "harness_status",
                json!({"include_token":true}),
                15,
            )
            .await?;
        if info["running"] != true {
            return Err("Harness 已退出，请检查板卡专属目录中的日志".into());
        }
        if let Some(token) = info["token"].as_str().filter(|s| !s.is_empty()) {
            let url = format!("http://127.0.0.1:{local}/?token={token}");
            if client
                .get(&url)
                .timeout(Duration::from_secs(3))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                open_url(&url)?;
                return Ok(json!({"message":"Harness 网页已就绪，已打开浏览器"}));
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Err("网页未就绪，服务已保留，可稍后重新打开".into())
}
pub async fn console(p: &Profile, remote: Option<String>, wait: bool) -> Result<(), String> {
    let mut c = transport::ssh(p, false);
    #[cfg(windows)]
    c.creation_flags(0x00000010);
    c.kill_on_drop(wait)
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit());
    c.arg("-tt");
    transport::destination(&mut c, p);
    if let Some(r) = remote {
        c.arg(r);
    }
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    if wait {
        let status = tokio::time::timeout(Duration::from_secs(600), child.wait())
            .await
            .map_err(|_| "终端操作等待超时，请核对终端结果")?
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("终端操作未完成，请检查密码、主机指纹或授权结果".into());
        }
    }
    Ok(())
}
fn open_url(url: &str) -> Result<(), String> {
    let u = url::Url::parse(url).map_err(|_| "网页地址无效")?;
    if u.scheme() != "http" || u.host_str() != Some("127.0.0.1") {
        return Err("仅允许打开本地转发网页".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_auth_is_bound_to_target_and_does_not_switch_api() {
        let core = crate::tests::core();
        let profile = {
            let s = core.store.lock().unwrap();
            s.profile(s.data["selected_profile"].as_str().unwrap())
                .unwrap()
        };
        assert!(!core.store.lock().unwrap().official_ready(&profile));
        remember_auth(&core, &profile, true, true).unwrap();
        let s = core.store.lock().unwrap();
        assert!(s.official_ready(&profile));
        assert_eq!(s.profile(&profile.id).unwrap().codex_auth, "api");
        assert_eq!(
            s.snapshot()["official"][&profile.id]["remote_authenticated"],
            true
        );
        let mut changed = profile.clone();
        changed.host = "other-board.local".into();
        assert!(!s.official_ready(&changed));
        let dir = s.directory.clone();
        drop(s);
        assert!(store::Store::load(dir).unwrap().official_ready(&profile));
        remember_auth(&core, &profile, false, false).unwrap();
        assert!(!core.store.lock().unwrap().official_ready(&profile));
    }
    #[test]
    fn task_results_hide_session_keys_and_nested_auth_fields() {
        let core = crate::tests::core();
        let p = {
            let s = core.store.lock().unwrap();
            s.profile(s.data["profiles"][0]["id"].as_str().unwrap())
                .unwrap()
        };
        core.volatile_keys
            .lock()
            .unwrap()
            .insert("test".into(), "session-secret".into());
        let result = redact_value(
            &core,
            &p,
            json!({"message":"failed session-secret","nested":[{"token":"token-value","key":"api-value"}]}),
        );
        let text = result.to_string();
        assert!(!text.contains("session-secret"));
        assert!(!text.contains("token-value"));
        assert!(!text.contains("api-value"));
    }
    #[test]
    fn selected_tool_uses_its_own_service_and_key() {
        let core = crate::tests::core();
        let (p, sid) = {
            let mut s = core.store.lock().unwrap();
            let mut p = s
                .profile(s.data["profiles"][0]["id"].as_str().unwrap())
                .unwrap();
            let sid = store::new_id();
            s.data["services"][&p.id].as_array_mut().unwrap().push(json!({"id":sid,"tool":"harness","base_url":"https://api.openai.com/v1","model":"harness-model","protocol":"chat"}));
            p.tool_services.insert("harness".into(), sid.clone());
            s.save_profile(p.clone()).unwrap();
            (p, sid)
        };
        let selected = tool_profile(&core, &p, "harness").unwrap();
        assert_eq!(selected.active_api, sid);
        assert_eq!(selected.model, "harness-model");
        assert_eq!(selected.protocol, "chat");
        assert_ne!(selected.active_api, p.active_api);
        assert_eq!(tool_profile(&core, &p, "codex").unwrap().model, p.model);
        assert!(tool_profile(&core, &p, "claude").is_err());
        let mut foreign = p.clone();
        foreign.tool_services.insert("claude".into(), sid);
        assert!(tool_profile(&core, &foreign, "claude").is_err());
    }
    #[cfg(windows)]
    #[test]
    fn saved_other_tool_key_is_redacted_without_being_loaded() {
        let core = crate::tests::core();
        let p = {
            let mut s = core.store.lock().unwrap();
            s.data["secrets"][store::new_id()] =
                json!(crate::secrets::protect("other-tool-secret").unwrap());
            s.profile(s.data["profiles"][0]["id"].as_str().unwrap())
                .unwrap()
        };
        assert!(!redact(&core, &p, "failure other-tool-secret").contains("other-tool-secret"));
    }
}
