use crate::{
    store::{self, Profile},
    State,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const LIMIT: usize = 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Prompt {
    id: String,
    name: String,
    description: String,
    content: String,
    updated: i64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct Library {
    prompts: Vec<Prompt>,
    active: Option<String>,
}
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn revision(content: &Option<String>) -> String {
    content
        .as_ref()
        .map(|s| format!("{:x}", Sha256::digest(s.as_bytes())))
        .unwrap_or_else(|| "missing".into())
}
fn env_path(name: &str, fallback: PathBuf) -> PathBuf {
    std::env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or(fallback)
}
fn local_target(tool: &str) -> Result<PathBuf, String> {
    let home = PathBuf::from(std::env::var_os("USERPROFILE").ok_or("无法确定本机用户目录")?);
    Ok(match tool {
        "codex" => crate::native_sessions::codex_home().join("AGENTS.md"),
        "claude" => env_path("CLAUDE_CONFIG_DIR", home.join(".claude")).join("CLAUDE.md"),
        "gemini" => env_path("GEMINI_CLI_HOME", home.clone()).join(".gemini/GEMINI.md"),
        "harness" => env_path("DSH_HOME", home.join(".dsh")).join("AGENTS.md"),
        "opencode" => env_path("XDG_CONFIG_HOME", home.join(".config")).join("opencode/AGENTS.md"),
        _ => return Err("工具无效".into()),
    })
}
fn read_target(path: &Path) -> Result<Option<String>, String> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut bytes = vec![];
    file.take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("提示词文件超过 1 MiB，无法管理".into());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "提示词文件不是 UTF-8 编码".into())
}
fn native_file(
    path: &Path,
    expected: Option<&str>,
    content: Option<&str>,
) -> Result<Value, String> {
    let mut current = read_target(path)?;
    if let Some(expected) = expected {
        if revision(&current) != expected {
            return Err("目标文件已被外部修改，请刷新后重试".into());
        }
        let content = content.ok_or("提示词正文缺失")?;
        if content.len() > LIMIT {
            return Err("提示词正文不能超过 1 MiB".into());
        }
        // Keep a recoverable copy outside the library before changing a native file.
        if let Some(old) = &current {
            let backup = path.with_file_name(format!(
                "{}.edge-switch-{}.bak",
                path.file_name().unwrap().to_string_lossy(),
                store::new_id()
            ));
            store::atomic_write(&backup, old.as_bytes())?;
        }
        if revision(&read_target(path)?) != expected {
            return Err("目标文件已被外部修改，请刷新后重试".into());
        }
        store::atomic_write(path, content.as_bytes())?;
        current = Some(content.into());
    }
    Ok(json!({"path":path.to_string_lossy(),"revision":revision(&current),"content":current}))
}
fn reconcile(lib: &mut Library, live: Option<&str>) {
    if let Some(id) = lib.active.clone() {
        if let Some(p) = lib.prompts.iter_mut().find(|p| p.id == id) {
            if let Some(content) = live.filter(|s| !s.trim().is_empty()) {
                if p.content != content {
                    p.content = content.into();
                    p.updated = now();
                }
                return;
            }
        }
        lib.active = None;
    }
    if let Some(content) = live.filter(|s| !s.trim().is_empty()) {
        if let Some(p) = lib.prompts.iter().find(|p| p.content == content) {
            lib.active = Some(p.id.clone());
        } else {
            let id = store::new_id();
            lib.prompts.push(Prompt {
                id: id.clone(),
                name: format!(
                    "自动导入的提示词 {}",
                    chrono::Local::now().format("%Y-%m-%d %H:%M")
                ),
                description: "从当前工具的提示词文件导入".into(),
                content: content.into(),
                updated: now(),
            });
            lib.active = Some(id);
        }
    }
}
fn update(
    lib: &mut Library,
    action: &str,
    id: Option<&str>,
    value: Option<Prompt>,
) -> Result<Option<String>, String> {
    match action {
        "list" => Ok(None),
        "save" => {
            let mut p = value.ok_or("提示词缺失")?;
            p.name = p.name.trim().into();
            if p.name.is_empty() || p.name.chars().count() > 200 {
                return Err("名称不能为空且不能超过 200 个字符".into());
            }
            if p.description.len() > 4000 || p.content.len() > LIMIT {
                return Err("说明或正文过长，正文不能超过 1 MiB".into());
            }
            if let Some(id) = id {
                let old = lib
                    .prompts
                    .iter_mut()
                    .find(|p| p.id == id)
                    .ok_or("提示词不存在")?;
                p.id = id.into();
                p.updated = now();
                *old = p.clone();
            } else {
                p.id = store::new_id();
                p.updated = now();
                lib.prompts.push(p.clone());
            }
            Ok(if lib.active.as_deref() == Some(&p.id) {
                Some(p.content)
            } else {
                None
            })
        }
        "enable" => {
            let p = lib
                .prompts
                .iter()
                .find(|p| Some(p.id.as_str()) == id)
                .ok_or("提示词不存在")?;
            if p.content.trim().is_empty() {
                return Err("正文为空，不能启用".into());
            }
            lib.active = Some(p.id.clone());
            Ok(Some(p.content.clone()))
        }
        "disable" => {
            if lib.active.as_deref() != id || id.is_none() {
                return Err("该提示词未启用".into());
            }
            lib.active = None;
            Ok(Some(String::new()))
        }
        "delete" => {
            if lib.active.as_deref() == id {
                return Err("请先停用提示词再删除".into());
            }
            let index = lib
                .prompts
                .iter()
                .position(|p| Some(p.id.as_str()) == id)
                .ok_or("提示词不存在")?;
            lib.prompts.remove(index);
            Ok(None)
        }
        _ => Err("提示词操作无效".into()),
    }
}
async fn target(
    core: &crate::Core,
    p: &Profile,
    scope: &str,
    tool: &str,
    expected: Option<&str>,
    content: Option<&str>,
) -> Result<Value, String> {
    if p.is_local() {
        return native_file(&local_target(tool)?, expected, content);
    }
    let official = if tool == "codex" {
        p.codex_auth == "chatgpt"
    } else {
        p.tool_services.get(tool).is_none_or(|id| id == "official")
    };
    core.call(
        p,
        scope,
        "prompt_file",
        json!({"tool":tool,"official":official,"expected":expected,"content":content}),
        30,
    )
    .await
}

#[tauri::command]
pub async fn prompt_library(
    state: tauri::State<'_, State>,
    profile_id: String,
    tool: String,
    action: String,
    id: Option<String>,
    prompt: Option<Value>,
    revision: Option<String>,
) -> Result<Value, String> {
    if !store::TOOLS.contains(&tool.as_str()) {
        return Err("工具无效".into());
    }
    let _guard = state.0.mutation.lock().await;
    let (p, scope, directory) = {
        let s = state.0.store.lock().unwrap();
        (
            s.profile(&profile_id)?,
            s.scope(&profile_id),
            s.directory.clone(),
        )
    };
    let live = target(&state.0, &p, &scope, &tool, None, None).await?;
    let current_revision = live["revision"].as_str().ok_or("无法读取目标文件状态")?;
    if action != "list" && revision.as_deref() != Some(current_revision) {
        return Err("目标文件已变化，请刷新列表后重试".into());
    }
    let path_key = format!(
        "{:x}",
        Sha256::digest(live["path"].as_str().ok_or("目标路径缺失")?.as_bytes())
    );
    let path = directory
        .join("prompts")
        .join(&profile_id)
        .join(format!("{tool}-{path_key}.json"));
    let mut lib: Library = match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "提示词库损坏，未覆盖原文件")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Library::default(),
        Err(e) => return Err(e.to_string()),
    };
    reconcile(&mut lib, live["content"].as_str());
    let previous = serde_json::to_vec_pretty(&lib).map_err(|e| e.to_string())?;
    // Persist imported/external content before attempting changes to the target.
    store::atomic_write(&path, &previous)?;
    let value = prompt.map(|v| Prompt {
        id: String::new(),
        name: v["name"].as_str().unwrap_or("").into(),
        description: v["description"].as_str().unwrap_or("").into(),
        content: v["content"].as_str().unwrap_or("").into(),
        updated: now(),
    });
    let write = update(&mut lib, &action, id.as_deref(), value)?;
    store::atomic_write(
        &path,
        &serde_json::to_vec_pretty(&lib).map_err(|e| e.to_string())?,
    )?;
    let result = if let Some(content) = write {
        match target(
            &state.0,
            &p,
            &scope,
            &tool,
            Some(current_revision),
            Some(&content),
        )
        .await
        {
            Ok(result) => result,
            Err(error) => {
                store::atomic_write(&path, &previous)
                    .map_err(|rollback| format!("{error}；提示词库回滚失败：{rollback}"))?;
                return Err(error);
            }
        }
    } else {
        live
    };
    Ok(
        json!({"prompts":lib.prompts,"active":lib.active,"path":result["path"],"revision":result["revision"],"bytes":result["content"].as_str().unwrap_or("").len()}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_preserves_external_edits_and_switches_exclusively() {
        let mut lib = Library::default();
        reconcile(&mut lib, Some("Original"));
        assert_eq!(lib.prompts.len(), 1);
        let imported = lib.active.clone().unwrap();
        reconcile(&mut lib, Some("Externally edited"));
        assert_eq!(lib.prompts[0].content, "Externally edited");
        update(
            &mut lib,
            "save",
            None,
            Some(Prompt {
                id: String::new(),
                name: "Second".into(),
                description: String::new(),
                content: "Replacement".into(),
                updated: 0,
            }),
        )
        .unwrap();
        let second = lib.prompts[1].id.clone();
        assert_eq!(
            update(&mut lib, "enable", Some(&second), None).unwrap(),
            Some("Replacement".into())
        );
        assert_eq!(lib.active, Some(second.clone()));
        assert!(update(&mut lib, "delete", Some(&second), None).is_err());
        assert_eq!(
            update(&mut lib, "disable", Some(&second), None).unwrap(),
            Some(String::new())
        );
        reconcile(&mut lib, Some(""));
        assert!(lib.active.is_none());
        update(&mut lib, "delete", Some(&second), None).unwrap();
        assert_eq!(lib.prompts[0].id, imported);
    }
    #[test]
    fn native_writes_backup_and_reject_stale_revision() {
        let dir = std::env::temp_dir().join(store::new_id());
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("AGENTS.md");
        fs::write(&path, "Original").unwrap();
        let live = native_file(&path, None, None).unwrap();
        fs::write(&path, "External").unwrap();
        assert!(native_file(&path, live["revision"].as_str(), Some("Replacement")).is_err());
        let live = native_file(&path, None, None).unwrap();
        native_file(&path, live["revision"].as_str(), Some("Replacement")).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "Replacement");
        let backup = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|s| s == "bak"))
            .unwrap();
        assert_eq!(fs::read_to_string(backup).unwrap(), "External");
        fs::remove_dir_all(dir).unwrap();
    }
}
