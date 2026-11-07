use crate::{store, State};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub theme: String,
    pub motion: bool,
    pub home_tools: Vec<String>,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            motion: true,
            home_tools: store::TOOLS.iter().map(|s| s.to_string()).collect(),
        }
    }
}
impl Preferences {
    fn validate(&self) -> Result<(), String> {
        if !["light", "dark", "system"].contains(&self.theme.as_str()) {
            return Err("主题无效".into());
        }
        if self.home_tools.is_empty()
            || self.home_tools.len() > store::TOOLS.len()
            || self
                .home_tools
                .iter()
                .any(|tool| !store::TOOLS.contains(&tool.as_str()))
        {
            return Err("请至少保留一个有效的首页工具".into());
        }
        let mut unique = self.home_tools.clone();
        unique.sort();
        unique.dedup();
        if unique.len() != self.home_tools.len() {
            return Err("首页工具不能重复".into());
        }
        Ok(())
    }
}
#[tauri::command]
pub async fn save_preferences(
    state: tauri::State<'_, State>,
    preferences: Preferences,
) -> Result<(), String> {
    preferences.validate()?;
    let _mutation = state.0.mutation.lock().await;
    let core = state.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut live = core.store.lock().unwrap();
        let mut next = live.clone();
        next.data["preferences"] = json!(preferences);
        next.save()?;
        *live = next;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
const RELEASES_URL: &str = "https://github.com/luozhang1024/Edge-switch/releases";
#[tauri::command]
pub fn open_project_page() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg("https://github.com/luozhang1024/Edge-switch")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn release_info(releases: &[Value], current: &str) -> Result<Value, String> {
    let current = semver::Version::parse(current).map_err(|_| "当前版本格式无效")?;
    let latest = releases
        .iter()
        .filter(|r| r["draft"] != true)
        .filter_map(|r| {
            let version =
                semver::Version::parse(r["tag_name"].as_str()?.trim_start_matches('v')).ok()?;
            Some((version, r))
        })
        .max_by(|a, b| a.0.cmp(&b.0));
    Ok(match latest {
        Some((version, release)) => {
            json!({"available":version > current,"version":version.to_string(),"name":release["name"],"url":RELEASES_URL,"message":if version > current {"发现新版本，可打开发布页下载"}else{"当前已是最新发布版本"}})
        }
        None => {
            json!({"available":false,"version":current.to_string(),"url":RELEASES_URL,"message":"仓库暂无已发布版本，当前为本地构建版本"})
        }
    })
}
#[tauri::command]
pub async fn check_update() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Edge-Switch-update-check")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get("https://api.github.com/repos/luozhang1024/Edge-switch/releases?per_page=30")
        .send()
        .await
        .map_err(|_| "无法连接 GitHub，请检查电脑网络后重试")?;
    if response.status().as_u16() == 403 || response.status().as_u16() == 429 {
        return Err("GitHub 请求频率受限，请稍后重试或打开发布页查看".into());
    }
    let releases: Vec<Value> = response
        .error_for_status()
        .map_err(|_| "版本服务暂不可用")?
        .json()
        .await
        .map_err(|_| "版本服务返回了无效数据")?;
    release_info(&releases, env!("CARGO_PKG_VERSION"))
}
#[tauri::command]
pub fn open_release_page() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(RELEASES_URL)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("请在浏览器访问 GitHub 项目发布页".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_preferences_without_hiding_all_tools() {
        assert!(Preferences::default().validate().is_ok());
        let mut p = Preferences::default();
        p.home_tools.clear();
        assert!(p.validate().is_err());
        p.home_tools = vec!["codex".into(), "codex".into()];
        assert!(p.validate().is_err());
    }
    #[test]
    fn compares_prereleases_numerically_and_ignores_drafts() {
        let releases = vec![
            json!({"tag_name":"v2.0.0-alpha.10"}),
            json!({"tag_name":"v2.0.0-alpha.9"}),
            json!({"tag_name":"v9.0.0","draft":true}),
        ];
        let result = release_info(&releases, "2.0.0-alpha.5").unwrap();
        assert_eq!(result["version"], "2.0.0-alpha.10");
        assert_eq!(result["available"], true);
        assert_eq!(
            release_info(&[], "2.0.0-alpha.5").unwrap()["available"],
            false
        );
    }
}
