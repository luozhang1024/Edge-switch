use crate::{store, store::Profile};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

pub fn home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or("无法定位用户目录".into())
}
pub fn kimi_home() -> Result<PathBuf, String> {
    Ok(std::env::var_os("KIMI_SHARE_DIR")
        .map(PathBuf::from)
        .unwrap_or(home()?.join(".kimi")))
}
pub fn prompt_path(tool: &str) -> Result<PathBuf, String> {
    Ok(match tool {
        "kimi" => kimi_home()?.join("edge-switch/AGENTS.md"),
        "grok" => home()?.join(".grok/edge-switch-prompt.md"),
        _ => return Err("工具无效".into()),
    })
}
fn read_json(path: &std::path::Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "工具配置 JSON 无效，原文件已保留")?;
    if !value.is_object() {
        return Err("工具配置必须为 JSON 对象".into());
    }
    Ok(value)
}
pub fn backup_write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    if path.exists() {
        let original = fs::read(path).map_err(|e| e.to_string())?;
        if original == bytes {
            return Ok(());
        }
        store::atomic_write(
            &path.with_extension(format!("edge-switch-{}.bak", store::new_id())),
            &original,
        )?;
    }
    store::atomic_write(path, bytes)
}
pub fn configure_local(tool: &str, payload: &Value) -> Result<(), String> {
    let base = payload["base_url"].as_str().ok_or("供应商地址缺失")?;
    let model = payload["model"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or("请填写模型 ID")?;
    let key = payload["key"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or("请先保存供应商密钥")?;
    if tool == "kimi" {
        let path = kimi_home()?.join("config.toml");
        let mut config: toml::Value = if path.exists() {
            toml::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
                .map_err(|_| "Kimi TOML 配置无效")?
        } else {
            toml::Value::Table(Default::default())
        };
        let root = config.as_table_mut().ok_or("Kimi 配置无效")?;
        let protocol = if payload["protocol"] == "anthropic" {
            "anthropic"
        } else {
            "openai_legacy"
        };
        for (name, entry) in [
            (
                "providers",
                json!({"type":protocol,"base_url":base,"api_key":key}),
            ),
            (
                "models",
                json!({"provider":"edge-switch","model":model,"max_context_size":32768}),
            ),
        ] {
            let table = root
                .entry(name)
                .or_insert_with(|| toml::Value::Table(Default::default()))
                .as_table_mut()
                .ok_or("Kimi 配置表无效")?;
            table.insert(
                "edge-switch".into(),
                toml::Value::try_from(entry).map_err(|e| e.to_string())?,
            );
        }
        root.insert(
            "default_model".into(),
            toml::Value::String("edge-switch".into()),
        );
        return backup_write(
            &path,
            toml::to_string_pretty(&config)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        );
    }
    let path = home()?.join(if tool == "grok" {
        ".grok/user-settings.json"
    } else {
        ".qwen/settings.json"
    });
    let mut config = read_json(&path)?;
    if tool == "grok" {
        config["apiKey"] = json!(key);
        config["baseURL"] = json!(base);
        config["model"] = json!(model);
    } else if tool == "qwen" {
        if !config["security"].is_object() {
            config["security"] = json!({});
        }
        if !config["security"]["auth"].is_object() {
            config["security"]["auth"] = json!({});
        }
        config["security"]["auth"]["selectedType"] = json!("openai");
        if !config["model"].is_object() {
            config["model"] = json!({});
        }
        config["model"]["name"] = json!(model);
        if !config["modelProviders"].is_object() {
            config["modelProviders"] = json!({});
        }
        let models = config["modelProviders"]["openai"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut models: Vec<_> = models
            .into_iter()
            .filter(|v| v["envKey"] != "EDGE_QWEN_API_KEY")
            .collect();
        models.push(json!({"id":model,"baseUrl":base,"envKey":"EDGE_QWEN_API_KEY"}));
        config["modelProviders"]["openai"] = json!(models);
    } else {
        return Err("此工具使用官方账号，不支持 API 供应商".into());
    }
    backup_write(
        &path,
        &serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )
}

pub fn select_official(tool: &str) -> Result<(), String> {
    if tool == "qwen" {
        let path = home()?.join(".qwen/settings.json");
        let mut config = read_json(&path)?;
        if !config["security"].is_object() {
            config["security"] = json!({});
        }
        if !config["security"]["auth"].is_object() {
            config["security"]["auth"] = json!({});
        }
        config["security"]["auth"]["selectedType"] = json!("qwen-oauth");
        backup_write(
            &path,
            &serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
        )?;
    }
    if tool == "kimi" {
        let path = kimi_home()?.join("config.toml");
        if path.exists() {
            let mut config: toml::Value =
                toml::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
                    .map_err(|_| "Kimi 配置无效")?;
            if config.get("default_model").and_then(|v| v.as_str()) == Some("edge-switch") {
                let model = config
                    .get("models")
                    .and_then(|v| v.as_table())
                    .and_then(|m| m.keys().find(|k| *k != "edge-switch"))
                    .cloned()
                    .unwrap_or_default();
                config
                    .as_table_mut()
                    .ok_or("Kimi 配置无效")?
                    .insert("default_model".into(), toml::Value::String(model));
                backup_write(
                    &path,
                    toml::to_string_pretty(&config)
                        .map_err(|e| e.to_string())?
                        .as_bytes(),
                )?;
            }
        }
    }
    Ok(())
}

pub fn prepare_instructions(tool: &str) -> Result<Option<PathBuf>, String> {
    if tool == "kimi" {
        let prompt = fs::read_to_string(prompt_path(tool)?).unwrap_or_default();
        if prompt.trim().is_empty() {
            return Ok(None);
        }
        let path = kimi_home()?.join("edge-switch/agent.json");
        store::atomic_write(&path, json!({"version":1,"agent":{"extend":"default","system_prompt_args":{"ROLE_ADDITIONAL":prompt}}}).to_string().as_bytes())?;
        return Ok(Some(path));
    }
    if tool == "grok" {
        let directory = home()?.join(".grok");
        let mut text = fs::read_to_string(prompt_path(tool)?).unwrap_or_default();
        let skills = directory.join("skills");
        if skills.is_dir() {
            for entry in fs::read_dir(skills).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path().join("SKILL.md");
                if path.is_file() {
                    text.push_str(&format!(
                        "\n\n## Skill: {}\n{}",
                        path.display(),
                        fs::read_to_string(&path).map_err(|e| e.to_string())?
                    ));
                }
            }
        }
        let path = directory.join("GROK.md");
        let original = fs::read_to_string(&path).unwrap_or_default();
        let begin = "<!-- edge-switch:start -->";
        let end = "<!-- edge-switch:end -->";
        let mut preserved = original.clone();
        if let Some((prefix, tail)) = original.split_once(begin) {
            let (_, suffix) = tail
                .split_once(end)
                .ok_or("Grok 指令区块不完整，请检查 GROK.md")?;
            preserved = format!("{prefix}{suffix}");
        }
        let updated = if text.trim().is_empty() {
            preserved.trim_end().to_string()
        } else {
            format!("{}\n\n{begin}\n{text}\n{end}", preserved.trim_end())
        };
        if updated != original {
            backup_write(&path, updated.as_bytes())?;
        }
    }
    Ok(None)
}

pub fn configure_launch(
    command: &mut tokio::process::Command,
    p: &Profile,
    tool: &str,
) -> Result<(), String> {
    if !["kimi", "grok", "qwen", "copilot"].contains(&tool) {
        return Ok(());
    }
    if let Some(agent) = prepare_instructions(tool)? {
        command.env("EDGE_KIMI_AGENT", agent);
    }
    let _ = p;
    Ok(())
}
