//! Model API routing, isolated from the download/network proxy.
use crate::{providers, store, Core, State};
use axum::{
    body::{Body, Bytes},
    extract::{Path, State as WebState},
    http::{HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub const TOOLS: [&str; 4] = ["claude", "codex", "gemini", "grok"];
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Policy {
    pub queue: Vec<String>,
    pub retries: u32,
    pub failure_threshold: u32,
    pub first_timeout: u64,
    pub idle_timeout: u64,
    pub request_timeout: u64,
    pub recovery_successes: u32,
    pub recovery_wait: u64,
    pub error_percent: u32,
    pub min_requests: u32,
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            queue: vec![],
            retries: 3,
            failure_threshold: 4,
            first_timeout: 60,
            idle_timeout: 120,
            request_timeout: 600,
            recovery_successes: 2,
            recovery_wait: 60,
            error_percent: 60,
            min_requests: 10,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Rectifier {
    pub enabled: bool,
    pub signature: bool,
    pub budget: bool,
    pub image: bool,
    pub heuristic: bool,
    pub optimizer: bool,
    pub thinking: bool,
    pub cache: bool,
}
impl Default for Rectifier {
    fn default() -> Self {
        Self {
            enabled: true,
            signature: true,
            budget: true,
            image: true,
            heuristic: true,
            optimizer: false,
            thinking: true,
            cache: true,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub connect_host: String,
    pub record_usage: bool,
    pub tools: HashMap<String, Policy>,
    pub rectifier: Rectifier,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".into(),
            port: 15721,
            connect_host: String::new(),
            record_usage: true,
            tools: TOOLS
                .iter()
                .map(|t| (t.to_string(), Policy::default()))
                .collect(),
            rectifier: Rectifier::default(),
        }
    }
}
#[derive(Default)]
struct Circuit {
    failures: u32,
    total: u32,
    errors: u32,
    successes: u32,
    opened: Option<Instant>,
    probing: bool,
}
struct ProbeLease {
    core: Arc<Core>,
    key: String,
}
impl Drop for ProbeLease {
    fn drop(&mut self) {
        if let Some(c) = self
            .core
            .routing
            .circuits
            .lock()
            .unwrap()
            .get_mut(&self.key)
        {
            c.probing = false;
        }
    }
}
struct UsageRecord {
    core: Arc<Core>,
    pid: String,
    bytes: u64,
    ok: bool,
    enabled: bool,
}
impl Drop for UsageRecord {
    fn drop(&mut self) {
        if !self.enabled {
            return;
        }
        let mut usage = self.core.routing.usage.lock().unwrap();
        let u = usage
            .entry(self.pid.clone())
            .or_insert(json!({"requests":0,"bytes":0,"failures":0}));
        u["requests"] = json!(u["requests"].as_u64().unwrap_or(0) + 1);
        u["bytes"] = json!(u["bytes"].as_u64().unwrap_or(0) + self.bytes);
        u["failures"] = json!(u["failures"].as_u64().unwrap_or(0) + u64::from(!self.ok));
    }
}
impl Circuit {
    fn admit(&mut self, p: &Policy) -> bool {
        if let Some(at) = self.opened {
            if at.elapsed().as_secs() < p.recovery_wait || self.probing {
                return false;
            }
            self.probing = true;
        }
        true
    }
    fn record(&mut self, ok: bool, p: &Policy) {
        self.probing = false;
        self.total += 1;
        if ok {
            self.failures = 0;
            if self.opened.is_some() {
                self.successes += 1;
                if self.successes >= p.recovery_successes {
                    *self = Self::default();
                }
            }
        } else {
            self.failures += 1;
            self.errors += 1;
            self.successes = 0;
            if self.opened.is_some()
                || self.failures >= p.failure_threshold
                || (self.total >= p.min_requests
                    && self.errors as u64 * 100 >= self.total as u64 * p.error_percent as u64)
            {
                self.opened = Some(Instant::now());
            }
        }
        // Bound the statistical window, retaining consecutive failure state.
        if self.total >= 1000.max(p.min_requests) {
            self.total = 0;
            self.errors = 0;
        }
    }
}
pub struct Running {
    join: tokio::task::JoinHandle<()>,
    pub port: u16,
    pub token: String,
}
impl Drop for Running {
    fn drop(&mut self) {
        self.join.abort();
    }
}
#[derive(Default)]
pub struct Runtime {
    pub servers: tokio::sync::Mutex<HashMap<String, Running>>,
    circuits: Mutex<HashMap<String, Circuit>>,
    usage: Mutex<HashMap<String, Value>>,
}
fn config(core: &Core, pid: &str) -> Result<Config, String> {
    let s = core.store.lock().unwrap();
    s.profile(pid)?;
    match s.data["routing"][pid].clone() {
        Value::Null => Ok(Config::default()),
        v => serde_json::from_value(v).map_err(|_| "路由配置损坏".into()),
    }
}
fn validate(core: &Core, pid: &str, c: &Config) -> Result<(), String> {
    let ip: std::net::IpAddr = c.host.parse().map_err(|_| "监听地址必须为 IP 地址")?;
    if !(ip.is_loopback() || ip.is_unspecified()) || c.port < 1024 {
        return Err("请使用回环或全部接口地址，端口范围 1024–65535".into());
    }
    if !c.connect_host.is_empty()
        && (c.connect_host.chars().any(|c| c.is_control())
            || url::Host::parse(&c.connect_host).is_err())
    {
        return Err("连接地址请填写主机名或 IP，不含协议和端口".into());
    }
    if c.tools.len() != TOOLS.len() {
        return Err("工具路由配置不完整".into());
    }
    let s = core.store.lock().unwrap();
    for (tool, p) in &c.tools {
        if !TOOLS.contains(&tool.as_str())
            || p.retries > 10
            || !(1..=100).contains(&p.failure_threshold)
            || !(1..=120).contains(&p.first_timeout)
            || (p.idle_timeout != 0 && !(60..=600).contains(&p.idle_timeout))
            || !(60..=1200).contains(&p.request_timeout)
            || !(1..=100).contains(&p.recovery_successes)
            || !(1..=3600).contains(&p.recovery_wait)
            || !(1..=100).contains(&p.error_percent)
            || !(1..=10000).contains(&p.min_requests)
        {
            return Err("重试、超时或熔断参数超出范围".into());
        }
        let mut unique = std::collections::HashSet::new();
        for id in &p.queue {
            if !unique.insert(id) {
                return Err("故障转移队列不能重复".into());
            }
            let entry = s.data["services"][pid]
                .as_array()
                .and_then(|a| a.iter().find(|e| e["id"] == *id))
                .ok_or("队列中的供应商已不存在，请重新选择")?;
            let selected = providers::apply_service(&s.profile(pid)?, entry, tool)?;
            if selected.model.trim().is_empty() {
                return Err("请先为队列中的供应商填写模型 ID".into());
            }
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn routing_status(
    state: tauri::State<'_, State>,
    profile_id: String,
) -> Result<Value, String> {
    let c = config(&state.0, &profile_id)?;
    let servers = state.0.routing.servers.lock().await;
    Ok(
        json!({"config":c,"running":servers.get(&profile_id).is_some_and(|s| !s.join.is_finished()),"usage":state.0.routing.usage.lock().unwrap().get(&profile_id)}),
    )
}
#[tauri::command]
pub async fn save_routing(
    state: tauri::State<'_, State>,
    profile_id: String,
    config: Config,
) -> Result<(), String> {
    let _guard = state.0.mutation.lock().await;
    validate(&state.0, &profile_id, &config)?;
    let old = self::config(&state.0, &profile_id)?;
    if (old.host != config.host || old.port != config.port)
        && state
            .0
            .routing
            .servers
            .lock()
            .await
            .contains_key(&profile_id)
    {
        return Err("请先停止路由服务，再修改监听地址与端口".into());
    }
    let mut live = state.0.store.lock().unwrap();
    let mut next = live.clone();
    if !next.data["routing"].is_object() {
        next.data["routing"] = json!({});
    }
    next.data["routing"][&profile_id] = json!(config);
    next.save()?;
    *live = next;
    state
        .0
        .routing
        .circuits
        .lock()
        .unwrap()
        .retain(|k, _| !k.starts_with(&format!("{profile_id}:")));
    Ok(())
}
#[tauri::command]
pub async fn routing_service(
    state: tauri::State<'_, State>,
    profile_id: String,
    start: bool,
) -> Result<(), String> {
    let _guard = state.0.mutation.lock().await;
    let c = config(&state.0, &profile_id)?;
    let mut servers = state.0.routing.servers.lock().await;
    if !start {
        servers.remove(&profile_id);
        state
            .0
            .resources
            .lock()
            .await
            .remove(&format!("{profile_id}:model-route"));
        return Ok(());
    }
    validate(&state.0, &profile_id, &c)?;
    if servers.contains_key(&profile_id) {
        return Ok(());
    }
    let listener = tokio::net::TcpListener::bind((c.host.as_str(), c.port))
        .await
        .map_err(|e| format!("路由监听失败：{e}"))?;
    let token = {
        let mut live = state.0.store.lock().unwrap();
        if let Some(encrypted) = live.data["routing_tokens"][&profile_id].as_str() {
            crate::secrets::unprotect(encrypted)?
        } else {
            let token = store::new_id();
            let mut next = live.clone();
            if !next.data["routing_tokens"].is_object() {
                next.data["routing_tokens"] = json!({});
            }
            next.data["routing_tokens"][&profile_id] = json!(crate::secrets::protect(&token)?);
            next.save()?;
            *live = next;
            token
        }
    };
    let app = Router::new()
        .route("/{tool}/{*path}", post(forward).get(forward))
        .layer(axum::extract::DefaultBodyLimit::max(32 * 1024 * 1024))
        .with_state((state.0.clone(), profile_id.clone(), token.clone()));
    let join = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    servers.insert(
        profile_id,
        Running {
            join,
            port: c.port,
            token,
        },
    );
    Ok(())
}

fn image_fallback(v: &mut Value) -> bool {
    let mut changed = false;
    match v {
        Value::Object(o) => {
            if ["image", "image_url", "input_image"]
                .contains(&o.get("type").and_then(Value::as_str).unwrap_or(""))
                || o.contains_key("inlineData")
                || o.contains_key("fileData")
            {
                *v = if o.contains_key("inlineData") || o.contains_key("fileData") {
                    json!({"text":"[Unsupported Image]"})
                } else {
                    json!({"type": if o.get("type").and_then(Value::as_str) == Some("input_image") { "input_text" } else { "text" },"text":"[Unsupported Image]"})
                };
                return true;
            }
            for item in o.values_mut() {
                changed |= image_fallback(item);
            }
        }
        Value::Array(a) => {
            for item in a {
                changed |= image_fallback(item);
            }
        }
        _ => (),
    }
    changed
}
fn rectify(v: &mut Value, error: &str, c: &Rectifier, anthropic: bool) -> bool {
    if !c.enabled {
        return false;
    }
    let error = error.to_lowercase();
    let old = v.clone();
    if anthropic
        && c.budget
        && error.contains("thinking")
        && error.contains("budget")
        && error.contains("1024")
        && v["thinking"]["type"] != "adaptive"
    {
        v["thinking"] = json!({"type":"enabled","budget_tokens":32000});
        if v["max_tokens"].as_u64().unwrap_or(0) < 32001 {
            v["max_tokens"] = json!(64000);
        }
    }
    if anthropic
        && c.signature
        && (error.contains("signature") || error.contains("redacted_thinking"))
    {
        if let Some(messages) = v["messages"].as_array_mut() {
            for m in messages {
                if let Some(a) = m["content"].as_array_mut() {
                    a.retain(|b| {
                        !["thinking", "redacted_thinking"]
                            .contains(&b["type"].as_str().unwrap_or(""))
                    });
                    if a.is_empty() {
                        a.push(json!({"type":"text","text":"[Thinking removed]"}));
                    }
                }
            }
        }
    }
    if c.image
        && (error.contains("image")
            && [
                "not support",
                "unsupported",
                "does not support",
                "text-only",
            ]
            .iter()
            .any(|s| error.contains(s)))
    {
        image_fallback(v);
    }
    *v != old
}
fn optimize(v: &mut Value, c: &Rectifier, bedrock: bool) {
    if !bedrock || !c.optimizer {
        return;
    }
    let model = v["model"].as_str().unwrap_or("").to_lowercase();
    if c.thinking
        && (model.contains("opus") || model.contains("sonnet"))
        && v.get("thinking").is_none()
    {
        v["thinking"] = if model.contains("4-6")
            || model.contains("4.6")
            || model.contains("4-7")
            || model.contains("4.7")
        {
            json!({"type":"adaptive"})
        } else {
            json!({"type":"enabled","budget_tokens":32000})
        };
        if v["thinking"]["type"] == "enabled" && v["max_tokens"].as_u64().unwrap_or(0) < 32001 {
            v["max_tokens"] = json!(64000);
        }
    }
    if c.cache {
        if let Some(system) = v["system"].as_str() {
            v["system"] = json!([{"type":"text","text":system}]);
        }
        if let Some(last) = v["system"].as_array_mut().and_then(|a| a.last_mut()) {
            if last.is_object() && last.get("cache_control").is_none() {
                last["cache_control"] = json!({"type":"ephemeral"});
            }
        }
    }
}
fn failure(status: StatusCode) -> bool {
    status.is_server_error() || matches!(status.as_u16(), 408 | 429)
}

#[tauri::command]
pub async fn routing_disconnect(
    state: tauri::State<'_, State>,
    profile_id: String,
    tool: String,
) -> Result<(), String> {
    let _guard = state.0.mutation.lock().await;
    let core = &state.0;
    if core.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请等待当前环境任务完成".into());
    }
    let c = config(core, &profile_id)?;
    let policy = c.tools.get(&tool).ok_or("工具无效")?;
    let (p, entry, scope) = {
        let s = core.store.lock().unwrap();
        let id = policy.queue.first().ok_or("请先选择直连供应商")?;
        (
            s.profile(&profile_id)?,
            s.data["services"][&profile_id]
                .as_array()
                .and_then(|a| a.iter().find(|e| e["id"] == *id))
                .cloned()
                .ok_or("供应商已不存在")?,
            s.scope(&profile_id),
        )
    };
    let selected = providers::apply_service(&p, &entry, &tool)?;
    let key = providers::service_key(
        core,
        &profile_id,
        entry["id"].as_str().ok_or("供应商 ID 缺失")?,
    )?;
    if key.is_empty() {
        return Err("请先保存供应商密钥".into());
    }
    let payload = json!({"tool":tool,"base_url":selected.base_url,"model":selected.model,"protocol":selected.protocol,"key":key,"service_id":selected.active_api,"project":p.project,"proxy":core.route(&p, &tool).await?,"reuse":false,"auth_mode":"api"});
    if p.is_local() {
        configure_local(&tool, &payload)?;
    } else {
        core.call(
            &p,
            &scope,
            if tool == "codex" {
                "configure"
            } else if tool == "grok" {
                "configure_extra"
            } else {
                "configure_tool"
            },
            payload,
            120,
        )
        .await?;
    }
    let mut live = core.store.lock().unwrap();
    let mut next = live.clone();
    if let Some(connected) = next.data["routing_connected"][&profile_id].as_object_mut() {
        connected.remove(&tool);
    }
    let mut updated = if tool == "codex" { selected } else { p };
    updated
        .tool_services
        .insert(tool, entry["id"].as_str().unwrap().into());
    next.save_profile(updated)?;
    *live = next;
    Ok(())
}

#[tauri::command]
pub async fn routing_connect(
    state: tauri::State<'_, State>,
    profile_id: String,
    tool: String,
) -> Result<(), String> {
    let _guard = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请等待当前环境任务完成".into());
    }
    connect(&state.0, &profile_id, &tool).await?;
    let mut live = state.0.store.lock().unwrap();
    let mut next = live.clone();
    if !next.data["routing_connected"].is_object() {
        next.data["routing_connected"] = json!({});
    }
    if !next.data["routing_connected"][&profile_id].is_object() {
        next.data["routing_connected"][&profile_id] = json!({});
    }
    next.data["routing_connected"][&profile_id][&tool] = json!(true);
    next.save()?;
    *live = next;
    Ok(())
}
pub fn connected(core: &Core, pid: &str, tool: &str) -> bool {
    core.store.lock().unwrap().data["routing_connected"][pid][tool] == true
}
pub async fn connect(core: &Core, profile_id: &str, tool: &str) -> Result<Value, String> {
    let c = config(core, profile_id)?;
    let policy = c.tools.get(tool).ok_or("工具无效")?;
    let (p, entry, scope) = {
        let s = core.store.lock().unwrap();
        let id = policy.queue.first().ok_or("请先保存至少一个供应商到队列")?;
        (
            s.profile(profile_id)?,
            s.data["services"][&profile_id]
                .as_array()
                .and_then(|a| a.iter().find(|e| e["id"] == *id))
                .cloned()
                .ok_or("供应商已不存在")?,
            s.scope(profile_id),
        )
    };
    let (port, token) = {
        let servers = core.routing.servers.lock().await;
        let r = servers
            .get(profile_id)
            .filter(|r| !r.join.is_finished())
            .ok_or("请先启动路由服务")?;
        (r.port, r.token.clone())
    };
    let remote_port = if p.is_local() {
        port
    } else {
        let mut resources = core.resources.lock().await;
        let key = format!("{profile_id}:model-route");
        if !resources.contains_key(&key) {
            resources.insert(
                key.clone(),
                crate::resources::Managed::start(p.clone(), port, 0, true, true, None).await?,
            );
        }
        let status = resources[&key].status.lock().unwrap().clone();
        if status.state != "已连接" {
            return Err("路由 SSH 转发尚未连接".into());
        }
        status.remote_port
    };
    let host = if p.is_local() && !c.connect_host.is_empty() {
        c.connect_host.as_str()
    } else {
        "127.0.0.1"
    };
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let base = format!("http://{host}:{remote_port}/{tool}");
    let protocol = providers::protocol_for_tool(tool)?;
    let base = if ["codex", "grok"].contains(&tool) {
        format!("{base}/v1")
    } else {
        base
    };
    let payload = json!({"tool":tool,"base_url":base,"model":entry["model"],"protocol":protocol,"key":token,"service_id":"edge-routing","project":p.project,"proxy":"","reuse":false,"auth_mode":"api"});
    if p.is_local() {
        configure_local(tool, &payload)?;
    } else {
        core.call(
            &p,
            &scope,
            if tool == "codex" {
                "configure"
            } else if tool == "grok" {
                "configure_extra"
            } else {
                "configure_tool"
            },
            payload.clone(),
            120,
        )
        .await?;
    }
    Ok(payload)
}
fn configure_local(tool: &str, v: &Value) -> Result<(), String> {
    use crate::extra_tools::{backup_write, home};
    if tool == "grok" {
        return crate::extra_tools::configure_local(tool, v);
    }
    if tool == "codex" {
        let path = crate::native_sessions::codex_home().join("config.toml");
        let mut c: toml::Value = if path.exists() {
            std::fs::read_to_string(&path)
                .map_err(|e| e.to_string())?
                .parse()
                .map_err(|_| "Codex 配置格式无效，原文件已保留")?
        } else {
            toml::Value::Table(Default::default())
        };
        let root = c.as_table_mut().ok_or("Codex 配置不是 TOML 表")?;
        root.insert(
            "model_provider".into(),
            toml::Value::String("edge-routing".into()),
        );
        root.insert(
            "forced_login_method".into(),
            toml::Value::String("api".into()),
        );
        root.insert(
            "model".into(),
            toml::Value::String(v["model"].as_str().unwrap_or("").into()),
        );
        let providers = root
            .entry("model_providers")
            .or_insert(toml::Value::Table(Default::default()))
            .as_table_mut()
            .ok_or("Codex 供应商配置无效")?;
        providers.insert("edge-routing".into(), toml::Value::try_from(json!({"name":"Edge Switch Routing","base_url":v["base_url"],"wire_api":"responses","experimental_bearer_token":v["key"]})).map_err(|e| e.to_string())?);
        return backup_write(
            &path,
            toml::to_string_pretty(&c)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        );
    }
    let path = home()?.join(if tool == "claude" {
        ".claude/settings.json"
    } else {
        ".gemini/settings.json"
    });
    let mut c: Value = if path.exists() {
        serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|_| "工具配置 JSON 无效，原文件已保留")?
    } else {
        json!({})
    };
    if !c.is_object() || c.get("env").is_some_and(|v| !v.is_object()) {
        return Err("工具配置或 env 格式无效，原文件已保留".into());
    }
    if !c["env"].is_object() {
        c["env"] = json!({});
    }
    if tool == "claude" {
        c["env"]["ANTHROPIC_BASE_URL"] = v["base_url"].clone();
        c["env"]["ANTHROPIC_AUTH_TOKEN"] = v["key"].clone();
        c["env"]
            .as_object_mut()
            .unwrap()
            .remove("ANTHROPIC_API_KEY");
        c["model"] = v["model"].clone();
    } else {
        let env_path = home()?.join(".gemini/.env");
        let original = if env_path.exists() {
            std::fs::read_to_string(&env_path).map_err(|e| e.to_string())?
        } else {
            String::new()
        };
        let mut lines: Vec<String> = original
            .lines()
            .filter(|s| {
                let key = s
                    .trim()
                    .trim_start_matches("export ")
                    .split('=')
                    .next()
                    .unwrap_or("")
                    .trim();
                !["GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY"].contains(&key)
            })
            .map(str::to_string)
            .collect();
        lines.push(format!(
            "GOOGLE_GEMINI_BASE_URL={}",
            v["base_url"].as_str().unwrap_or("")
        ));
        lines.push(format!(
            "GEMINI_API_KEY={}",
            v["key"].as_str().unwrap_or("")
        ));
        if c.get("security").is_some_and(|v| !v.is_object())
            || c["security"].get("auth").is_some_and(|v| !v.is_object())
        {
            return Err("Gemini security 配置格式无效，原文件已保留".into());
        }
        if !c["security"].is_object() {
            c["security"] = json!({});
        }
        if !c["security"]["auth"].is_object() {
            c["security"]["auth"] = json!({});
        }
        c["security"]["auth"]["selectedType"] = json!("gemini-api-key");
        if !c["model"].is_object() {
            c["model"] = json!({});
        }
        c["model"]["name"] = v["model"].clone();
        backup_write(&env_path, (lines.join("\n") + "\n").as_bytes())?;
    }
    backup_write(
        &path,
        serde_json::to_vec_pretty(&c)
            .map_err(|e| e.to_string())?
            .as_slice(),
    )
}
fn error_response(code: StatusCode, message: &str) -> Response {
    (
        code,
        axum::Json(json!({"error":{"message":message,"type":"routing_error"}})),
    )
        .into_response()
}

async fn forward(
    WebState((core, pid, token)): WebState<(Arc<Core>, String, String)>,
    Path((tool, path)): Path<(String, String)>,
    uri: Uri,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .or_else(|| headers.get("x-api-key").and_then(|v| v.to_str().ok()))
        .or_else(|| headers.get("x-goog-api-key").and_then(|v| v.to_str().ok()));
    if auth != Some(&token) {
        return error_response(StatusCode::UNAUTHORIZED, "路由访问凭据无效，请重新接入工具");
    }
    let c = match config(&core, &pid) {
        Ok(v) => v,
        Err(e) => return error_response(StatusCode::BAD_REQUEST, &e),
    };
    let Some(policy) = c.tools.get(&tool) else {
        return error_response(StatusCode::NOT_FOUND, "工具不支持模型路由");
    };
    let usage_record = UsageRecord {
        core: core.clone(),
        pid: pid.clone(),
        bytes: 0,
        ok: false,
        enabled: c.record_usage,
    };
    let (profile, entries) = {
        let s = core.store.lock().unwrap();
        (
            s.profile(&pid),
            s.data["services"][&pid]
                .as_array()
                .cloned()
                .unwrap_or_default(),
        )
    };
    let Ok(profile) = profile else {
        return error_response(StatusCode::NOT_FOUND, "环境不存在");
    };
    let mut body = if bytes.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(v) if v.is_object() => v,
            _ => return error_response(StatusCode::BAD_REQUEST, "请求需为 JSON 对象"),
        }
    };
    let streaming = body["stream"] == true || path.contains("streamGenerateContent");
    let deadline = Instant::now() + Duration::from_secs(policy.request_timeout);
    for id in &policy.queue {
        let Some(entry) = entries.iter().find(|e| e["id"] == *id) else {
            continue;
        };
        let Ok(selected) = providers::apply_service(&profile, entry, &tool) else {
            continue;
        };
        let circuit_key = format!("{pid}:{tool}:{id}");
        if !core
            .routing
            .circuits
            .lock()
            .unwrap()
            .entry(circuit_key.clone())
            .or_default()
            .admit(policy)
        {
            continue;
        }
        let lease = ProbeLease {
            core: core.clone(),
            key: circuit_key.clone(),
        };
        let key = match providers::service_key(&core, &pid, id) {
            Ok(v) if !v.is_empty() => v,
            _ => {
                core.routing
                    .circuits
                    .lock()
                    .unwrap()
                    .entry(circuit_key.clone())
                    .or_default()
                    .record(false, policy);
                continue;
            }
        };
        let builder = match crate::network::builder(profile.uses_proxy(&tool), profile.proxy_port) {
            Ok(b) => b,
            Err(_) => break,
        };
        let client = match builder
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .build()
        {
            Ok(v) => v,
            Err(_) => break,
        };
        let base = selected.base_url.trim_end_matches('/');
        let suffix = if base.ends_with("/v1") {
            path.strip_prefix("v1/").unwrap_or(&path)
        } else if base.ends_with("/v1beta") {
            path.strip_prefix("v1beta/").unwrap_or(&path)
        } else {
            &path
        };
        if suffix.contains("..") || suffix.contains("://") {
            return error_response(StatusCode::BAD_REQUEST, "路由路径无效");
        }
        let suffix = if selected.protocol == "gemini" {
            if let Some((prefix, rest)) = suffix.split_once("models/") {
                if let Some((_, action)) = rest.split_once(':') {
                    format!(
                        "{prefix}models/{}:{action}",
                        selected.model.trim_start_matches("models/")
                    )
                } else {
                    suffix.to_string()
                }
            } else {
                suffix.to_string()
            }
        } else {
            suffix.to_string()
        };
        let mut target = format!("{base}/{suffix}");
        // Forward only protocol query fields; never a caller-supplied API key.
        if let Some(query) = uri.query() {
            let pairs: Vec<_> = url::form_urlencoded::parse(query.as_bytes())
                .filter(|(k, _)| ["alt", "$alt", "prettyPrint"].contains(&k.as_ref()))
                .collect();
            let q = url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(pairs)
                .finish();
            if !q.is_empty() {
                target.push('?');
                target.push_str(&q);
            }
        }
        let mut request_body = body.clone();
        if !request_body.is_null() && selected.protocol != "gemini" {
            request_body["model"] = json!(selected.model);
        }
        if c.rectifier.enabled
            && c.rectifier.image
            && c.rectifier.heuristic
            && [
                "o1-mini",
                "o1-preview",
                "deepseek-chat",
                "deepseek-reasoner",
            ]
            .contains(&selected.model.as_str())
        {
            image_fallback(&mut request_body);
        }
        let anthropic = selected.protocol == "anthropic";
        optimize(
            &mut request_body,
            &c.rectifier,
            selected.base_url.contains("bedrock") && anthropic,
        );
        let mut repaired = false;
        let mut attempt = 0;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            let first_deadline = Instant::now()
                + Duration::from_secs(if streaming {
                    policy.first_timeout
                } else {
                    policy.request_timeout
                })
                .min(remaining);
            let mut req = if bytes.is_empty() {
                client.get(&target)
            } else {
                client.post(&target).json(&request_body)
            };
            req = if anthropic {
                req.header("x-api-key", &key).header(
                    "anthropic-version",
                    headers
                        .get("anthropic-version")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("2023-06-01"),
                )
            } else if selected.protocol == "gemini" {
                req.header("x-goog-api-key", &key)
            } else {
                req.bearer_auth(&key)
            };
            if let Some(beta) = headers.get("anthropic-beta") {
                req = req.header("anthropic-beta", beta);
            }
            let sent = tokio::time::timeout(
                remaining.min(Duration::from_secs(if streaming {
                    policy.first_timeout
                } else {
                    policy.request_timeout
                })),
                req.send(),
            )
            .await;
            if let Ok(Ok(response)) = sent {
                let status = response.status();
                if status.is_success() {
                    let content_type = response.headers().get("content-type").cloned();
                    let mut upstream = response.bytes_stream();
                    // Wait for actual first data before committing downstream headers.
                    let first = tokio::time::timeout(
                        first_deadline.saturating_duration_since(Instant::now()),
                        upstream.next(),
                    )
                    .await;
                    if let Ok(Some(Ok(first))) = first {
                        let core2 = core.clone();
                        let ck = circuit_key.clone();
                        let p = policy.clone();
                        let stream = async_stream::stream! {
                            let _lease = lease;
                            let mut usage_record = usage_record;
                            usage_record.bytes += first.len() as u64;
                            yield Ok::<_, std::io::Error>(first);
                            let mut ok = true;
                            loop {
                                let next = if streaming && p.idle_timeout == 0 { Ok(upstream.next().await) } else { let wait = if streaming { Duration::from_secs(p.idle_timeout) } else { deadline.saturating_duration_since(Instant::now()) }; tokio::time::timeout(wait, upstream.next()).await };
                                match next {
                                    Ok(Some(Ok(chunk))) => { usage_record.bytes += chunk.len() as u64; yield Ok(chunk); },
                                    Ok(None) => break,
                                    _ => { ok = false; yield Err(std::io::Error::other("上游响应超时或连接中断")); break; }
                                }
                            }
                            core2.routing.circuits.lock().unwrap().entry(ck).or_default().record(ok, &p);
                            usage_record.ok = ok;
                        };
                        let mut result = Response::new(Body::from_stream(stream));
                        *result.status_mut() = status;
                        if let Some(v) = content_type {
                            result.headers_mut().insert("content-type", v);
                        }
                        return result;
                    }
                } else {
                    let retryable = failure(status);
                    let mut stream = response.bytes_stream();
                    let mut error = Vec::new();
                    while let Ok(Some(Ok(chunk))) = tokio::time::timeout(
                        Duration::from_secs(5)
                            .min(deadline.saturating_duration_since(Instant::now())),
                        stream.next(),
                    )
                    .await
                    {
                        if error.len() + chunk.len() > 1024 * 1024 {
                            break;
                        }
                        error.extend_from_slice(&chunk);
                    }
                    if matches!(status.as_u16(), 400 | 422)
                        && !repaired
                        && rectify(
                            &mut request_body,
                            &String::from_utf8_lossy(&error),
                            &c.rectifier,
                            anthropic,
                        )
                    {
                        repaired = true;
                        continue;
                    }
                    if !retryable {
                        core.routing
                            .circuits
                            .lock()
                            .unwrap()
                            .entry(circuit_key.clone())
                            .or_default()
                            .record(true, policy);
                        return error_response(
                            status,
                            "供应商拒绝请求，请检查模型、权限或请求参数",
                        );
                    }
                }
            }
            core.routing
                .circuits
                .lock()
                .unwrap()
                .entry(circuit_key.clone())
                .or_default()
                .record(false, policy);
            if attempt >= policy.retries {
                break;
            }
            attempt += 1;
            if !core
                .routing
                .circuits
                .lock()
                .unwrap()
                .entry(circuit_key.clone())
                .or_default()
                .admit(policy)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(150 * attempt as u64)).await;
        }
        body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        };
    }
    error_response(
        StatusCode::BAD_GATEWAY,
        "路由队列暂无可用供应商，请检查供应商、密钥或等待熔断恢复",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn circuit_opens_recovers_and_serializes_probes() {
        let p = Policy {
            failure_threshold: 2,
            recovery_wait: 1,
            recovery_successes: 2,
            ..Default::default()
        };
        let mut c = Circuit::default();
        c.record(false, &p);
        assert!(c.admit(&p));
        c.record(false, &p);
        assert!(!c.admit(&p));
        c.opened = Some(Instant::now() - Duration::from_secs(2));
        assert!(c.admit(&p));
        assert!(!c.admit(&p));
        c.record(true, &p);
        assert!(c.opened.is_some());
        assert!(c.admit(&p));
        c.record(true, &p);
        assert!(c.opened.is_none());
    }
    #[test]
    fn error_rate_requires_minimum_samples() {
        let p = Policy {
            failure_threshold: 100,
            min_requests: 4,
            error_percent: 50,
            ..Default::default()
        };
        let mut c = Circuit::default();
        for ok in [false, true, false] {
            c.record(ok, &p);
        }
        assert!(c.opened.is_none());
        c.record(false, &p);
        assert!(c.opened.is_some());
    }
    #[test]
    fn repairs_only_matching_errors_and_honors_switches() {
        let mut v = json!({"max_tokens":100,"messages":[{"role":"assistant","content":[{"type":"thinking","signature":"bad"},{"type":"text","text":"answer"}]}]});
        let c = Rectifier::default();
        let original = v.clone();
        assert!(!rectify(&mut v, "invalid API key", &c, true));
        assert_eq!(v, original);
        assert!(rectify(&mut v, "invalid thinking signature", &c, true));
        assert_eq!(v["messages"][0]["content"].as_array().unwrap().len(), 1);
        assert!(rectify(&mut v, "thinking budget_tokens >= 1024", &c, true));
        assert_eq!(v["max_tokens"], 64000);
        let mut disabled = c.clone();
        disabled.enabled = false;
        assert!(!rectify(
            &mut v,
            "thinking budget_tokens >= 1024",
            &disabled,
            true
        ));
        v["thinking"] = json!({"type":"adaptive"});
        assert!(!rectify(&mut v, "thinking budget_tokens >= 1024", &c, true));
    }
    #[test]
    fn image_fallback_preserves_tool_results_and_bedrock_optimization_is_scoped() {
        let mut v = json!({"model":"claude-sonnet-4-6","system":"hello","messages":[{"role":"user","content":[{"type":"image","source":{"data":"base64"}},{"type":"tool_result","tool_use_id":"a","content":"result"}]}]});
        assert!(image_fallback(&mut v));
        assert_eq!(v["messages"][0]["content"][1]["tool_use_id"], "a");
        let c = Rectifier {
            optimizer: true,
            ..Default::default()
        };
        optimize(&mut v, &c, false);
        assert!(v.get("thinking").is_none());
        optimize(&mut v, &c, true);
        assert_eq!(v["thinking"]["type"], "adaptive");
        assert_eq!(v["system"][0]["cache_control"]["type"], "ephemeral");
    }
    #[tokio::test]
    async fn routes_failover_with_private_credentials_and_skips_open_circuit() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let calls = Arc::new(AtomicUsize::new(0));
        let backups = Arc::new(AtomicUsize::new(0));
        let backup_count = backups.clone();
        let counter = calls.clone();
        let upstream = Router::new()
            .route(
                "/first/responses",
                post(move || {
                    let c = counter.clone();
                    async move {
                        c.fetch_add(1, Ordering::SeqCst);
                        StatusCode::SERVICE_UNAVAILABLE
                    }
                }),
            )
            .route(
                "/backup/responses",
                post(
                    move |headers: HeaderMap, axum::Json(v): axum::Json<Value>| {
                        let count = backup_count.clone();
                        async move {
                            count.fetch_add(1, Ordering::SeqCst);
                            assert_eq!(headers["authorization"], "Bearer backup-private-key");
                            assert_eq!(v["model"], "backup-model");
                            if v["stream"] == true {
                                let body = async_stream::stream! {
                                    yield Ok::<_, std::io::Error>(Bytes::from("data: first\n\n"));
                                    tokio::time::sleep(Duration::from_millis(100)).await;
                                    yield Err(std::io::Error::other("upstream disconnected"));
                                };
                                return Response::builder()
                                    .header("content-type", "text/event-stream")
                                    .body(Body::from_stream(body))
                                    .unwrap();
                            }
                            axum::Json(json!({"id":"done","output":[]})).into_response()
                        }
                    },
                ),
            )
            .route(
                "/backup/v1beta/models/backup-model:streamGenerateContent",
                post(
                    |headers: HeaderMap, uri: Uri, axum::Json(v): axum::Json<Value>| async move {
                        assert_eq!(headers["x-goog-api-key"], "backup-private-key");
                        assert!(v.get("model").is_none());
                        assert_eq!(uri.query(), Some("alt=sse"));
                        axum::Json(json!({"candidates":[]}))
                    },
                ),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let upstream_task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let core = Arc::new(crate::tests::core());
        let pid = core.store.lock().unwrap().data["profiles"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let first = store::new_id();
        let second = store::new_id();
        {
            let mut s = core.store.lock().unwrap();
            s.data["services"][&pid] = json!([
                {"id":first,"tool":"codex","protocol":"responses","base_url":format!("http://{addr}/first"),"model":"first-model"},
                {"id":second,"scope":"universal","tool":"codex","protocol":"responses","base_url":format!("http://{addr}/backup"),"model":"backup-model"}
            ]);
            let mut c = Config::default();
            c.tools.insert(
                "codex".into(),
                Policy {
                    queue: vec![first.clone(), second.clone()],
                    retries: 0,
                    failure_threshold: 1,
                    ..Default::default()
                },
            );
            c.tools.insert(
                "gemini".into(),
                Policy {
                    queue: vec![second.clone()],
                    retries: 0,
                    ..Default::default()
                },
            );
            s.data["routing"] = json!({pid.clone():c});
        }
        core.volatile_keys
            .lock()
            .unwrap()
            .insert(first, "first-private-key".into());
        core.volatile_keys
            .lock()
            .unwrap()
            .insert(second, "backup-private-key".into());
        let router = Router::new()
            .route("/{tool}/{*path}", post(forward))
            .with_state((core.clone(), pid.clone(), "route-token".into()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let route_task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let client = reqwest::Client::new();
        let url = format!("http://{addr}/codex/responses");
        assert_eq!(
            client
                .post(&url)
                .json(&json!({}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        for _ in 0..2 {
            let response = client
                .post(&url)
                .bearer_auth("route-token")
                .json(&json!({"model":"client-model","input":"hello"}))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.json::<Value>().await.unwrap()["id"], "done");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(core.routing.usage.lock().unwrap()[&pid]["requests"], 2);
        let mut response = client
            .post(&url)
            .bearer_auth("route-token")
            .json(&json!({"stream":true,"input":"hello"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.chunk().await.unwrap().unwrap(), "data: first\n\n");
        assert!(response.chunk().await.is_err());
        assert_eq!(
            backups.load(Ordering::SeqCst),
            3,
            "a started stream must never be replayed"
        );
        let gemini = client.post(format!("http://{addr}/gemini/v1beta/models/client-model:streamGenerateContent?alt=sse&key=must-not-be-forwarded")).bearer_auth("route-token").json(&json!({"contents":[]})).send().await.unwrap();
        assert_eq!(gemini.status(), StatusCode::OK);
        assert_eq!(
            gemini.json::<Value>().await.unwrap()["candidates"],
            json!([])
        );
        route_task.abort();
        upstream_task.abort();
    }
}
