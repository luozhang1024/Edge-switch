//! Native account integration, following the protocol references in cc-switch-reference.
//! Credentials stay in Rust/native storage; the renderer receives account metadata only.
use crate::{store, Core};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const PLATFORM: &str = "https://platform.deepseek.com";
const RECORD: &str = "deepseek-account-platform/default";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
static LOGIN_LINKS: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());
struct LoginLink(String);
impl Drop for LoginLink {
    fn drop(&mut self) {
        LOGIN_LINKS
            .lock()
            .unwrap()
            .retain(|(key, _)| key != &self.0);
    }
}
fn pending_link(profile: &str, url: &str) -> LoginLink {
    let mut links = LOGIN_LINKS.lock().unwrap();
    links.retain(|(key, _)| key != profile);
    links.push((profile.into(), url.into()));
    LoginLink(profile.into())
}
#[tauri::command]
pub fn account_login_link(profile_id: String, reopen: bool) -> Result<Value, String> {
    let url = LOGIN_LINKS
        .lock()
        .unwrap()
        .iter()
        .find(|(key, _)| key == &profile_id)
        .map(|(_, url)| url.clone());
    if reopen {
        crate::browser::open(url.as_deref().ok_or("当前没有等待中的浏览器授权")?)?;
    }
    Ok(json!({"url":url}))
}

fn client() -> Result<reqwest::Client, String> {
    crate::network::builder(false, 7890)?
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法创建授权网络连接".into())
}
pub fn dsh_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("DSH_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .or_else(|| std::env::var_os("HOME"))
                .map(|v| PathBuf::from(v).join(".dsh"))
        })
        .ok_or("无法定位本机 DeepSeek Harness 数据目录")?;
    Ok(home.join(".credentials.yaml"))
}
fn document(text: &str) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Ok(json!({"version":1,"refs":{},"records":{}}));
    }
    let value: Value =
        serde_yaml::from_str(text).map_err(|_| "Harness 凭据文件格式无效，原文件已保留")?;
    if value["version"] != 1
        || !value.is_object()
        || (!value["records"].is_null() && !value["records"].is_object())
    {
        return Err("不支持此 Harness 凭据格式，请先在 Harness 中升级".into());
    }
    Ok(value)
}
fn read_native(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(text) => document(&text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => document(""),
        Err(_) => Err("无法读取本机 Harness 凭据".into()),
    }
}
pub fn grant(doc: &Value) -> Result<Option<Value>, String> {
    let record = &doc["records"][RECORD];
    if record.is_null() {
        return Ok(None);
    }
    let payload = &record["payload"];
    if record["kind"] != "grant"
        || payload["version"] != 1
        || !payload["token"]
            .as_str()
            .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| (0x21..=0x7e).contains(&b)))
        || payload["issuer"].as_str().map(|s| s.trim_end_matches('/')) != Some(PLATFORM)
    {
        return Err("DeepSeek 账号凭据无效或 issuer 不是官方平台，请重新登录".into());
    }
    Ok(payload.clone().into())
}
fn merge_grant(doc: &mut Value, payload: Value) {
    if !doc["records"].is_object() {
        doc["records"] = json!({});
    }
    doc["records"][RECORD] = json!({"kind":"grant","payload":payload});
}
struct NativeLock(PathBuf);
impl Drop for NativeLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn native_lock(path: &Path) -> Result<NativeLock, String> {
    fs::create_dir_all(path.parent().ok_or("凭据目录无效")?).map_err(|_| "无法创建凭据目录")?;
    let lock = PathBuf::from(format!("{}.lock", path.display()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|_| "Harness 正在写入凭据，请稍后重试（保留原文件）")?;
    let guard = NativeLock(lock);
    writeln!(file, "{}", std::process::id()).map_err(|_| "无法写入凭据锁")?;
    Ok(guard)
}
fn store_grant(payload: Value) -> Result<(), String> {
    let path = dsh_path()?;
    let _lock = native_lock(&path)?;
    let mut doc = read_native(&path)?;
    merge_grant(&mut doc, payload);
    let text = serde_yaml::to_string(&doc).map_err(|_| "无法保存 Harness 凭据")?;
    store::atomic_write(&path, text.as_bytes())
}
fn identity(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    request
        .header("x-client-platform", "web")
        .header("x-client-bundle-id", "")
        .header("x-client-locale", "zh_CN")
        .header(
            "x-client-timezone-offset",
            chrono::Local::now().offset().local_minus_utc().to_string(),
        )
}
async fn platform_response(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let response = request
        .send()
        .await
        .map_err(|_| "DeepSeek 平台连接失败，请检查本机网络")?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("账号授权已失效，请重新登录".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "DeepSeek 平台返回 HTTP {}",
            response.status().as_u16()
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "DeepSeek 平台响应格式无效")?;
    if value["code"] == 40003 {
        return Err("账号授权已失效，请重新登录".into());
    }
    if value["code"] != 0 || value["data"]["biz_code"].as_i64().is_some_and(|v| v != 0) {
        return Err("DeepSeek 平台未完成请求，请稍后重试".into());
    }
    Ok(value["data"]["biz_data"].clone())
}
fn wallets(value: &Value) -> Value {
    json!(value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| Some(json!({
            "currency":v["currency"].as_str()?, "balance":v["balance"].as_str()?
        })))
        .collect::<Vec<_>>())
}
#[tauri::command]
pub async fn local_harness_account() -> Result<Value, String> {
    let doc = read_native(&dsh_path()?)?;
    let Some(payload) = grant(&doc)? else {
        return Ok(json!({"signed_in":false}));
    };
    let token = payload["token"].as_str().ok_or("账号令牌无效")?;
    let http = client()?;
    let (profile, balance) = tokio::join!(
        platform_response(
            identity(http.get(format!("{PLATFORM}/auth-api/v0/users/current")))
                .header("x-dsh-auth-token", token)
        ),
        platform_response(
            identity(http.get(format!("{PLATFORM}/api/v0/users/get_user_summary")))
                .header("x-dsh-auth-token", token)
        )
    );
    let errors: Vec<_> = [&profile, &balance]
        .into_iter()
        .filter_map(|v| v.as_ref().err().cloned())
        .collect();
    // No raw platform response, grant or token is returned to the webview.
    let p = profile.unwrap_or(Value::Null);
    let b = balance.unwrap_or(Value::Null);
    Ok(
        json!({"signed_in":true,"expired":errors.iter().any(|e| e.contains("失效")),
        "name":p["id_profile"]["name"].as_str(),
        "contact":p["mobile"].as_str().or_else(||p["mobile_number"].as_str()).or_else(||p["email"].as_str()),
        "wallets":wallets(&b["normal_wallets"]),"bonus_wallets":wallets(&b["bonus_wallets"]),
        "error":errors.join("；"),"checked_at":chrono::Utc::now().timestamp()}),
    )
}
fn random() -> String {
    format!("{}{}", store::new_id(), store::new_id())
}
fn callback_code(query: &str, state: &str) -> Option<String> {
    let params: Vec<_> = url::form_urlencoded::parse(query.as_bytes()).collect();
    let states: Vec<_> = params.iter().filter(|(k, _)| k == "state").collect();
    let codes: Vec<_> = params.iter().filter(|(k, _)| k == "code").collect();
    (states.len() == 1
        && states[0].1 == state
        && codes.len() == 1
        && !codes[0].1.is_empty()
        && !params.iter().any(|(k, _)| k == "error"))
    .then(|| codes[0].1.to_string())
}
async fn reply(stream: &mut TcpStream, valid: bool) {
    let body = if valid {
        "Authorization received. Return to Edge Switch to check the result."
    } else {
        "Invalid callback. Return to Edge Switch and try again."
    };
    let status = if valid { "200 OK" } else { "400 Bad Request" };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}
async fn callback(listener: &TcpListener, path: &str, state: &str) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|_| "授权回调连接失败")?;
        let mut bytes = vec![];
        let result = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let mut buf = [0u8; 1024];
                let n = stream
                    .read(&mut buf)
                    .await
                    .map_err(|_| "授权回调读取失败")?;
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&buf[..n]);
                if bytes.len() > 16384 {
                    return Err("授权回调过长");
                }
                if bytes.windows(4).any(|v| v == b"\r\n\r\n") {
                    break;
                }
            }
            Ok(())
        })
        .await;
        if !matches!(result, Ok(Ok(()))) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let request: Vec<_> = text
            .lines()
            .next()
            .unwrap_or("")
            .split_whitespace()
            .collect();
        let code = if request.first() == Some(&"GET") {
            request
                .get(1)
                .and_then(|v| v.split_once('?'))
                .filter(|(p, _)| *p == path)
                .and_then(|(_, q)| callback_code(q, state))
        } else {
            None
        };
        reply(&mut stream, code.is_some()).await;
        if let Some(code) = code {
            return Ok(code);
        }
    }
}
fn open_authorization(url: &str, origin: &str, path: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "授权地址无效")?;
    if parsed.origin().ascii_serialization() != origin
        || parsed.path() != path
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err("平台返回了非预期的授权地址".into());
    }
    #[cfg(windows)]
    {
        crate::browser::open(url)?;
    }
    #[cfg(not(windows))]
    {
        return Err("当前版本仅支持 Windows 浏览器授权".into());
    }
    #[allow(unreachable_code)]
    Ok(())
}
pub async fn chatgpt_browser(core: &Core, profile: &store::Profile) -> Result<Value, String> {
    let listener = TcpListener::bind(("127.0.0.1", 1455))
        .await
        .map_err(|_| "浏览器登录需要本机 1455 端口，请结束其他 Codex 登录，或选择设备码登录")?;
    let state = random();
    let verifier = random();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let redirect = "http://localhost:1455/auth/callback";
    let mut url = url::Url::parse("https://auth.openai.com/oauth/authorize").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("response_type", "code"),
        ("client_id", CLIENT_ID),
        ("redirect_uri", redirect),
        (
            "scope",
            "openid profile email offline_access api.connectors.read api.connectors.invoke",
        ),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", state.as_str()),
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
        ("originator", "codex_cli_rs"),
    ]);
    let _pending = pending_link(&profile.id, url.as_str());
    open_authorization(url.as_str(), "https://auth.openai.com", "/oauth/authorize")?;
    let code = tokio::time::timeout(
        Duration::from_secs(900),
        callback(&listener, "/auth/callback", &state),
    )
    .await
    .map_err(|_| "浏览器登录超时，请重试")??;
    let response = client()?
        .post("https://auth.openai.com/oauth/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("client_id", CLIENT_ID),
            ("redirect_uri", redirect),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "ChatGPT 授权交换失败，请检查本机网络")?;
    if !response.status().is_success() {
        return Err(format!(
            "ChatGPT 授权交换失败（HTTP {}）",
            response.status().as_u16()
        ));
    }
    let tokens: Value = response.json().await.map_err(|_| "ChatGPT 授权响应无效")?;
    for name in ["access_token", "refresh_token", "id_token"] {
        if !tokens[name].as_str().is_some_and(|v| !v.is_empty()) {
            return Err("ChatGPT 未返回完整账号授权".into());
        }
    }
    let id = tokens["id_token"].as_str().unwrap();
    let claims: Value = id
        .split('.')
        .nth(1)
        .and_then(|v| URL_SAFE_NO_PAD.decode(v).ok())
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or(Value::Null);
    let auth = json!({"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{
        "id_token":tokens["id_token"],"access_token":tokens["access_token"],"refresh_token":tokens["refresh_token"],
        "account_id":claims["https://api.openai.com/auth"]["chatgpt_account_id"]},"last_refresh":chrono::Utc::now().to_rfc3339()});
    let encrypted = crate::secrets::protect(&auth.to_string())?;
    let mut live = core.store.lock().unwrap();
    let mut next = live.clone();
    // Bind to the initiating workspace; never apply a late login to another target.
    if store::Store::auth_target(&next.profile(&profile.id)?) != store::Store::auth_target(profile)
    {
        return Err("工作环境已变化，请重新授权".into());
    }
    if !next.data["official"][&profile.id].is_object() {
        next.data["official"][&profile.id] = json!({"name":"OpenAI Official"});
    }
    next.data["official"][&profile.id]["credentials"] = json!(encrypted);
    if profile.is_local() {
        save_local_codex(&auth)?;
    }
    next.save()?;
    *live = next;
    Ok(
        json!({"message":if profile.is_local() {"ChatGPT 浏览器授权成功，已保存到本机 Codex"} else {"ChatGPT 浏览器授权成功，可在模型服务中启用并同步到板卡"}}),
    )
}

fn save_local_codex(auth: &Value) -> Result<(), String> {
    let path = crate::native_sessions::codex_home().join("auth.json");
    let mut auth = auth.clone();
    if let Some(key) = fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v["OPENAI_API_KEY"].as_str().map(str::to_string))
    {
        auth["OPENAI_API_KEY"] = json!(key);
    }
    if path.exists() {
        let backup = path.with_file_name(format!("auth.edge-switch-{}.bak", store::new_id()));
        fs::copy(&path, backup).map_err(|_| "无法备份本机 Codex 凭据，原文件已保留")?;
    }
    store::atomic_write(&path, auth.to_string().as_bytes())
}

pub fn local_codex_status(core: &Core, profile: &store::Profile) -> Result<bool, String> {
    let path = crate::native_sessions::codex_home().join("auth.json");
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "null".into(),
        Err(_) => return Err("无法读取本机 Codex 凭据".into()),
    };
    let auth: Value = serde_json::from_str(&text).map_err(|_| "本机 Codex 凭据格式无效")?;
    let signed_in = auth["tokens"]["access_token"]
        .as_str()
        .is_some_and(|s| !s.is_empty())
        && auth["tokens"]["refresh_token"]
            .as_str()
            .is_some_and(|s| !s.is_empty());
    let mut live = core.store.lock().unwrap();
    let mut next = live.clone();
    if !next.data["official"][&profile.id].is_object() {
        next.data["official"][&profile.id] = json!({"name":"OpenAI Official"});
    }
    next.data["official"][&profile.id]["credentials"] = if signed_in {
        json!(crate::secrets::protect(&text)?)
    } else {
        Value::Null
    };
    next.save()?;
    *live = next;
    Ok(signed_in)
}

#[tauri::command]
pub async fn logout_account(
    state: tauri::State<'_, crate::State>,
    profile_id: String,
    tool: String,
) -> Result<(), String> {
    let core = &state.0;
    let _guard = core.mutation.lock().await;
    if core.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请先取消或完成当前授权任务".into());
    }
    let (p, scope) = {
        let s = core.store.lock().unwrap();
        (s.profile(&profile_id)?, s.scope(&profile_id))
    };
    match tool.as_str() {
        "harness" => {
            let path = dsh_path()?;
            let _lock = native_lock(&path)?;
            let mut doc = read_native(&path)?;
            if let Some(records) = doc["records"].as_object_mut() {
                records.remove(RECORD);
            }
            store::atomic_write(
                &path,
                serde_yaml::to_string(&doc)
                    .map_err(|_| "无法保存退出状态")?
                    .as_bytes(),
            )?;
        }
        "codex" => {
            if p.is_local() {
                let path = crate::native_sessions::codex_home().join("auth.json");
                if path.exists() {
                    let mut auth: Value =
                        serde_json::from_slice(&fs::read(&path).map_err(|_| "无法读取凭据")?)
                            .map_err(|_| "凭据格式无效，已保留原文件")?;
                    if let Some(object) = auth.as_object_mut() {
                        for key in ["tokens", "auth_mode", "last_refresh"] {
                            object.remove(key);
                        }
                    }
                    store::atomic_write(&path, auth.to_string().as_bytes())?;
                }
            } else {
                core.call(&p, &scope, "logout_codex", json!({}), 30).await?;
            }
            let mut s = core.store.lock().unwrap();
            s.data["official"]
                .as_object_mut()
                .unwrap()
                .remove(&profile_id);
            s.save()?;
        }
        _ => return Err("此工具请使用官方终端退出账号".into()),
    }
    Ok(())
}
async fn platform_call(method: &str, value: Value) -> Result<Value, String> {
    platform_response(identity(
        client()?
            .post(format!("{PLATFORM}/auth-api/v0/dsh/{method}"))
            .json(&value),
    ))
    .await
}
struct PendingDeepSeek {
    authorize_id: String,
    verifier: String,
    completed: bool,
}
impl Drop for PendingDeepSeek {
    fn drop(&mut self) {
        if !self.completed {
            let body = json!({"authorize_id":self.authorize_id,"code_verifier":self.verifier});
            tauri::async_runtime::spawn(async move {
                let _ = platform_call("auth_cancel", body).await;
            });
        }
    }
}
pub async fn harness_browser(profile_id: &str) -> Result<Value, String> {
    static LOGIN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _login = LOGIN
        .try_lock()
        .map_err(|_| "已有 DeepSeek 浏览器登录正在进行，请先完成或取消")?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|_| "无法监听本机授权回调")?;
    let redirect = format!(
        "http://127.0.0.1:{}/oauth/callback",
        listener.local_addr().map_err(|_| "回调端口无效")?.port()
    );
    let state = random();
    let verifier = random();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let init = platform_call("auth_init",json!({"code_challenge":challenge,"code_challenge_method":"S256","state":state,"redirect_uri":redirect,"locale":"zh_CN","login_source":"web"})).await?;
    let mut pending = PendingDeepSeek {
        authorize_id: init["authorize_id"]
            .as_str()
            .filter(|v| !v.is_empty())
            .ok_or("DeepSeek 未返回授权 ID")?
            .to_string(),
        verifier: verifier.clone(),
        completed: false,
    };
    let url = init["authorize_url"]
        .as_str()
        .ok_or("DeepSeek 未返回授权地址")?;
    let _pending = pending_link(profile_id, url);
    open_authorization(url, PLATFORM, "/dsh/authorize")?;
    let code = tokio::time::timeout(
        Duration::from_secs(600),
        callback(&listener, "/oauth/callback", &state),
    )
    .await
    .map_err(|_| "DeepSeek 浏览器登录超时，请重试")??;
    let device_id = {
        let path = dsh_path()?;
        let _lock = native_lock(&path)?;
        let mut doc = read_native(&path)?;
        if !doc["records"].is_object() {
            doc["records"] = json!({});
        }
        let key = "deepseek-account-platform/device";
        let id = doc["records"][key]["payload"]["id"]
            .as_str()
            .filter(|v| uuid::Uuid::parse_str(v).is_ok())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        doc["records"][key] = json!({"kind":"grant","payload":{"id":id}});
        store::atomic_write(
            &path,
            serde_yaml::to_string(&doc)
                .map_err(|_| "无法保存设备标识")?
                .as_bytes(),
        )?;
        id
    };
    let value = platform_call("auth_exchange",json!({"code":code,"code_verifier":verifier,"redirect_uri":redirect,"device_id":device_id,"device_model":"win32-x64","os_version":"win32"})).await?;
    let payload = json!({"version":1,"token":value["token"],"issuer":PLATFORM});
    let mut check = json!({"records":{}});
    merge_grant(&mut check, payload.clone());
    grant(&check)?;
    store_grant(payload)?;
    pending.completed = true;
    Ok(json!({"message":"DeepSeek 账号登录成功，已与本机 Harness Web / Desktop 共用"}))
}
pub async fn sync_harness(core: &Core, p: &store::Profile, scope: &str) -> Result<Value, String> {
    let payload =
        grant(&read_native(&dsh_path()?)?)?.ok_or("本机尚未登录 DeepSeek Harness，请先添加账号")?;
    let old = core
        .call(p, scope, "harness_account_read", json!({}), 30)
        .await?;
    let text = old["credentials"]
        .as_str()
        .ok_or("无法读取板卡 Harness 凭据")?;
    let mut doc = document(text)?;
    merge_grant(&mut doc, payload);
    core.call(p,scope,"harness_account_write",json!({"expected_hash":old["hash"],"credentials":serde_yaml::to_string(&doc).map_err(|_| "无法生成 Harness 凭据")?}),30).await?;
    let mut live = core.store.lock().unwrap();
    let mut next = live.clone();
    let mut current = next.profile(&p.id)?;
    if store::Store::auth_target(&current) != store::Store::auth_target(p) {
        return Err("工作环境已变化，请重新同步".into());
    }
    current
        .tool_services
        .insert("harness".into(), "official".into());
    next.save_profile(current)?;
    *live = next;
    Ok(
        json!({"message":"已将 DeepSeek 账号授权同步到当前板卡并启用原生账号通道；打开 Harness 后可选择账号模型"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_login_link_is_removed_when_authorization_is_cancelled() {
        let profile = store::new_id();
        let pending = pending_link(
            &profile,
            "https://auth.openai.com/oauth/authorize?state=test",
        );
        assert!(account_login_link(profile.clone(), false).unwrap()["url"].is_string());
        drop(pending);
        assert!(account_login_link(profile, false).unwrap()["url"].is_null());
    }
    #[tokio::test]
    #[ignore = "Manual read-only check of the current user's native Harness account"]
    async fn installed_harness_account_is_detected() {
        let status = local_harness_account().await.unwrap();
        assert_eq!(status["signed_in"], true);
        assert_ne!(status["expired"], true);
        assert_eq!(status["error"], "");
        assert!(!status.to_string().contains("token"));
        println!(
            "Native Harness account detected; profile available: {}; wallet count: {}",
            status["name"].is_string(),
            status["wallets"].as_array().map_or(0, Vec::len)
        );
    }
    #[test]
    fn callback_rejects_duplicate_or_foreign_state() {
        assert_eq!(
            callback_code("state=abc&code=hello", "abc"),
            Some("hello".into())
        );
        for q in [
            "state=other&code=hello",
            "state=abc&state=abc&code=hello",
            "state=abc&code=a&code=b",
            "state=abc&code=hello&error=denied",
        ] {
            assert!(callback_code(q, "abc").is_none());
        }
    }
    #[test]
    fn native_login_preserves_other_records_and_refs() {
        let mut doc =
            document("version: 1\nrefs: {KEY: untouched}\nrecords: {other: {payload: keep}}\n")
                .unwrap();
        merge_grant(
            &mut doc,
            json!({"version":1,"token":"private","issuer":PLATFORM}),
        );
        assert_eq!(doc["refs"]["KEY"], "untouched");
        assert_eq!(doc["records"]["other"]["payload"], "keep");
        assert!(grant(&doc).unwrap().is_some());
        doc["records"][RECORD]["payload"]["issuer"] = json!("https://example.com");
        assert!(grant(&doc).is_err());
        assert!(document("bad yaml: [").is_err());
    }
    #[test]
    fn native_lock_refuses_concurrent_writes() {
        let root = std::env::temp_dir().join(store::new_id());
        let path = root.join(".credentials.yaml");
        let guard = native_lock(&path).unwrap();
        assert!(native_lock(&path).is_err());
        drop(guard);
        assert!(native_lock(&path).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}
