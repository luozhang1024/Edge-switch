use crate::{native_sessions, store, State};
use serde_json::{json, Value};
use std::fs;

fn read() -> Result<(std::path::PathBuf, String, toml::Value), String> {
    let path = native_sessions::codex_home().join("config.toml");
    let raw = fs::read_to_string(&path).map_err(|_| "无法读取本机 Codex 配置")?;
    let value = raw
        .parse::<toml::Value>()
        .map_err(|_| "本机 Codex 配置格式无效，原文件已保留")?;
    Ok((path, raw, value))
}
fn key(config: &toml::Value, provider: &str) -> Result<String, String> {
    let entry = &config["model_providers"][provider];
    if let Some(key) = entry
        .get("experimental_bearer_token")
        .and_then(|v| v.as_str())
    {
        return Ok(key.into());
    }
    if let Some(name) = entry.get("env_key").and_then(|v| v.as_str()) {
        return std::env::var(name)
            .map_err(|_| "供应商指定的密钥环境变量尚未设置，请在本机配置后重启应用".into());
    }
    let auth = fs::read(native_sessions::codex_home().join("auth.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .unwrap_or(Value::Null);
    auth["OPENAI_API_KEY"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or("本机未找到此供应商的 API Key，请在原工具中配置密钥".into())
}
pub async fn test(
    endpoint: &str,
    protocol: &str,
    key: &str,
    proxy: bool,
    port: u16,
) -> Result<Value, String> {
    store::validate_url(endpoint)?;
    let base = endpoint.trim_end_matches('/');
    let endpoint = if protocol == "anthropic" && !base.ends_with("/v1") {
        format!("{base}/v1/models")
    } else {
        format!("{base}/models")
    };
    let client = crate::network::builder(proxy, port)?
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "无法创建供应商测试连接")?;
    let request = if protocol == "anthropic" {
        client
            .get(endpoint)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
    } else if protocol == "gemini" {
        client.get(endpoint).header("x-goog-api-key", key)
    } else {
        client.get(endpoint).bearer_auth(key)
    };
    let response = request
        .send()
        .await
        .map_err(|_| "供应商连接失败，请检查网络与地址")?;
    if !response.status().is_success() {
        return Err(format!(
            "供应商测试未通过：HTTP {}",
            response.status().as_u16()
        ));
    }
    Ok(json!({"message":"供应商连接及模型列表测试通过（未发送推理请求）"}))
}
#[tauri::command]
pub async fn native_provider_action(
    state: tauri::State<'_, State>,
    profile_id: String,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    let _guard = state.0.mutation.lock().await;
    let p = state.0.store.lock().unwrap().profile(&profile_id)?;
    if !p.is_local() {
        return Err("仅支持本机环境".into());
    }
    let (path, original, mut config) = read()?;
    let provider = config
        .get("model_provider")
        .and_then(|v| v.as_str())
        .unwrap_or("openai")
        .to_string();
    if config
        .get("model_providers")
        .and_then(|v| v.get(&provider))
        .is_none()
    {
        return Err("当前为官方账号，请在授权中心管理".into());
    }
    if let Some(expected) = payload["provider"].as_str() {
        if expected != provider {
            return Err("本机供应商已变化，请刷新后重试".into());
        }
    }
    if action == "test" {
        return test(
            config["model_providers"][&provider]
                .get("base_url")
                .and_then(|v| v.as_str())
                .ok_or("供应商地址缺失")?,
            "responses",
            &key(&config, &provider)?,
            p.proxy,
            p.proxy_port,
        )
        .await;
    }
    if action == "duplicate" {
        let entry = &config["model_providers"][&provider];
        let service = json!({"id":store::new_id(),"tool":"codex","provider":"custom","scope":"cli","name":format!("{} 副本",entry.get("name").and_then(|v|v.as_str()).unwrap_or(&provider)),"base_url":entry.get("base_url").and_then(|v|v.as_str()).unwrap_or(""),"model":config.get("model").and_then(|v|v.as_str()).unwrap_or(""),"protocol":"responses"});
        crate::save_service_inner(
            &state.0,
            profile_id,
            service,
            key(&config, &provider).ok(),
            true,
        )?;
        return Ok(json!({"message":"已复制到供应商列表；如有可用密钥则在本机加密保存"}));
    }
    if action == "save" {
        let endpoint = payload["endpoint"].as_str().ok_or("请填写地址")?;
        store::validate_url(endpoint)?;
        for name in ["name", "model"] {
            if payload[name]
                .as_str()
                .is_none_or(|s| s.trim().is_empty() || s.len() > 500)
            {
                return Err("名称或模型不能为空且不能超过 500 字符".into());
            }
        }
        let table = config
            .get_mut("model_providers")
            .and_then(|v| v.get_mut(&provider))
            .and_then(|v| v.as_table_mut())
            .ok_or("供应商配置格式无效")?;
        table.insert(
            "name".into(),
            toml::Value::String(payload["name"].as_str().unwrap().into()),
        );
        table.insert("base_url".into(), toml::Value::String(endpoint.into()));
        config.as_table_mut().unwrap().insert(
            "model".into(),
            toml::Value::String(payload["model"].as_str().unwrap().into()),
        );
    } else if action == "delete" {
        config["model_providers"]
            .as_table_mut()
            .unwrap()
            .remove(&provider);
        config.as_table_mut().unwrap().remove("model_provider");
        config.as_table_mut().unwrap().remove("model");
    } else {
        return Err("未知操作".into());
    }
    if fs::read_to_string(&path).map_err(|e| e.to_string())? != original {
        return Err("配置已被外部修改，请刷新后重试".into());
    }
    store::atomic_write(
        &path.with_file_name(format!("config.edge-switch-{}.bak", store::new_id())),
        original.as_bytes(),
    )?;
    store::atomic_write(
        &path,
        toml::to_string_pretty(&config)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )?;
    Ok(json!({"message":"已更新本机 Codex 配置，原文件已备份"}))
}
