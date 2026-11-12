use crate::{store::Profile, State};
use serde_json::{json, Value};
use std::{fs, io::Read, path::PathBuf, time::UNIX_EPOCH};

fn local_roots() -> Vec<(&'static str, PathBuf)> {
    let home = PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default());
    let env_path = |name, fallback| {
        std::env::var_os(name)
            .map(PathBuf::from)
            .unwrap_or(fallback)
    };
    let codex = env_path("CODEX_HOME", home.join(".codex"));
    let claude = env_path("CLAUDE_CONFIG_DIR", home.join(".claude"));
    let gemini = env_path("GEMINI_CLI_HOME", home.clone()).join(".gemini/tmp");
    let harness = env_path("DSH_HOME", home.join(".dsh"));
    let data = env_path("XDG_DATA_HOME", home.join(".local/share"));
    vec![
        ("codex", codex.join("sessions")),
        ("codex", codex.join("archived_sessions")),
        ("claude", claude.join("projects")),
        ("gemini", gemini),
        ("harness", harness.join("sessions")),
        ("opencode", data.join("opencode/storage/session")),
    ]
}

fn scan(roots: Vec<(&str, PathBuf)>, key: Option<&str>) -> Result<Value, String> {
    let mut files = Vec::new();
    let mut warnings = vec!["OpenCode SQLite 与 Harness 压缩日志暂不支持阅读"];
    for (index, (tool, root)) in roots.iter().enumerate() {
        let Ok(base) = root.canonicalize() else {
            continue;
        };
        let mut stack = vec![base.clone()];
        let mut visited = 0;
        while let Some(dir) = stack.pop() {
            visited += 1;
            if visited > 10000 {
                warnings.push("部分会话目录超过扫描上限");
                break;
            }
            let Ok(entries) = fs::read_dir(dir) else {
                warnings.push("部分会话目录无法读取");
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(meta) = fs::symlink_metadata(&path) else {
                    continue;
                };
                if meta.file_type().is_symlink() {
                    continue;
                }
                let Ok(real) = path.canonicalize() else {
                    continue;
                };
                if !real.starts_with(&base) {
                    continue;
                }
                if meta.is_dir() {
                    stack.push(real);
                    continue;
                }
                if ![Some("json"), Some("jsonl")]
                    .contains(&path.extension().and_then(|s| s.to_str()))
                {
                    continue;
                }
                if *tool == "gemini" && !entry.file_name().to_string_lossy().starts_with("session-")
                {
                    continue;
                }
                let source = format!(
                    "{index}/{}",
                    path.strip_prefix(&base)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/")
                );
                if key.is_some_and(|k| k != source) {
                    continue;
                }
                let limit = if key.is_some() { 1024 * 1024 } else { 4096 };
                let mut bytes = Vec::new();
                if fs::File::open(&real)
                    .and_then(|f| f.take(limit + 1).read_to_end(&mut bytes))
                    .is_err()
                {
                    warnings.push("部分会话文件无法读取");
                    continue;
                }
                let truncated = bytes.len() > limit as usize;
                bytes.truncate(limit as usize);
                files.push(json!({"key":source,"tool":tool,"modified":meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_secs_f64()).unwrap_or(0.0),"text":String::from_utf8_lossy(&bytes),"truncated":truncated}));
                if key.is_some() {
                    return Ok(json!({"files":files,"warnings":warnings}));
                }
                if files.len() >= 200 {
                    warnings.push("会话较多，仅显示扫描到的前 200 条");
                    return Ok(json!({"files":files,"warnings":warnings}));
                }
            }
        }
    }
    if key.is_some() {
        return Err("会话不存在或不属于当前环境".into());
    }
    Ok(json!({"files":files,"warnings":warnings}))
}

fn text_content(value: &Value) -> String {
    if let Some(s) = value.as_str() {
        return s.to_string();
    }
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn parse(file: &Value, p: &Profile, scope: &str) -> Value {
    let raw = file["text"].as_str().unwrap_or("");
    let mut events: Vec<Value> = match serde_json::from_str::<Value>(raw) {
        Ok(v) => v["messages"].as_array().cloned().unwrap_or_else(|| vec![v]),
        Err(_) => raw
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect(),
    };
    if file["tool"] == "gemini" {
        let mut metadata = Vec::new();
        let mut messages: Vec<Value> = Vec::new();
        for event in events {
            if let Some(id) = event["$rewindTo"].as_str() {
                let position = messages.iter().position(|m| m["id"] == id).unwrap_or(0);
                messages.truncate(position);
            } else if event["id"].is_string() {
                if let Some(old) = messages.iter_mut().find(|m| m["id"] == event["id"]) {
                    *old = event;
                } else {
                    messages.push(event);
                }
            } else if event["$set"].is_object() {
                if let Some(replacement) = event["$set"]["messages"].as_array() {
                    messages = replacement.clone();
                }
                metadata.push(event["$set"].clone());
            } else {
                metadata.push(event);
            }
        }
        metadata.extend(messages);
        events = metadata;
    }
    let mut messages = Vec::new();
    let mut id = String::new();
    let mut project = String::new();
    let mut title = String::new();
    let mut pending_steps: Vec<Value> = Vec::new();
    let mut model = String::new();
    for event in &events {
        if event["type"] == "turn_context" {
            model = event["payload"]["model"].as_str().unwrap_or("").into();
        }
        if id.is_empty() {
            id = event["sessionId"]
                .as_str()
                .or(event["sessionID"].as_str())
                .unwrap_or("")
                .into();
            if id.is_empty() && file["tool"] == "opencode" {
                id = event["id"].as_str().unwrap_or("").into();
            }
        }
        if title.is_empty() {
            title = event["title"].as_str().unwrap_or("").into();
        }
        if project.is_empty() {
            project = event["cwd"]
                .as_str()
                .or(event["directory"].as_str())
                .unwrap_or("")
                .into();
        }
        if event["type"] == "session_meta" {
            id = event["payload"]["id"].as_str().unwrap_or("").into();
            project = event["payload"]["cwd"].as_str().unwrap_or("").into();
        }
        if ["session", "header"].contains(&event["type"].as_str().unwrap_or("")) {
            id = event["id"].as_str().unwrap_or("").into();
        }
        let message = if event["type"] == "response_item" {
            &event["payload"]
        } else if event["message"].is_object() {
            &event["message"]
        } else if event["data"]["message"].is_object() {
            &event["data"]["message"]
        } else if event["type"] == "user/message" {
            &event["data"]
        } else {
            event
        };
        let role = message["role"]
            .as_str()
            .or(message["type"].as_str())
            .unwrap_or("");
        let role = if role == "gemini" || event["type"] == "assistant/message" {
            "assistant"
        } else if event["type"] == "user/message" {
            "user"
        } else {
            role
        };
        let kind = message["type"].as_str().unwrap_or("");
        if ["function_call", "custom_tool_call"].contains(&kind) {
            pending_steps.push(json!({"name":message["name"].as_str().unwrap_or("tool"),
                "content":message["arguments"].as_str().or(message["input"].as_str()).unwrap_or("")}));
            continue;
        }
        if ["function_call_output", "custom_tool_call_output"].contains(&kind) {
            if let Some(step) = pending_steps.last_mut() {
                let output = message["output"].as_str().unwrap_or("");
                step["content"] = json!(format!(
                    "{}\n\n{}",
                    step["content"].as_str().unwrap_or(""),
                    output
                ));
            }
            continue;
        }
        for block in message["content"].as_array().into_iter().flatten() {
            if ["tool_use", "tool-call"].contains(&block["type"].as_str().unwrap_or("")) {
                pending_steps.push(json!({"name":block["name"].as_str().unwrap_or("tool"),"content":block.get("input").or(block.get("arguments")).map(|v| if let Some(s)=v.as_str(){s.to_string()}else{v.to_string()}).unwrap_or_default()}));
            }
        }
        if !["user", "assistant"].contains(&role) {
            continue;
        }
        if role == "user" && !pending_steps.is_empty() {
            messages.push(
                json!({"role":"assistant","content":"","steps":std::mem::take(&mut pending_steps)}),
            );
        }
        let content = text_content(
            message
                .get("content")
                .or(message.get("text"))
                .unwrap_or(&Value::Null),
        );
        if content.is_empty() {
            continue;
        }
        if title.is_empty() && role == "user" {
            title = content.chars().take(100).collect();
        }
        let steps = if role == "assistant" {
            std::mem::take(&mut pending_steps)
        } else {
            Vec::new()
        };
        let timestamp = event["timestamp"].as_str().map(String::from).or_else(|| {
            event["time"].as_i64().and_then(|ms| {
                chrono::DateTime::from_timestamp_millis(ms).map(|time| time.to_rfc3339())
            })
        });
        messages.push(
            json!({"role":role,"content":content,"steps":steps,"timestamp":timestamp,
            "model":message["model"].as_str().unwrap_or(&model)}),
        );
    }
    if !pending_steps.is_empty() {
        messages.push(json!({"role":"assistant","content":"","steps":pending_steps}));
    }
    let key = file["key"].as_str().unwrap_or("");
    let tool = file["tool"].as_str().unwrap_or("");
    if id.is_empty() && tool == "gemini" {
        if let Ok(v) = serde_json::from_str::<Value>(raw) {
            id = v["sessionId"].as_str().unwrap_or("").into();
        }
    }
    let safe_id = !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b));
    let mut resume = String::new();
    let source_index = key.split('/').next().and_then(|s| s.parse::<usize>().ok());
    let same_home = p.is_local()
        || match tool {
            "codex" => {
                if p.codex_auth == "chatgpt" {
                    matches!(source_index, Some(1 | 3))
                } else {
                    matches!(source_index, Some(0 | 2))
                }
            }
            "claude" => {
                if p.tool_services.get(tool).is_none_or(|id| id == "official") {
                    source_index == Some(5)
                } else {
                    source_index == Some(4)
                }
            }
            "gemini" => {
                if p.tool_services.get(tool).is_none_or(|id| id == "official") {
                    source_index == Some(7)
                } else {
                    source_index == Some(6)
                }
            }
            "opencode" => {
                if p.tool_services.get(tool).is_none_or(|id| id == "official") {
                    source_index == Some(10)
                } else {
                    source_index == Some(9)
                }
            }
            _ => false,
        };
    if safe_id && same_home && ["codex", "claude", "gemini", "opencode"].contains(&tool) {
        let args = match tool {
            "codex" => format!("resume {id}"),
            "opencode" => format!("--session {id}"),
            _ => format!("--resume {id}"),
        };
        resume = if p.is_local() {
            format!("{tool} {args}")
        } else {
            format!("python3 ~/.local/share/edge-ssh-ai/{scope}/run-{tool}.py {args}")
        };
    }
    json!({"key":key,"tool":tool,"id":id,"title":if title.is_empty(){key.to_string()}else{title},"project":project,"modified":file["modified"],"messages":messages,"truncated":file["truncated"],"resume":resume})
}

#[tauri::command]
pub async fn query_sessions(
    state: tauri::State<'_, State>,
    profile_id: String,
    key: Option<String>,
) -> Result<Value, String> {
    let (p, scope) = {
        let s = state.0.store.lock().unwrap();
        (s.profile(&profile_id)?, s.scope(&profile_id))
    };
    let result = if p.is_local() {
        let requested = key.clone();
        tokio::task::spawn_blocking(move || scan(local_roots(), requested.as_deref()))
            .await
            .map_err(|e| e.to_string())??
    } else {
        state
            .0
            .call(&p, &scope, "session_files", json!({"key":key}), 60)
            .await?
    };
    let sessions: Vec<_> = result["files"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|f| parse(f, &p, &scope))
        .collect();
    Ok(json!({"sessions":sessions,"warnings":result["warnings"]}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_codex_messages_and_rejects_command_injection_in_session_ids() {
        let events = [
            json!({"type":"session_meta","payload":{"id":"safe-id","cwd":"/project"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Fix this"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Fixed"}]}}),
        ];
        let raw = events
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let mut file =
            json!({"key":"0/test.jsonl","tool":"codex","text":raw,"modified":1,"truncated":false});
        let p = Profile::local();
        let parsed = parse(&file, &p, "scope");
        assert_eq!(parsed["title"], "Fix this");
        assert_eq!(parsed["messages"].as_array().unwrap().len(), 2);
        assert_eq!(parsed["resume"], "codex resume safe-id");
        file["text"] = json!(raw.replace("safe-id", "bad;calc"));
        assert_eq!(parse(&file, &p, "scope")["resume"], "");
    }
    #[test]
    fn captures_tool_calls_with_following_reply_and_metadata() {
        let raw = [json!({"type":"session_meta","payload":{"id":"test","cwd":"/project"}}),
            json!({"type":"turn_context","payload":{"model":"test-model"}}),
            json!({"type":"response_item","payload":{"role":"user","content":[{"text":"Fix it"}]}}),
            json!({"type":"response_item","payload":{"type":"function_call","name":"apply_patch","arguments":"patch content"}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","output":"success"}}),
            json!({"type":"response_item","timestamp":"2026-11-12T06:00:00Z","payload":{"role":"assistant","content":[{"text":"Done"}]}})]
            .iter().map(Value::to_string).collect::<Vec<_>>().join("\n");
        let parsed = parse(
            &json!({"key":"0/test.jsonl","tool":"codex","text":raw}),
            &Profile::local(),
            "scope",
        );
        assert_eq!(parsed["messages"][1]["steps"][0]["name"], "apply_patch");
        assert_eq!(
            parsed["messages"][1]["steps"][0]["content"],
            "patch content\n\nsuccess"
        );
        assert_eq!(parsed["messages"][1]["model"], "test-model");
        assert_eq!(parsed["messages"][1]["timestamp"], "2026-11-12T06:00:00Z");
    }
    #[test]
    fn reads_harness_native_user_and_assistant_messages() {
        let raw = [json!({"type":"session","id":"test","cwd":"/project"}),
            json!({"type":"user/message","data":{"role":"user","content":[{"type":"text","text":"Question"}]}}),
            json!({"type":"assistant/message","data":{"message":{"content":[{"type":"text","text":"Answer"}]}}})]
            .iter().map(Value::to_string).collect::<Vec<_>>().join("\n");
        let parsed = parse(
            &json!({"key":"4/test.jsonl","tool":"harness","text":raw}),
            &Profile::local(),
            "scope",
        );
        assert_eq!(parsed["id"], "test");
        assert_eq!(parsed["title"], "Question");
        assert_eq!(parsed["messages"][1]["content"], "Answer");
    }
    #[test]
    fn gemini_revisions_replace_messages_and_rewinds_remove_discarded_turns() {
        let raw = [
            json!({"sessionId":"gemini-test"}),
            json!({"id":"u","type":"user","content":"Question"}),
            json!({"id":"a","type":"gemini","content":"Partial"}),
            json!({"id":"a","type":"gemini","content":"Complete"}),
            json!({"id":"discarded","type":"user","content":"Discarded"}),
            json!({"$rewindTo":"discarded"}),
        ]
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n");
        let parsed = parse(
            &json!({"key":"3/test.jsonl","tool":"gemini","text":raw}),
            &Profile::local(),
            "scope",
        );
        assert_eq!(parsed["id"], "gemini-test");
        assert_eq!(parsed["messages"].as_array().unwrap().len(), 2);
        assert_eq!(parsed["messages"][1]["content"], "Complete");
    }
    #[test]
    fn scan_restricts_reads_to_session_roots_and_reports_truncation() {
        let dir = std::env::temp_dir().join(crate::store::new_id());
        let root = dir.join("sessions");
        fs::create_dir_all(&root).unwrap();
        fs::write(dir.join("auth.json"), "secret").unwrap();
        fs::write(root.join("test.jsonl"), "x".repeat(8192)).unwrap();
        let listing = scan(vec![("codex", root.clone())], None).unwrap();
        assert_eq!(listing["files"].as_array().unwrap().len(), 1);
        assert_eq!(listing["files"][0]["truncated"], true);
        assert!(scan(vec![("codex", root.clone())], Some("0/../auth.json")).is_err());
        let detail = scan(vec![("codex", root)], Some("0/test.jsonl")).unwrap();
        assert_eq!(detail["files"][0]["truncated"], false);
        assert_eq!(detail["files"][0]["text"].as_str().unwrap().len(), 8192);
        fs::remove_dir_all(dir).unwrap();
    }
}
