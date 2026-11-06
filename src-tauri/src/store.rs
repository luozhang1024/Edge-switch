use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub user: String,
    pub port: u16,
    pub project: String,
    pub identity: String,
    pub base_url: String,
    pub model: String,
    pub protocol: String,
    pub proxy: bool,
    pub codex_proxy: Option<bool>,
    pub harness_proxy: Option<bool>,
    pub harness_background: bool,
    pub proxy_port: u16,
    pub codex_version: String,
    pub harness_version: String,
    pub active_api: String,
    pub codex_auth: String,
    pub tool_services: std::collections::HashMap<String, String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            id: new_id(),
            name: "新工作环境".into(),
            host: "192.168.1.100".into(),
            user: "developer".into(),
            port: 22,
            project: "/home/developer/project".into(),
            identity: String::new(),
            base_url: "https://api.deepseek.com/v1".into(),
            model: String::new(),
            protocol: "responses".into(),
            proxy: false,
            codex_proxy: None,
            harness_proxy: None,
            harness_background: true,
            proxy_port: 7890,
            codex_version: String::new(),
            harness_version: String::new(),
            active_api: String::new(),
            codex_auth: "api".into(),
            tool_services: Default::default(),
            extra: Default::default(),
        }
    }
}

pub fn new_id() -> String {
    Uuid::new_v4().simple().to_string()
}
pub fn valid_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn validate_url(value: &str) -> Result<(), String> {
    let u = url::Url::parse(value).map_err(|_| "API 地址无效")?;
    if value.chars().any(char::is_control)
        || u.scheme() != "https"
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err("API 地址需要 HTTPS，不能含账号、查询参数或片段".into());
    }
    Ok(())
}

pub const TOOLS: [&str; 5] = ["codex", "claude", "harness", "gemini", "opencode"];
pub fn validate_tool_protocol(tool: &str, protocol: &str) -> Result<(), String> {
    let supported = match tool {
        "codex" => protocol == "responses",
        "claude" => protocol == "anthropic",
        "gemini" => protocol == "gemini",
        "harness" => ["responses", "chat", "anthropic"].contains(&protocol),
        "opencode" => ["responses", "chat", "anthropic", "gemini"].contains(&protocol),
        _ => return Err("工具无效".into()),
    };
    if supported {
        Ok(())
    } else {
        Err("所选工具不支持此 API 协议，请选择兼容接口或网关".into())
    }
}

impl Profile {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.id) || self.name.trim().is_empty() {
            return Err("环境 ID 或名称无效".into());
        }
        if !Regex::new(r"^[A-Za-z0-9_.-]+$")
            .unwrap()
            .is_match(&self.host)
            || self.host.starts_with('-')
        {
            return Err("设备地址需要 IPv4 或主机名".into());
        }
        if !Regex::new(r"^[A-Za-z_][A-Za-z0-9_.-]*$")
            .unwrap()
            .is_match(&self.user)
        {
            return Err("Linux 用户名无效".into());
        }
        if self.port == 0
            || self.proxy_port == 0
            || !self.project.starts_with('/')
            || self.project.chars().any(char::is_control)
        {
            return Err("端口或工程目录无效".into());
        }
        if !["api", "chatgpt"].contains(&self.codex_auth.as_str())
            || !["responses", "chat"].contains(&self.protocol.as_str())
        {
            return Err("认证方式或 API 协议无效".into());
        }
        if !self.identity.is_empty()
            && (!Path::new(&self.identity).is_file() || self.identity.contains(['\n', '\r', '"']))
        {
            return Err("SSH 私钥文件不存在或路径无效".into());
        }
        validate_url(&self.base_url)
    }
    pub fn uses_proxy(&self, tool: &str) -> bool {
        if tool == "harness" {
            self.harness_proxy.unwrap_or(self.proxy)
        } else {
            self.codex_proxy.unwrap_or(self.proxy)
        }
    }
}

#[derive(Clone)]
pub struct Store {
    pub directory: PathBuf,
    pub data: Value,
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("文件目录无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!("{}.tmp", new_id()));
    let result = (|| {
        use std::io::Write;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|e| e.to_string())?;
        drop(f);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            for attempt in 0..8 {
                if unsafe {
                    MoveFileExW(
                        source.as_ptr(),
                        target.as_ptr(),
                        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                    )
                } != 0
                {
                    return Ok(());
                }
                if attempt == 7 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(50 * (attempt + 1)));
            }
            unreachable!()
        }
        #[cfg(not(windows))]
        {
            fs::rename(&temp, path).map_err(|e| e.to_string())
        }
    })();
    let _ = fs::remove_file(&temp);
    result
}

impl Store {
    pub fn load(directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join("profiles.json");
        let exists = path.exists();
        let mut data: Value = if exists {
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|_| "本地配置损坏，已保留原文件")?
        } else {
            json!({"client_id":new_id(),"profiles":[Profile::default()],"selected_profile":""})
        };
        if !data.is_object() || !valid_id(data["client_id"].as_str().unwrap_or("")) {
            return Err("本地客户端标识损坏".into());
        }
        let profiles = data["profiles"].as_array().ok_or("环境列表损坏")?;
        if profiles.is_empty() {
            return Err("环境列表为空，已保留原文件".into());
        }
        let mut ids = std::collections::HashSet::new();
        let mut normalized = Vec::new();
        for value in profiles {
            if !valid_id(value["id"].as_str().unwrap_or("")) {
                return Err("环境标识损坏".into());
            }
            let p: Profile = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            if !valid_id(&p.id) || !ids.insert(p.id.clone()) {
                return Err("环境标识损坏或重复".into());
            }
            normalized.push(json!(p));
        }
        data["profiles"] = json!(normalized);
        for field in ["secrets", "services", "applied", "official"] {
            if data.get(field).is_none() {
                data[field] = json!({});
            }
            if !data[field].is_object() {
                return Err(format!("配置字段 {field} 损坏"));
            }
        }
        // Backup is ciphertext-compatible with v1; never overwrite a previous backup.
        if exists && data["schema_version"] != 2 {
            let backup = directory.join("profiles.pre-tauri.json");
            if !backup.exists() {
                fs::copy(&path, &backup).map_err(|e| e.to_string())?;
            }
        }
        let profiles = data["profiles"].as_array().unwrap().clone();
        for value in profiles {
            let id = value["id"].as_str().unwrap();
            if data["services"].get(id).is_none() {
                let active = value["active_api"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(id);
                data["services"][id] = json!([{"id":active,"name":"默认 API","base_url":value["base_url"],"model":value["model"],"protocol":value["protocol"]}]);
                if let Some(p) = data["profiles"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|p| p["id"] == id)
                {
                    p["active_api"] = json!(active);
                }
            }
        }
        for value in data["profiles"].as_array().unwrap() {
            let id = value["id"].as_str().unwrap();
            let services = data["services"][id]
                .as_array()
                .ok_or("服务列表损坏，原配置已保留")?;
            if services
                .iter()
                .any(|entry| !valid_id(entry["id"].as_str().unwrap_or("")))
            {
                return Err("服务标识损坏".into());
            }
        }
        if !data["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == data["selected_profile"])
        {
            data["selected_profile"] = data["profiles"][0]["id"].clone();
        }
        data["schema_version"] = json!(2);
        let store = Self { directory, data };
        store.save()?;
        Ok(store)
    }
    pub fn save(&self) -> Result<(), String> {
        atomic_write(
            &self.directory.join("profiles.json"),
            &serde_json::to_vec_pretty(&self.data).map_err(|e| e.to_string())?,
        )
    }
    pub fn profile(&self, id: &str) -> Result<Profile, String> {
        let value = self.data["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .ok_or("环境不存在")?;
        serde_json::from_value(value.clone()).map_err(|e| e.to_string())
    }
    pub fn scope(&self, id: &str) -> String {
        format!(
            "{:x}",
            Sha256::digest(format!("{}{id}", self.data["client_id"].as_str().unwrap()))
        )[..32]
            .to_string()
    }
    pub fn snapshot(&self) -> Value {
        let mut official = self.data["official"].clone();
        for entry in official.as_object_mut().unwrap().values_mut() {
            if let Some(obj) = entry.as_object_mut() {
                let saved = obj.remove("credentials").is_some();
                obj.insert("has_credentials".into(), json!(saved));
            }
        }
        json!({"profiles": self.data["profiles"], "selected_profile": self.data["selected_profile"],
            "services": self.data["services"], "official": official,
            "saved_keys": self.data["secrets"].as_object().unwrap().keys().collect::<Vec<_>>(),
            "version":env!("CARGO_PKG_VERSION")})
    }
    pub fn key(&self, p: &Profile) -> Result<String, String> {
        let id = if p.active_api.is_empty() {
            &p.id
        } else {
            &p.active_api
        };
        self.data["secrets"][id]
            .as_str()
            .map(crate::secrets::unprotect)
            .transpose()
            .map(|s| s.unwrap_or_default())
    }
    pub fn save_profile(&mut self, p: Profile) -> Result<(), String> {
        p.validate()?;
        let mut candidate = self.clone();
        let entries = candidate.data["profiles"].as_array_mut().unwrap();
        if let Some(old) = entries.iter_mut().find(|v| v["id"] == p.id) {
            *old = json!(p);
        } else {
            entries.push(json!(p));
        }
        if candidate.data["services"].get(&p.id).is_none() {
            candidate.data["services"][&p.id] = json!([]);
        }
        candidate.data["applied"]
            .as_object_mut()
            .unwrap()
            .remove(&p.id);
        candidate.save()?;
        self.data = candidate.data;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_launch_persists_client_identity_and_scope() {
        let dir = std::env::temp_dir().join(new_id());
        let first = Store::load(dir.clone()).unwrap();
        let id = first.data["profiles"][0]["id"].as_str().unwrap();
        let next = Store::load(dir.clone()).unwrap();
        assert_eq!(first.scope(id), next.scope(id));
        assert_eq!(first.data, next.data);
        assert!(!dir.join("profiles.pre-tauri.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_profile_write_preserves_memory() {
        let dir = std::env::temp_dir().join(new_id());
        let mut store = Store::load(dir.clone()).unwrap();
        let old = store.data.clone();
        let mut profile = store
            .profile(old["profiles"][0]["id"].as_str().unwrap())
            .unwrap();
        profile.name = "changed".into();
        store.directory = dir.join("profiles.json");
        assert!(store.save_profile(profile).is_err());
        assert_eq!(store.data, old);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_ssh_injection() {
        let mut p = Profile::default();
        p.host = "-oProxyCommand=calc".into();
        assert!(p.validate().is_err());
        p.host = "board.local".into();
        p.project = "/tmp/x\nfoo".into();
        assert!(p.validate().is_err());
    }
    #[test]
    fn migrates_without_changing_scope_or_exposing_credentials() {
        let dir = std::env::temp_dir().join(new_id());
        fs::create_dir_all(&dir).unwrap();
        let p = Profile {
            proxy: true,
            ..Default::default()
        };
        let pid = p.id.clone();
        let original = json!({"client_id":"a".repeat(32),"profiles":[p],"secrets":{"old":"ciphertext"},"official":{pid.clone():{"credentials":"cipher","name":"Official"}},"future_field":42});
        fs::write(dir.join("profiles.json"), original.to_string()).unwrap();
        let store = Store::load(dir.clone()).unwrap();
        assert_eq!(
            store.scope(&p.id),
            format!(
                "{:x}",
                Sha256::digest(format!("{}{id}", "a".repeat(32), id = p.id))
            )[..32]
        );
        assert!(store.profile(&pid).unwrap().uses_proxy("harness"));
        assert!(!store.snapshot().to_string().contains("cipher"));
        assert_eq!(store.data["future_field"], 42);
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(dir.join("profiles.pre-tauri.json")).unwrap()
            )
            .unwrap(),
            original
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
