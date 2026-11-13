use crate::{secrets, store, Core, State};
use base64::Engine;
use futures_util::StreamExt;
use serde_json::{json, Value};

#[tauri::command]
pub async fn hide_default_service(
    state: tauri::State<'_, State>,
    profile_id: String,
) -> Result<(), String> {
    let _guard = state.0.mutation.lock().await;
    let mut store = state.0.store.lock().unwrap();
    let mut profile = store.profile(&profile_id)?;
    profile
        .extra
        .insert("hide_harness_default".into(), json!(true));
    store.save_profile(profile)
}

pub fn validate_icon(icon: &str) -> Result<(), String> {
    if icon.is_empty() {
        return Ok(());
    }
    let encoded = icon
        .strip_prefix("data:image/png;base64,")
        .ok_or("图标需为 PNG 图片")?;
    if encoded.len() > 350_000 {
        return Err("图标过大".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "图标编码无效")?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("图标格式无效".into());
    }
    Ok(())
}

pub fn service_key(core: &Core, profile_id: &str, service_id: &str) -> Result<String, String> {
    let s = core.store.lock().unwrap();
    s.profile(profile_id)?;
    if !s.data["services"][profile_id]
        .as_array()
        .is_some_and(|entries| entries.iter().any(|e| e["id"] == service_id))
    {
        return Err("服务不存在".into());
    }
    if let Some(key) = core.volatile_keys.lock().unwrap().get(service_id) {
        return Ok(key.clone());
    }
    s.data["secrets"][service_id]
        .as_str()
        .map(secrets::unprotect)
        .transpose()
        .map(|key| key.unwrap_or_default())
}

#[tauri::command]
pub async fn get_service_key(
    state: tauri::State<'_, State>,
    profile_id: String,
    service_id: String,
) -> Result<String, String> {
    service_key(&state.0, &profile_id, &service_id)
}

#[tauri::command]
pub async fn duplicate_service(
    state: tauri::State<'_, State>,
    profile_id: String,
    service_id: String,
) -> Result<Value, String> {
    let _mutation = state.0.mutation.lock().await;
    if state.0.active.lock().unwrap().contains_key(&profile_id) {
        return Err("请等待此环境任务结束".into());
    }
    let key = service_key(&state.0, &profile_id, &service_id)?;
    let (mut entry, remember) = {
        let store = state.0.store.lock().unwrap();
        let entry = store.data["services"][&profile_id]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == service_id)
            .ok_or("服务不存在")?
            .clone();
        (entry, store.data["secrets"][&service_id].is_string())
    };
    entry["id"] = json!(store::new_id());
    entry["name"] = json!(format!("{} 副本", entry["name"].as_str().unwrap_or("服务")));
    crate::save_service_inner(&state.0, profile_id, entry, Some(key), remember)
}

pub fn protocol_for_tool(tool: &str) -> Result<&'static str, String> {
    match tool {
        "codex" => Ok("responses"),
        "claude" => Ok("anthropic"),
        "gemini" => Ok("gemini"),
        "harness" | "opencode" => Ok("chat"),
        _ => Err("工具无效".into()),
    }
}

pub fn apply_service(
    p: &store::Profile,
    entry: &Value,
    tool: &str,
) -> Result<store::Profile, String> {
    let universal = entry["scope"] == "universal";
    if !universal && entry["tool"].as_str().unwrap_or("codex") != tool {
        return Err("服务不属于当前工具".into());
    }
    let protocol = if universal {
        protocol_for_tool(tool)?
    } else {
        entry["protocol"].as_str().unwrap_or("")
    };
    store::validate_tool_protocol(tool, protocol)?;
    let mut selected = p.clone();
    selected.active_api = entry["id"].as_str().ok_or("服务 ID 无效")?.into();
    selected.base_url = entry["base_url"].as_str().unwrap_or("").into();
    if universal && ["claude", "gemini"].contains(&tool) {
        let base = selected.base_url.trim_end_matches('/');
        selected.base_url = base
            .strip_suffix("/v1beta")
            .or_else(|| base.strip_suffix("/v1"))
            .unwrap_or(base)
            .into();
    }
    selected.model = entry["model"].as_str().unwrap_or("").into();
    selected.protocol = protocol.into();
    selected.codex_auth = "api".into();
    Ok(selected)
}

fn model_ids(value: &Value, protocol: &str) -> Vec<String> {
    let items = if protocol == "gemini" {
        &value["models"]
    } else {
        &value["data"]
    };
    let mut ids: Vec<String> = items
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let s = if protocol == "gemini" {
                m["name"].as_str().map(|s| s.trim_start_matches("models/"))
            } else {
                m["id"].as_str()
            }?;
            (!s.is_empty()).then(|| s.to_string())
        })
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

#[tauri::command]
pub async fn fetch_models(
    state: tauri::State<'_, State>,
    profile_id: String,
    service_id: Option<String>,
    base_url: String,
    protocol: String,
    key: Option<String>,
) -> Result<Vec<String>, String> {
    store::validate_url(&base_url)?;
    if !["responses", "chat", "anthropic", "gemini"].contains(&protocol.as_str()) {
        return Err("接口格式无效".into());
    }
    let profile = state.0.store.lock().unwrap().profile(&profile_id)?;
    let key = match key.filter(|s| !s.is_empty()) {
        Some(key) => key,
        None => {
            let id = service_id.ok_or("请填写 API Key")?;
            // Never forward a stored credential to an edited endpoint.
            let original_url = {
                let s = state.0.store.lock().unwrap();
                s.data["services"][&profile_id]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|e| e["id"] == id)
                    .and_then(|e| e["base_url"].as_str())
                    .unwrap_or("")
                    .to_string()
            };
            if original_url != base_url {
                return Err("API 请求地址已更改，请填写对应密钥".into());
            }
            service_key(&state.0, &profile_id, &id)?
        }
    };
    if key.trim().is_empty() {
        return Err("请填写 API Key".into());
    }
    let base = base_url.trim_end_matches('/');
    let endpoint = if protocol == "gemini" {
        format!(
            "{}/models",
            if base.ends_with("/v1beta") || base.ends_with("/v1") {
                base.to_string()
            } else {
                format!("{base}/v1beta")
            }
        )
    } else if protocol == "anthropic" && !base.ends_with("/v1") {
        format!("{base}/v1/models")
    } else {
        format!("{base}/models")
    };
    let builder = crate::network::builder(profile.proxy, profile.proxy_port)?
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30));
    let client = builder.build().map_err(|_| "无法创建模型查询连接")?;
    let req = client.get(endpoint);
    let req = match protocol.as_str() {
        "anthropic" => req
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01"),
        "gemini" => req.header("x-goog-api-key", &key),
        _ => req.bearer_auth(&key),
    };
    let response = req
        .send()
        .await
        .map_err(|_| "获取模型失败，请检查 API 请求地址、密钥和本机代理")?;
    if !response.status().is_success() {
        return Err(format!(
            "获取模型失败（HTTP {}），请检查接口权限和请求地址",
            response.status().as_u16()
        ));
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "读取模型列表失败")?;
        if body.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("模型列表响应过大".into());
        }
        body.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&body).map_err(|_| "接口未返回有效的模型列表 JSON")?;
    let ids = model_ids(&value, &protocol);
    if ids.is_empty() {
        return Err("接口未返回可用模型，可手动填写模型名称".into());
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn universal_uses_each_tool_native_protocol_without_changing_source() {
        let entry = json!({"id":"a".repeat(32),"tool":"codex","scope":"universal","protocol":"responses","base_url":"https://example.com/v1","model":"test"});
        for tool in store::TOOLS {
            let selected = apply_service(&store::Profile::default(), &entry, tool).unwrap();
            assert_eq!(selected.protocol, protocol_for_tool(tool).unwrap());
            assert_eq!(selected.active_api, "a".repeat(32));
        }
        assert_eq!(entry["protocol"], "responses");
        let cli = json!({"tool":"codex", "protocol":"responses"});
        assert!(apply_service(&store::Profile::default(), &cli, "claude").is_err());
    }
    #[test]
    fn extracts_and_deduplicates_model_ids() {
        assert_eq!(
            model_ids(
                &json!({"data":[{"id":"b"},{"id":"a"},{"id":"b"},{}]}),
                "chat"
            ),
            vec!["a", "b"]
        );
        assert_eq!(
            model_ids(&json!({"models":[{"name":"models/gemini-test"}]}), "gemini"),
            vec!["gemini-test"]
        );
        assert!(validate_icon("data:image/svg+xml;base64,anything").is_err());
        assert!(validate_icon("https://example.com/logo.png").is_err());
    }
}
