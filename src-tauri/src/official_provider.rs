use crate::{extra_tools, secrets, store, store::Profile, Core, State};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;

fn revision(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn path(tool: &str) -> Result<std::path::PathBuf, String> {
    match tool {
        "codex" => Ok(crate::native_sessions::codex_home().join("config.toml")),
        "claude" => Ok(std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or(extra_tools::home()?.join(".claude"))
            .join("settings.json")),
        _ => Err("仅支持 Codex 和 Claude 官方配置".into()),
    }
}
fn normalize(tool: &str, text: &str, threads: Option<u64>) -> Result<String, String> {
    if text.len() > 1024 * 1024 {
        return Err("配置不能超过 1 MiB".into());
    }
    if tool == "codex" {
        let mut config: toml::Value =
            toml::from_str(text).map_err(|e| format!("TOML 配置无效：{e}"))?;
        let root = config.as_table_mut().ok_or("配置需要 TOML 表")?;
        for key in [
            "model_provider",
            "model_providers",
            "forced_login_method",
            "cli_auth_credentials_store",
        ] {
            root.remove(key);
        }
        if let Some(count) = threads {
            if count == 0 || count > 128 {
                return Err("子代理并发上限应为 1–128".into());
            }
            root.entry("agents")
                .or_insert_with(|| toml::Value::Table(Default::default()))
                .as_table_mut()
                .ok_or("agents 必须为 TOML 表")?
                .insert("max_threads".into(), toml::Value::Integer(count as i64));
        }
        return toml::to_string_pretty(&config).map_err(|e| e.to_string());
    }
    let mut config: Value =
        serde_json::from_str(text).map_err(|e| format!("JSON 配置无效：{e}"))?;
    if !config.is_object() {
        return Err("配置需要 JSON 对象".into());
    }
    if let Some(env) = config["env"].as_object_mut() {
        for key in [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_MODEL",
        ] {
            env.remove(key);
        }
    }
    serde_json::to_string_pretty(&config).map_err(|e| e.to_string())
}
fn live_text(tool: &str, text: &str, original: &str) -> Result<String, String> {
    if tool != "codex" {
        return Ok(text.into());
    }
    let mut config: toml::Value = toml::from_str(text).map_err(|_| "TOML 配置无效")?;
    if let Ok(live) = toml::from_str::<toml::Value>(original) {
        if let Some(providers) = live.get("model_providers") {
            config
                .as_table_mut()
                .ok_or("配置无效")?
                .insert("model_providers".into(), providers.clone());
        }
    }
    let table = config.as_table_mut().ok_or("配置无效")?;
    table.insert(
        "forced_login_method".into(),
        toml::Value::String("chatgpt".into()),
    );
    table.insert(
        "cli_auth_credentials_store".into(),
        toml::Value::String("file".into()),
    );
    toml::to_string_pretty(&config).map_err(|e| e.to_string())
}
pub fn saved(core: &Core, p: &Profile, tool: &str) -> Result<Option<String>, String> {
    let encrypted = core.store.lock().unwrap().data["official_options"][&p.id][tool]["config"]
        .as_str()
        .map(String::from);
    encrypted.map(|v| secrets::unprotect(&v)).transpose()
}
pub fn apply_local(core: &Core, p: &Profile, tool: &str) -> Result<(), String> {
    let target = path(tool)?;
    let text = match saved(core, p, tool)? {
        Some(text) => text,
        None => fs::read_to_string(&target).unwrap_or_else(|_| {
            if tool == "codex" {
                "".into()
            } else {
                "{}".into()
            }
        }),
    };
    let text = normalize(tool, &text, None)?;
    let text = live_text(
        tool,
        &text,
        &fs::read_to_string(&target).unwrap_or_default(),
    )?;
    extra_tools::backup_write(&target, text.as_bytes())
}

#[tauri::command]
pub async fn official_provider(
    state: tauri::State<'_, State>,
    profile_id: String,
    tool: String,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    if !["codex", "claude"].contains(&tool.as_str()) {
        return Err("工具无效".into());
    }
    let core = &state.0;
    let _guard = core.mutation.lock().await;
    if core.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请先完成当前环境任务".into());
    }
    let (p, scope, mut metadata) = {
        let store = core.store.lock().unwrap();
        (
            store.profile(&profile_id)?,
            store.scope(&profile_id),
            store.data["official_options"][&profile_id][&tool].clone(),
        )
    };
    let active = if tool == "codex" {
        p.codex_auth == "chatgpt"
    } else {
        p.tool_services.get(&tool).is_some_and(|v| v == "official")
    };
    let live = if p.is_local() {
        let target = path(&tool)?;
        let text = match fs::read_to_string(&target) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if tool == "codex" {
                    "".into()
                } else {
                    "{}".into()
                }
            }
            Err(e) => return Err(e.to_string()),
        };
        json!({"config":text,"revision":revision(&text),"path":target.to_string_lossy()})
    } else {
        core.call(
            &p,
            &scope,
            "official_config",
            json!({"tool":tool,"operation":"read"}),
            30,
        )
        .await?
    };
    if action == "get" {
        let config = if !active {
            saved(core, &p, &tool)?.unwrap_or(live["config"].as_str().unwrap_or("").into())
        } else {
            live["config"].as_str().unwrap_or("").into()
        };
        if !metadata.is_object() {
            metadata = json!({});
        }
        if tool == "codex" {
            let store = core.store.lock().unwrap();
            for key in ["name", "note", "icon"] {
                if let Some(v) = store.data["official"][&profile_id].get(key) {
                    metadata[key] = v.clone();
                }
            }
        }
        metadata.as_object_mut().unwrap().remove("config");
        metadata["config_text"] = json!(normalize(&tool, &config, None)?);
        metadata["revision"] = live["revision"].clone();
        metadata["active"] = json!(active);
        metadata["path"] = live["path"].clone();
        return Ok(metadata);
    }
    if action != "save" && action != "format" {
        return Err("操作无效".into());
    }
    let text = normalize(
        &tool,
        payload["config_text"].as_str().ok_or("配置缺失")?,
        payload["max_threads"].as_u64(),
    )?;
    if action == "format" {
        return Ok(json!({"config_text":text}));
    }
    let name = payload["name"].as_str().unwrap_or("").trim();
    if name.is_empty() || name.len() > 500 {
        return Err("请填写有效名称".into());
    }
    if let Some(website) = payload["website"].as_str().filter(|v| !v.is_empty()) {
        store::validate_url(website)?;
    }
    if payload["revision"] != live["revision"] {
        return Err("配置已被外部修改，请重新打开编辑器".into());
    }
    let mut auth_text = payload["auth_json"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    if let Some(file) = payload["auth_path"].as_str().filter(|v| !v.is_empty()) {
        if fs::metadata(file).map_err(|_| "无法读取凭据文件")?.len() > 256 * 1024 {
            return Err("凭据文件过大".into());
        }
        auth_text = fs::read_to_string(file).map_err(|_| "无法读取凭据文件")?;
    }
    let auth = if tool == "codex" && !auth_text.is_empty() {
        if auth_text.len() > 256 * 1024 {
            return Err("凭据不能超过 256 KiB".into());
        }
        let value: Value = serde_json::from_str(&auth_text).map_err(|_| "auth.json 格式无效")?;
        if !value["tokens"]["access_token"]
            .as_str()
            .is_some_and(|v| !v.is_empty())
        {
            return Err("请填写官方 OAuth 凭据，或留空跟随 Codex 登录".into());
        }
        Some(value)
    } else {
        None
    };
    let encrypted = secrets::protect(&text)?;
    let mut entry = json!({"name":name,"note":payload["note"],"website":payload["website"],"login_method":payload["login_method"],"config":encrypted});
    if let Some(icon) = payload["icon"].as_str() {
        crate::providers::validate_icon(icon)?;
        entry["icon"] = json!(icon);
    }
    // Validate and write the active native configuration before recording success.
    if active {
        if p.is_local() {
            let final_text = live_text(&tool, &text, live["config"].as_str().unwrap_or(""))?;
            extra_tools::backup_write(&path(&tool)?, final_text.as_bytes())?;
        } else {
            core.call(
                &p,
                &scope,
                "official_config",
                json!({"tool":tool,"operation":"write","config":text,"expected":live["revision"]}),
                30,
            )
            .await?;
        }
    }
    if p.is_local() {
        if let Some(auth) = &auth {
            crate::accounts::save_local_codex(auth)?;
        }
    }
    let mut s = core.store.lock().unwrap();
    if !s.data["official_options"].is_object() {
        s.data["official_options"] = json!({});
    }
    if !s.data["official_options"][&profile_id].is_object() {
        s.data["official_options"][&profile_id] = json!({});
    }
    s.data["official_options"][&profile_id][&tool] = entry;
    if tool == "codex" {
        if !s.data["official"][&profile_id].is_object() {
            s.data["official"][&profile_id] = json!({});
        }
        s.data["official"][&profile_id]["name"] = json!(name);
        s.data["official"][&profile_id]["note"] = payload["note"].clone();
        if let Some(icon) = payload["icon"].as_str() {
            s.data["official"][&profile_id]["icon"] = json!(icon);
        }
        if let Some(auth) = auth {
            s.data["official"][&profile_id]["credentials"] =
                json!(secrets::protect(&auth.to_string())?);
        }
    }
    s.save()?;
    Ok(
        json!({"message":if active {"已保存并写入当前工具配置，下次请求生效"}else{"已保存，启用官方供应商并启动或同步时生效"}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_config_keeps_shared_settings_and_removes_api_routes() {
        let text=normalize("codex","model_provider='custom'\n[model_providers.custom]\nbase_url='https://example.com'\n[mcp_servers.demo]\ncommand='node'",Some(8)).unwrap();
        assert!(text.contains("mcp_servers.demo"));
        assert!(text.contains("max_threads = 8"));
        assert!(!text.contains("model_provider"));
        let text=normalize("claude",r#"{"env":{"ANTHROPIC_API_KEY":"secret","KEEP":"yes"},"permissions":{"allow":["Read"]}}"#,None).unwrap();
        assert!(!text.contains("secret"));
        assert!(text.contains("KEEP"));
        assert!(text.contains("permissions"));
        assert!(normalize("claude", "[]", None).is_err());
    }
}
