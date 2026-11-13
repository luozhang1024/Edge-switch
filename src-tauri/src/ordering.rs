use crate::{store::Store, State};
use serde_json::json;
use std::collections::HashSet;

fn reorder(
    store: &mut Store,
    kind: &str,
    profile_id: Option<&str>,
    tool: Option<&str>,
    ids: Vec<String>,
) -> Result<(), String> {
    let (allowed, path): (HashSet<String>, Vec<String>) = match kind {
        "quick_launch" => (
            [
                "codex",
                "vscode",
                "harness",
                "ssh_console",
                "claude",
                "gemini",
                "opencode",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            vec!["quick_launch".into()],
        ),
        "profiles" => (
            store.data["profiles"]
                .as_array()
                .ok_or("环境列表无效")?
                .iter()
                .filter_map(|p| p["id"].as_str().map(String::from))
                .collect(),
            vec!["profiles".into()],
        ),
        "services" => {
            let pid = profile_id.ok_or("缺少环境")?;
            store.profile(pid)?;
            let tool = tool
                .filter(|t| crate::store::TOOLS.contains(t))
                .ok_or("工具无效")?;
            let mut allowed: HashSet<String> = store.data["services"][pid]
                .as_array()
                .ok_or("服务列表无效")?
                .iter()
                .filter(|s| {
                    s["scope"] == "universal" || s["tool"].as_str().unwrap_or("codex") == tool
                })
                .filter_map(|s| s["id"].as_str().map(String::from))
                .collect();
            if tool != "harness" {
                allowed.insert("official".into());
            } else if allowed.is_empty()
                && store.profile(pid)?.extra.get("hide_harness_default") != Some(&json!(true))
            {
                allowed.insert("default-api".into());
            }
            (allowed, vec!["services".into(), pid.into(), tool.into()])
        }
        _ => return Err("排序类型无效".into()),
    };
    let requested: HashSet<_> = ids.iter().cloned().collect();
    if requested.len() != ids.len() || requested != allowed {
        return Err("列表已变化，请重试排序".into());
    }
    let mut next = store.clone();
    if !next.data["list_order"].is_object() {
        next.data["list_order"] = json!({});
    }
    let mut value = &mut next.data["list_order"];
    for key in &path[..path.len() - 1] {
        if !value[key].is_object() {
            value[key] = json!({});
        }
        value = &mut value[key];
    }
    value[path.last().unwrap()] = json!(ids);
    next.save()?;
    *store = next;
    Ok(())
}

#[tauri::command]
pub async fn reorder_items(
    state: tauri::State<'_, State>,
    kind: String,
    profile_id: Option<String>,
    tool: Option<String>,
    ids: Vec<String>,
) -> Result<(), String> {
    let _mutation = state.0.mutation.lock().await;
    reorder(
        &mut state.0.store.lock().unwrap(),
        &kind,
        profile_id.as_deref(),
        tool.as_deref(),
        ids,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quick_launch_order_persists_and_cannot_drop_hidden_tools() {
        let dir = std::env::temp_dir().join(crate::store::new_id());
        let mut store = Store::load(dir.clone()).unwrap();
        let ids: Vec<String> = [
            "claude",
            "codex",
            "vscode",
            "harness",
            "ssh_console",
            "gemini",
            "opencode",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        reorder(&mut store, "quick_launch", None, None, ids.clone()).unwrap();
        assert_eq!(
            Store::load(dir.clone()).unwrap().data["list_order"]["quick_launch"],
            json!(ids)
        );
        assert!(reorder(&mut store, "quick_launch", None, None, vec!["codex".into()]).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn order_persists_and_rejects_missing_duplicate_or_unknown_ids() {
        let dir = std::env::temp_dir().join(crate::store::new_id());
        let mut store = Store::load(dir.clone()).unwrap();
        let first = store.data["profiles"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let second = crate::store::Profile::default();
        let id = second.id.clone();
        store.save_profile(second).unwrap();
        reorder(
            &mut store,
            "profiles",
            None,
            None,
            vec![id.clone(), first.clone()],
        )
        .unwrap();
        let loaded = Store::load(dir.clone()).unwrap();
        assert_eq!(
            loaded.snapshot()["list_order"]["profiles"],
            json!([id, first])
        );
        let old = store.data.clone();
        assert!(reorder(
            &mut store,
            "profiles",
            None,
            None,
            vec![first.clone(), first]
        )
        .is_err());
        assert!(reorder(&mut store, "profiles", None, None, vec!["unknown".into()]).is_err());
        assert_eq!(store.data, old);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn service_order_includes_builtin_and_universal_rows_and_is_scoped_to_tool() {
        let dir = std::env::temp_dir().join(crate::store::new_id());
        let mut store = Store::load(dir.clone()).unwrap();
        let pid = store.data["profiles"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        let shared = crate::store::new_id();
        let claude = crate::store::new_id();
        store.data["services"][&pid] = json!([
            {"id":shared,"scope":"universal","tool":"codex"},
            {"id":claude,"tool":"claude"}
        ]);
        reorder(
            &mut store,
            "services",
            Some(&pid),
            Some("claude"),
            vec![claude.clone(), shared.clone(), "official".into()],
        )
        .unwrap();
        reorder(
            &mut store,
            "services",
            Some(&pid),
            Some("codex"),
            vec!["official".into(), shared.clone()],
        )
        .unwrap();
        let order = Store::load(dir.clone()).unwrap().snapshot()["list_order"].clone();
        assert_eq!(
            order["services"][&pid]["claude"],
            json!([claude, shared, "official"])
        );
        assert_eq!(
            order["services"][&pid]["codex"],
            json!(["official", shared])
        );
        assert!(reorder(
            &mut store,
            "services",
            Some(&pid),
            Some("harness"),
            vec!["official".into()]
        )
        .is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
