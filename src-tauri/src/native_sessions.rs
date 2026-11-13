//! Read-only native CLI metadata. No authentication material crosses the IPC boundary.
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default()).join(".codex")
        })
}

fn config(home: &Path) -> toml::Value {
    fs::read_to_string(home.join("config.toml"))
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(toml::Value::Table(Default::default()))
}

pub fn detected_config(home: &Path) -> Value {
    let c = config(home);
    let provider = c
        .get("model_provider")
        .and_then(|v| v.as_str())
        .unwrap_or("openai");
    let entry = c.get("model_providers").and_then(|v| v.get(provider));
    // URL credentials and query strings must never be displayed.
    let endpoint = entry
        .and_then(|v| v.get("base_url"))
        .and_then(|v| v.as_str())
        .and_then(|s| url::Url::parse(s).ok())
        .map(|mut u| {
            let _ = u.set_username("");
            let _ = u.set_password(None);
            u.set_query(None);
            u.set_fragment(None);
            u.to_string()
        });
    json!({"detected":home.join("config.toml").is_file(), "provider":provider,
        "name":entry.and_then(|v|v.get("name")).and_then(|v|v.as_str()).unwrap_or(provider),
        "model":c.get("model").and_then(|v|v.as_str()).unwrap_or(""), "endpoint":endpoint})
}

#[tauri::command]
pub async fn native_tool_config(
    state: tauri::State<'_, crate::State>,
    profile_id: String,
) -> Result<Value, String> {
    let p = state.0.store.lock().unwrap().profile(&profile_id)?;
    if !p.is_local() {
        return Ok(Value::Null);
    }
    tokio::task::spawn_blocking(|| detected_config(&codex_home()))
        .await
        .map_err(|e| e.to_string())
}

pub fn titles(home: &Path) -> HashMap<String, String> {
    let mut result = HashMap::new();
    if let Ok(raw) = fs::read_to_string(home.join("session_index.jsonl")) {
        for line in raw.lines() {
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                if let (Some(id), Some(title)) = (v["id"].as_str(), v["thread_name"].as_str()) {
                    if !title.trim().is_empty() {
                        result.insert(id.into(), title.into());
                    }
                }
            }
        }
    }
    let c = config(home);
    let db_home = c
        .get("sqlite_home")
        .and_then(|v| v.as_str())
        .map(|s| {
            let p = PathBuf::from(s);
            if p.is_absolute() {
                p
            } else {
                home.join(p)
            }
        })
        .unwrap_or_else(|| home.into());
    let mut databases: Vec<_> = fs::read_dir(db_home)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("state_") && n.ends_with(".sqlite"))
        })
        .collect();
    databases.sort();
    for path in databases {
        if let Ok(db) = rusqlite::Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            let _ = db.busy_timeout(std::time::Duration::from_millis(100));
            if let Ok(mut stmt) = db.prepare("SELECT id,title FROM threads WHERE title IS NOT NULL AND trim(title) <> '' AND title <> coalesce(first_user_message,'')") {
                if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))) {
                    for (id,title) in rows.flatten() { result.insert(id,title); }
                }
            }
        }
    }
    result
}

pub fn generation(path: &Path) -> Option<u64> {
    let n = path
        .file_name()?
        .to_str()?
        .strip_suffix(".zstd")
        .unwrap_or(path.file_name()?.to_str()?);
    if n == "session.jsonl" {
        return Some(0);
    }
    n.strip_prefix("session.v")?
        .strip_suffix(".jsonl")?
        .parse()
        .ok()
}

pub fn read_log(path: &Path) -> Result<Vec<u8>, String> {
    const LIMIT: u64 = 128 * 1024 * 1024;
    let mut bytes = vec![];
    fs::File::open(path)
        .and_then(|f| f.take(LIMIT + 1).read_to_end(&mut bytes))
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("会话文件超过 128 MiB，已跳过".into());
    }
    if path.extension().is_none_or(|s| s != "zstd") {
        return Ok(bytes);
    }
    let mut output = vec![];
    let mut offset = 0;
    while offset < bytes.len() {
        let frame = &bytes[offset..];
        let size = match zstd::zstd_safe::find_frame_compressed_size(frame) {
            Ok(n) => n,
            Err(_) if frame.len() < 4 || frame.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) => break,
            Err(_) => return Err("Harness 压缩日志损坏".into()),
        };
        zstd::stream::read::Decoder::new(&frame[..size])
            .map_err(|e| e.to_string())?
            .take(LIMIT + 1 - output.len() as u64)
            .read_to_end(&mut output)
            .map_err(|e| e.to_string())?;
        if output.len() as u64 > LIMIT {
            return Err("Harness 解压数据超过 128 MiB，已跳过".into());
        }
        offset += size;
    }
    Ok(output)
}

fn number(v: &Value) -> u64 {
    v.as_u64().unwrap_or(0)
}
fn timestamp(v: &Value) -> f64 {
    v.as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.timestamp_millis() as f64 / 1000.0)
        .unwrap_or_else(|| v.as_f64().unwrap_or(0.0) / 1000.0)
}

pub fn usage(events: &[Value], tool: &str, fallback_id: &str) -> Vec<Value> {
    let (mut provider, mut model, mut session) =
        (String::new(), String::new(), fallback_id.to_string());
    let mut previous = Value::Null;
    let mut continuation = false;
    let mut rows = BTreeMap::new();
    for e in events {
        let p = &e["payload"];
        if e["type"] == "session_meta" {
            provider = p["model_provider"].as_str().unwrap_or("").into();
            session = p["id"].as_str().unwrap_or(fallback_id).into();
            continuation = p["history_mode"] == "paginated"
                || !p["history_base"].is_null()
                || !p["forked_from_id"].is_null();
        }
        if e["type"] == "turn_context" {
            model = p["model"].as_str().unwrap_or("").into();
        }
        let (id, when, input, output, cached, write) =
            if tool == "codex" && e["type"] == "event_msg" && p["type"] == "token_count" {
                let info = &p["info"];
                let total = &info["total_token_usage"];
                let last = &info["last_token_usage"];
                if !total.is_null() && *total == previous {
                    continue;
                }
                if continuation && previous.is_null() && !last.is_object() {
                    previous = total.clone();
                    continue;
                }
                let reset = ["input_tokens", "output_tokens"]
                    .iter()
                    .any(|k| number(&total[k]) < number(&previous[k]));
                let delta = |k: &str| {
                    if last.is_object() {
                        number(&last[k])
                    } else if reset {
                        number(&total[k])
                    } else {
                        number(&total[k]).saturating_sub(number(&previous[k]))
                    }
                };
                let cached = delta("cached_input_tokens");
                let values = (
                    format!(
                        "{session}:{}:{}",
                        e["timestamp"],
                        if total.is_null() { last } else { total }
                    ),
                    timestamp(&e["timestamp"]),
                    delta("input_tokens").saturating_sub(cached),
                    delta("output_tokens"),
                    cached,
                    0,
                );
                if total.is_object() {
                    previous = total.clone();
                }
                values
            } else if tool == "harness" && e["type"] == "assistant/message" {
                let data = &e["data"];
                let m = &data["message"];
                let u = &data["usage"];
                provider = m["source"]["provider"].as_str().unwrap_or("").into();
                model = m["source"]["model"].as_str().unwrap_or("").into();
                (
                    format!(
                        "{session}:{}",
                        m["id"]
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| format!("{}:{}", data["turn"], data["step"]))
                    ),
                    timestamp(&e["time"]),
                    number(&u["inputTokens"]),
                    number(&u["outputTokens"]),
                    number(&u["cacheReadTokens"]),
                    number(&u["cacheWriteTokens"]),
                )
            } else if tool == "claude" && e["type"] == "assistant" {
                let m = &e["message"];
                let u = &m["usage"];
                model = m["model"].as_str().unwrap_or("").into();
                (
                    m["id"]
                        .as_str()
                        .or(e["uuid"].as_str())
                        .unwrap_or(fallback_id)
                        .to_string(),
                    timestamp(&e["timestamp"]),
                    number(&u["input_tokens"]),
                    number(&u["output_tokens"]),
                    number(&u["cache_read_input_tokens"]),
                    number(&u["cache_creation_input_tokens"]),
                )
            } else {
                continue;
            };
        if input + output + cached + write == 0 {
            continue;
        }
        rows.insert(id.clone(),json!({"id":id,"tool":tool,"timestamp":when,"provider":if provider.is_empty(){"会话日志"}else{&provider},"model":if model.is_empty(){"unknown"}else{&model},"input":input,"output":output,"cached":cached,"write":write,"cost":null}));
    }
    rows.into_values().collect()
}

pub fn aggregate(files: &Value, params: &Value) -> Value {
    let start = params["start"].as_f64().unwrap_or(0.0);
    let end = params["end"].as_f64().unwrap_or(0.0);
    let mut unique = BTreeMap::new();
    for f in files["files"].as_array().into_iter().flatten() {
        for row in f["usageRows"].as_array().into_iter().flatten() {
            unique.insert(format!("{}:{}", row["tool"], row["id"]), row.clone());
        }
    }
    let mut rows: Vec<_> = unique
        .into_values()
        .filter(|r| {
            r["timestamp"]
                .as_f64()
                .is_some_and(|t| t >= start && t < end)
        })
        .collect();
    let mut options = json!({});
    for k in ["provider", "model"] {
        options[k] = json!(rows
            .iter()
            .filter_map(|r| r[k].as_str())
            .collect::<BTreeSet<_>>());
    }
    rows.retain(|r| {
        ["tool", "provider", "model"]
            .iter()
            .all(|k| params[k].as_str().is_none_or(|s| s.is_empty() || r[k] == s))
    });
    crate::usage_pricing::price_rows(
        &mut rows,
        params["rates"].as_array().map(Vec::as_slice).unwrap_or(&[]),
    );
    let mut totals = json!({"requests":rows.len(),"cost":null,"priced":0});
    let known: Vec<f64> = rows.iter().filter_map(|r| r["cost"].as_f64()).collect();
    totals["priced"] = json!(known.len());
    totals["estimated"] = json!(rows
        .iter()
        .filter(|r| r["cost_source"] == "estimated")
        .count());
    totals["recorded"] = json!(rows
        .iter()
        .filter(|r| r["cost_source"] == "recorded")
        .count());
    totals["unpriced"] = json!(rows.len() - known.len());
    if !known.is_empty() || rows.is_empty() {
        totals["cost"] = json!(known.iter().sum::<f64>());
    }
    for k in ["input", "output", "cached", "write"] {
        totals[k] = json!(rows.iter().map(|r| number(&r[k])).sum::<u64>());
    }
    let bucket = if end - start <= 86400.0 {
        3600.0
    } else {
        86400.0
    };
    let mut trend = vec![
        0u64;
        if start == 0.0 {
            0
        } else {
            ((end - start) / bucket).ceil() as usize
        }
    ];
    let offset = params["timezone_offset"].as_i64().unwrap_or(0) as f64;
    let mut daily: BTreeMap<String, Value> = BTreeMap::new();
    let mut groups: BTreeMap<(String, String), (u64, u64)> = BTreeMap::new();
    for r in &rows {
        let tokens = ["input", "output", "cached", "write"]
            .iter()
            .map(|k| number(&r[k]))
            .sum::<u64>();
        let index = ((r["timestamp"].as_f64().unwrap() - start) / bucket) as usize;
        if let Some(date) =
            chrono::DateTime::from_timestamp((r["timestamp"].as_f64().unwrap() + offset) as i64, 0)
        {
            let day = date.format("%Y-%m-%d").to_string();
            let entry = daily
                .entry(day.clone())
                .or_insert(json!({"date":day,"tokens":0,"requests":0}));
            entry["tokens"] = json!(entry["tokens"].as_u64().unwrap() + tokens);
            entry["requests"] = json!(entry["requests"].as_u64().unwrap() + 1);
        }
        if let Some(n) = trend.get_mut(index) {
            *n += tokens;
        }
        let entry = groups
            .entry((
                r["provider"].as_str().unwrap().into(),
                r["model"].as_str().unwrap().into(),
            ))
            .or_default();
        entry.0 += 1;
        entry.1 += tokens;
    }
    rows.sort_by(|a, b| {
        b["timestamp"]
            .as_f64()
            .partial_cmp(&a["timestamp"].as_f64())
            .unwrap()
    });
    let page = params["page"].as_u64().unwrap_or(0) as usize;
    json!({"totals":totals,"options":options,"rows":rows.into_iter().skip(page.saturating_mul(50)).take(50).collect::<Vec<_>>(),"warnings":files["warnings"],
        "daily":daily.into_values().collect::<Vec<_>>(),
        "trend":trend.into_iter().enumerate().map(|(index,tokens)|json!({"index":index,"tokens":tokens})).collect::<Vec<_>>(),
        "groups":groups.into_iter().map(|((provider,model),(requests,tokens))|json!({"provider":provider,"model":model,"requests":requests,"tokens":tokens})).collect::<Vec<_>>()})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_time_heatmap_keeps_all_records_and_uses_calendar_offset() {
        let rows = json!([{"id":"old","tool":"codex","timestamp":1704065400.0,"provider":"test","model":"test","input":10,"output":2,"cached":0,"write":0,"cost":null}, {"id":"new","tool":"codex","timestamp":1794528000.0,"provider":"test","model":"test","input":30,"output":4,"cached":0,"write":0,"cost":null}]);
        let result = aggregate(
            &json!({"files":[{"usageRows":rows}],"warnings":[]}),
            &json!({"start":0.0,"end":1800000000.0,"timezone_offset":28800}),
        );
        assert_eq!(result["totals"]["requests"], 2);
        assert_eq!(result["totals"]["input"], 40);
        assert_eq!(result["daily"][0]["date"], "2024-01-01");
        assert_eq!(result["daily"][0]["tokens"], 12);
        assert_eq!(result["daily"].as_array().unwrap().len(), 2);
        assert!(result["trend"].as_array().unwrap().is_empty());
    }
    #[test]
    fn codex_counts_deltas_cache_and_duplicate_events() {
        let events = vec![
            json!({"type":"session_meta","payload":{"id":"test","model_provider":"codelink"}}),
            json!({"type":"turn_context","payload":{"model":"gpt-test"}}),
            json!({"type":"event_msg","timestamp":"2026-11-12T00:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":10}}}}),
            json!({"type":"event_msg","timestamp":"2026-11-12T00:00:01Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":10}}}}),
            json!({"type":"event_msg","timestamp":"2026-11-12T00:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":160,"cached_input_tokens":40,"output_tokens":30}}}}),
        ];
        let rows = usage(&events, "codex", "test");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["input"], 80);
        assert_eq!(rows[1]["input"], 40);
        assert_eq!(rows[1]["output"], 20);
        assert_eq!(rows[1]["cached"], 20);
        let result = aggregate(
            &json!({"files":[{"usageRows":rows.clone()},{"usageRows":rows}],"warnings":[]}),
            &json!({"start":1794441600.0,"end":1794528000.0}),
        );
        assert_eq!(result["totals"]["requests"], 2);
        assert_eq!(result["totals"]["input"], 120);
        assert_eq!(result["totals"]["cost"], Value::Null);
    }
    #[test]
    fn config_allowlist_and_native_title_sources() {
        let home = std::env::temp_dir().join(crate::store::new_id());
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("config.toml"), "model_provider='custom'\nmodel='test'\napi_key='secret'\n[model_providers.custom]\nname='Custom'\nbase_url='https://user:secret@example.com/v1?api_key=secret'\n").unwrap();
        let value = detected_config(&home);
        assert_eq!(value["endpoint"], "https://example.com/v1");
        assert!(!value.to_string().contains("secret"));
        fs::write(
            home.join("session_index.jsonl"),
            "{\"id\":\"test\",\"thread_name\":\"Index title\"}\n{partial",
        )
        .unwrap();
        let db = rusqlite::Connection::open(home.join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE threads (id TEXT, title TEXT, first_user_message TEXT); INSERT INTO threads VALUES ('test','Renamed title','First user');").unwrap();
        drop(db);
        assert_eq!(titles(&home)["test"], "Renamed title");
        fs::remove_dir_all(home).unwrap();
    }
    #[test]
    fn compressed_frames_ignore_live_incomplete_tail() {
        let root = std::env::temp_dir().join(crate::store::new_id());
        fs::create_dir_all(&root).unwrap();
        let mut bytes = zstd::encode_all(b"header\n".as_slice(), 1).unwrap();
        bytes.extend(zstd::encode_all(b"body\n".as_slice(), 1).unwrap());
        let tail = zstd::encode_all(b"unfinished\n".as_slice(), 1).unwrap();
        bytes.extend(&tail[..tail.len() / 2]);
        let path = root.join("session.v4.jsonl.zstd");
        fs::write(&path, bytes).unwrap();
        assert_eq!(read_log(&path).unwrap(), b"header\nbody\n");
        assert_eq!(generation(&path), Some(4));
        fs::remove_dir_all(root).unwrap();
    }
}
