//! Unified skill library. Imported originals and externally modified files are preserved.
use crate::{store, State};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

type Files = BTreeMap<String, String>;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const TOOLS: [&str; 8] = [
    "codex", "claude", "gemini", "opencode", "kimi", "grok", "qwen", "copilot",
];
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or("无法定位用户目录".into())
}
fn env_dir(key: &str, default: PathBuf) -> PathBuf {
    std::env::var_os(key).map(PathBuf::from).unwrap_or(default)
}
fn roots() -> Result<Vec<(String, PathBuf)>, String> {
    let h = home()?;
    Ok(vec![
        (
            "codex".into(),
            crate::native_sessions::codex_home().join("skills"),
        ),
        (
            "claude".into(),
            env_dir("CLAUDE_CONFIG_DIR", h.join(".claude")).join("skills"),
        ),
        (
            "gemini".into(),
            env_dir("GEMINI_CLI_HOME", h.clone()).join(".gemini/skills"),
        ),
        (
            "opencode".into(),
            env_dir("XDG_CONFIG_HOME", h.join(".config")).join("opencode/skills"),
        ),
        ("agents".into(), h.join(".agents/skills")),
        ("kimi".into(), h.join(".kimi/skills")),
        ("grok".into(), h.join(".grok/skills")),
        ("qwen".into(), h.join(".qwen/skills")),
        ("copilot".into(), h.join(".copilot/skills")),
    ])
}
fn safe_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 160
        || id.starts_with('.')
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
    {
        return Err("Skill 目录名无效，仅支持字母、数字、点、横线与下划线".into());
    }
    Ok(())
}
fn read_files(root: &Path) -> Result<Files, String> {
    fn walk(root: &Path, path: &Path, files: &mut Files, bytes: &mut usize) -> Result<(), String> {
        if fs::symlink_metadata(path)
            .map_err(err)?
            .file_type()
            .is_symlink()
        {
            return Err("Skill 内含符号链接，请先复制为普通文件".into());
        }
        for entry in fs::read_dir(path).map_err(err)? {
            let entry = entry.map_err(err)?;
            let kind = entry.file_type().map_err(err)?;
            if kind.is_symlink() {
                return Err("Skill 内含符号链接，请先复制为普通文件".into());
            }
            if kind.is_dir() {
                walk(root, &entry.path(), files, bytes)?;
            } else if kind.is_file() {
                let mut data = vec![];
                fs::File::open(entry.path())
                    .map_err(err)?
                    .take(MAX_BYTES as u64 + 1)
                    .read_to_end(&mut data)
                    .map_err(err)?;
                *bytes += data.len();
                if *bytes > MAX_BYTES || files.len() >= 2000 {
                    return Err("Skill 超过 32 MiB 或 2000 个文件".into());
                }
                let key = entry
                    .path()
                    .strip_prefix(root)
                    .map_err(err)?
                    .to_string_lossy()
                    .replace('\\', "/");
                files.insert(key, STANDARD.encode(data));
            }
        }
        Ok(())
    }
    let mut files = Files::new();
    walk(root, root, &mut files, &mut 0)?;
    if !files.contains_key("SKILL.md") {
        return Err("Skill 缺少 SKILL.md".into());
    }
    Ok(files)
}
fn fingerprint(files: &Files) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(files).unwrap()))
}
fn write_new(path: &Path, files: &Files) -> Result<(), String> {
    // Stage beside destination, then rename; never overwrite existing tool files.
    fs::create_dir_all(path.parent().ok_or("技能目录无效")?).map_err(err)?;
    if path.symlink_metadata().is_ok() {
        return Err("同名 Skill 已存在，请保留或先手动移走原目录".into());
    }
    let stage = path.with_file_name(format!(".edge-skill-{}", store::new_id()));
    let result = (|| {
        fs::create_dir(&stage).map_err(err)?;
        for (name, data) in files {
            let relative = Path::new(name);
            if name.contains('\\')
                || name.contains(':')
                || !relative
                    .components()
                    .all(|c| matches!(c, std::path::Component::Normal(_)))
            {
                return Err("技能文件路径无效".into());
            }
            let target = stage.join(relative);
            fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
            fs::write(target, STANDARD.decode(data).map_err(err)?).map_err(err)?;
        }
        fs::rename(&stage, path).map_err(err)
    })();
    if stage.exists() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}
fn metadata(id: &str, files: &Files) -> Value {
    let data = STANDARD
        .decode(files.get("SKILL.md").map(String::as_str).unwrap_or(""))
        .unwrap_or_default();
    let text = String::from_utf8_lossy(&data);
    let yaml = text
        .strip_prefix("---")
        .and_then(|s| s.split_once("---"))
        .and_then(|(s, _)| serde_yaml::from_str::<Value>(s).ok())
        .unwrap_or(Value::Null);
    json!({"id":id,"name":yaml["name"].as_str().unwrap_or(id),"description":yaml["description"].as_str().unwrap_or("")})
}
fn library_items(base: &Path) -> Result<Vec<Value>, String> {
    let mut rows = vec![];
    if !base.exists() {
        return Ok(rows);
    }
    for entry in fs::read_dir(base).map_err(err)? {
        let entry = entry.map_err(err)?;
        if !entry.file_type().map_err(err)?.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if safe_id(&id).is_err() {
            continue;
        }
        rows.push(metadata(&id, &read_files(&entry.path())?));
    }
    rows.sort_by_key(|r| r["id"].as_str().unwrap_or("").to_lowercase());
    Ok(rows)
}
fn candidates(base: &Path) -> Result<Vec<Value>, String> {
    let mut rows = vec![];
    for (tool, root) in roots()? {
        if !root.exists() {
            continue;
        }
        for entry in fs::read_dir(root).map_err(err)? {
            let entry = entry.map_err(err)?;
            let id = entry.file_name().to_string_lossy().to_string();
            if safe_id(&id).is_err()
                || base.join(&id).exists()
                || !entry.path().join("SKILL.md").is_file()
            {
                continue;
            }
            let mut row = metadata(&id, &read_files(&entry.path())?);
            row["tool"] = json!(tool);
            rows.push(row);
        }
    }
    Ok(rows)
}
fn zip_skills(bytes: Vec<u8>) -> Result<BTreeMap<String, Files>, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
    if archive.len() > 15000 {
        return Err("ZIP 文件数量过多".into());
    }
    let mut all = BTreeMap::<String, Vec<u8>>::new();
    let mut total = 0;
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(err)?;
        if file.enclosed_name().is_none()
            || file.name().contains('\\')
            || file.name().contains(':')
            || file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("ZIP 包含不安全路径或符号链接".into());
        }
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();
        let mut data = vec![];
        file.take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut data)
            .map_err(err)?;
        total += data.len();
        if total > MAX_BYTES {
            return Err("ZIP 解压内容超过 32 MiB".into());
        }
        if all.insert(name, data).is_some() {
            return Err("ZIP 包含重复文件路径".into());
        }
    }
    let mut result = BTreeMap::new();
    for name in all
        .keys()
        .filter(|n| n.as_str() == "SKILL.md" || n.ends_with("/SKILL.md"))
    {
        let prefix = name.strip_suffix("SKILL.md").unwrap();
        let id = prefix
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or("imported-skill");
        safe_id(id)?;
        let files: Files = all
            .iter()
            .filter_map(|(key, data)| {
                key.strip_prefix(prefix)
                    .map(|k| (k.into(), STANDARD.encode(data)))
            })
            .collect();
        if result.insert(format!("{prefix}SKILL.md"), files).is_some() {
            return Err("ZIP 包含重复 Skill".into());
        }
    }
    if result.is_empty() {
        return Err("ZIP 中未找到 SKILL.md".into());
    }
    Ok(result)
}
fn repo_parts(repo: &str) -> Result<(&str, &str), String> {
    let (owner, name) = repo
        .trim()
        .split_once('/')
        .ok_or("请输入 owner/repo 格式的 GitHub 仓库")?;
    for part in [owner, name] {
        if part.is_empty()
            || !part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            || part == "."
            || part == ".."
        {
            return Err("GitHub 仓库名称无效".into());
        }
    }
    Ok((owner, name))
}
async fn download(url: &str) -> Result<Vec<u8>, String> {
    let mut response = crate::network::builder(false, 7890)?
        .user_agent("Edge-Switch")
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(err)?
        .get(url)
        .send()
        .await
        .map_err(err)?
        .error_for_status()
        .map_err(err)?;
    let mut bytes = vec![];
    while let Some(chunk) = response.chunk().await.map_err(err)? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("下载内容超过 32 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn skills_request(
    state: tauri::State<'_, State>,
    profile_id: String,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    let core = &state.0;
    let _guard = core.mutation.lock().await;
    let (p, scope, dir) = {
        let s = core.store.lock().unwrap();
        (
            s.profile(&profile_id)?,
            s.scope(&profile_id),
            s.directory.join("skills"),
        )
    };
    let base = dir.join("library");
    let official: BTreeMap<&str, bool> = TOOLS
        .iter()
        .map(|tool| {
            (
                *tool,
                if *tool == "codex" {
                    p.codex_auth == "chatgpt"
                } else {
                    p.tool_services.get(*tool).is_none_or(|id| id == "official")
                },
            )
        })
        .collect();
    let id = payload["id"].as_str().unwrap_or("");
    if action == "discover" {
        let repo = payload["repo"].as_str().unwrap_or("anthropics/skills");
        let (owner, name) = repo_parts(repo)?;
        let repo_info: Value = serde_json::from_slice(
            &download(&format!("https://api.github.com/repos/{owner}/{name}")).await?,
        )
        .map_err(err)?;
        let branch = repo_info["default_branch"]
            .as_str()
            .ok_or("无法读取仓库默认分支")?;
        let tree: Value = serde_json::from_slice(
            &download(&format!(
                "https://api.github.com/repos/{owner}/{name}/git/trees/{}?recursive=1",
                url::form_urlencoded::byte_serialize(branch.as_bytes()).collect::<String>()
            ))
            .await?,
        )
        .map_err(err)?;
        if tree["truncated"] == true {
            return Err("仓库目录过大，请使用 ZIP 安装".into());
        }
        let sha = tree["sha"].as_str().ok_or("无法读取仓库版本")?;
        let rows: Vec<_> = tree["tree"]
            .as_array()
            .ok_or("仓库目录无效")?
            .iter()
            .filter_map(|v| {
                let path = v["path"].as_str()?;
                let prefix = path.strip_suffix("/SKILL.md")?;
                let id = prefix.rsplit('/').next()?;
                Some(
                    json!({"id":id,"name":id,"description":repo,"repo":repo,"path":path,"sha":sha}),
                )
            })
            .collect();
        return Ok(json!({"skills":rows}));
    }
    if action == "install_repo" || action == "install_zip" {
        let bytes = if action == "install_repo" {
            let (owner, name) = repo_parts(payload["repo"].as_str().ok_or("仓库缺失")?)?;
            let sha = payload["sha"]
                .as_str()
                .filter(|s| s.len() == 40 && s.bytes().all(|c| c.is_ascii_hexdigit()))
                .ok_or("仓库版本无效，请重新发现")?;
            download(&format!(
                "https://codeload.github.com/{owner}/{name}/zip/{sha}"
            ))
            .await?
        } else {
            let path = Path::new(payload["path"].as_str().ok_or("请选择 ZIP")?);
            let mut data = vec![];
            fs::File::open(path)
                .map_err(err)?
                .take(MAX_BYTES as u64 + 1)
                .read_to_end(&mut data)
                .map_err(err)?;
            if data.len() > MAX_BYTES {
                return Err("ZIP 超过 32 MiB".into());
            }
            data
        };
        let mut installed = 0;
        let mut skipped = 0;
        for (path, files) in zip_skills(bytes)? {
            if action == "install_repo"
                && !path.ends_with(&format!(
                    "/{}",
                    payload["path"].as_str().ok_or("技能路径缺失")?
                ))
            {
                continue;
            }
            let prefix = path.strip_suffix("/SKILL.md").unwrap_or("");
            let name = prefix
                .rsplit('/')
                .next()
                .filter(|s| !s.is_empty())
                .unwrap_or("imported-skill");
            safe_id(name)?;
            if base.join(name).exists() {
                skipped += 1;
                continue;
            }
            write_new(&base.join(name), &files)?;
            installed += 1;
        }
        if installed == 0 && skipped == 0 {
            return Err("仓库中未找到所选 Skill，请重新发现".into());
        }
        return Ok(json!({"installed":installed,"skipped":skipped}));
    }
    if action == "import" {
        safe_id(id)?;
        let source = roots()?
            .into_iter()
            .find(|(t, _)| Some(t.as_str()) == payload["tool"].as_str())
            .ok_or("导入来源无效")?
            .1
            .join(id);
        write_new(&base.join(id), &read_files(&source)?)?;
    } else if action == "enable" || action == "disable" {
        safe_id(id)?;
        let tool = payload["tool"]
            .as_str()
            .filter(|t| TOOLS.contains(t))
            .ok_or("工具无效")?;
        let files = read_files(&base.join(id))?;
        if !p.is_local() {
            return core.call(&p, &scope, "skills_target", json!({"operation":action,"tool":tool,"id":id,"files":files,"official":official}), 90).await;
        }
        let target = roots()?
            .into_iter()
            .find(|(t, _)| t == tool)
            .unwrap()
            .1
            .join(id);
        let records = dir.join("local-targets.json");
        let mut owned: BTreeMap<String, String> = if records.exists() {
            serde_json::from_slice(&fs::read(&records).map_err(err)?).map_err(err)?
        } else {
            BTreeMap::new()
        };
        let key = target.to_string_lossy().to_string();
        if action == "enable" {
            write_new(&target, &files)?;
            owned.insert(key, fingerprint(&files));
        } else {
            let expected = owned
                .get(&key)
                .ok_or("此 Skill 来自工具原有目录，请在工具目录自行管理，原文件已保留")?;
            if target.exists() && fingerprint(&read_files(&target)?) != *expected {
                return Err("Skill 已被外部修改，已保留，请先备份并手动处理".into());
            }
            if target.exists() {
                fs::remove_dir_all(&target).map_err(err)?;
            }
            owned.remove(&key);
        }
        store::atomic_write(&records, &serde_json::to_vec(&owned).map_err(err)?)?;
    } else if action != "list" {
        return Err("未知技能操作".into());
    }
    let mut installed = library_items(&base)?;
    let enabled = if p.is_local() {
        let mut map = serde_json::Map::new();
        for (tool, root) in roots()?
            .into_iter()
            .filter(|(t, _)| TOOLS.contains(&t.as_str()))
        {
            let ids: Vec<_> = installed
                .iter()
                .filter_map(|s| s["id"].as_str())
                .filter(|id| root.join(id).join("SKILL.md").is_file())
                .collect();
            map.insert(tool, json!(ids));
        }
        Value::Object(map)
    } else {
        core.call(
            &p,
            &scope,
            "skills_target",
            json!({"operation":"list","official":official}),
            60,
        )
        .await?
    };
    for row in &mut installed {
        row["enabled"] = json!(TOOLS
            .iter()
            .filter(|t| enabled[**t]
                .as_array()
                .is_some_and(|ids| ids.contains(&row["id"])))
            .collect::<Vec<_>>());
    }
    Ok(json!({"skills":installed,"candidates":candidates(&base)?,"path":base.to_string_lossy()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn archive(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(data.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }
    #[test]
    fn zip_extracts_skill_resources_and_rejects_traversal() {
        let skills = zip_skills(archive(&[
            ("repo/skills/sample/SKILL.md", "Instructions"),
            ("repo/skills/sample/scripts/test.py", "print(1)"),
            ("repo/skills/other/SKILL.md", "Other"),
        ]))
        .unwrap();
        assert_eq!(skills.len(), 2);
        assert!(skills["repo/skills/sample/SKILL.md"].contains_key("scripts/test.py"));
        assert!(zip_skills(archive(&[("../outside/SKILL.md", "Invalid")])).is_err());
        assert!(zip_skills(archive(&[("README.md", "No skills")])).is_err());
    }
    #[test]
    fn rejects_traversal_and_preserves_existing_skill() {
        assert!(safe_id("../escape").is_err());
        assert!(safe_id("C:secret").is_err());
        let root = std::env::temp_dir().join(store::new_id());
        let files = BTreeMap::from([
            (
                "SKILL.md".into(),
                STANDARD.encode("---\nname: sample\n---\nHello"),
            ),
            ("scripts/run.sh".into(), STANDARD.encode("echo ok")),
        ]);
        write_new(&root, &files).unwrap();
        assert_eq!(read_files(&root).unwrap(), files);
        assert!(write_new(&root, &files).is_err());
        assert_eq!(metadata("sample", &files)["name"], "sample");
        fs::remove_dir_all(root).unwrap();
    }
}
