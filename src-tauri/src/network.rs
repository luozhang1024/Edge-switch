use crate::{store, State};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{OnceLock, RwLock},
};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Network {
    pub endpoint: String,
    pub username: String,
    pub password: String,
}
static NETWORK: OnceLock<RwLock<Network>> = OnceLock::new();
fn shared() -> &'static RwLock<Network> {
    NETWORK.get_or_init(|| RwLock::new(Network::default()))
}
fn validate(value: &Network) -> Result<(), String> {
    if value.endpoint.is_empty() {
        return Ok(());
    }
    let url = url::Url::parse(&value.endpoint).map_err(|_| "代理地址无效")?;
    if !["http", "https"].contains(&url.scheme())
        || ![Some("127.0.0.1"), Some("localhost")].contains(&url.host_str())
        || url.port_or_known_default().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "共享代理请填写本机 HTTP / Mixed 端口，例如 http://127.0.0.1:7890；认证信息在下方填写"
                .into(),
        );
    }
    Ok(())
}
pub fn load(dir: &Path) -> Result<(), String> {
    let path = dir.join("network.json");
    if path.exists() {
        let mut value: Network =
            serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|_| "网络设置损坏")?;
        if !value.password.is_empty() {
            value.password = crate::secrets::unprotect(&value.password)?;
        }
        validate(&value)?;
        *shared().write().unwrap() = value;
    }
    Ok(())
}
pub fn configured() -> Option<Network> {
    let value = shared().read().unwrap().clone();
    (!value.endpoint.is_empty()).then_some(value)
}
pub fn port(fallback: u16) -> u16 {
    configured()
        .and_then(|n| url::Url::parse(&n.endpoint).ok()?.port_or_known_default())
        .unwrap_or(fallback)
}
pub fn url_at(port: u16) -> String {
    let Some(value) = configured() else {
        return format!("http://127.0.0.1:{port}");
    };
    let mut url = url::Url::parse(&value.endpoint).unwrap();
    let _ = url.set_host(Some("127.0.0.1"));
    let _ = url.set_port(Some(port));
    let _ = url.set_username(&value.username);
    if !value.password.is_empty() {
        let _ = url.set_password(Some(&value.password));
    }
    url.to_string().trim_end_matches('/').into()
}
pub fn builder(fallback_proxy: bool, fallback_port: u16) -> Result<reqwest::ClientBuilder, String> {
    let mut builder = reqwest::Client::builder().no_proxy();
    if configured().is_some() || fallback_proxy {
        let proxy = reqwest::Proxy::all(url_at(port(fallback_port)))
            .map_err(|_| "代理地址无效")?
            .no_proxy(reqwest::NoProxy::from_string("localhost,127.0.0.1,::1"));
        builder = builder.proxy(proxy);
    }
    Ok(builder)
}
#[tauri::command]
pub async fn network_settings(
    state: tauri::State<'_, State>,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    let mut value = shared().read().unwrap().clone();
    if action == "save" || action == "test" {
        value.endpoint = payload["endpoint"].as_str().unwrap_or("").trim().into();
        value.username = payload["username"].as_str().unwrap_or("").into();
        if let Some(password) = payload["password"].as_str() {
            value.password = password.into();
        }
        validate(&value)?;
        if action == "test" {
            if value.endpoint.is_empty() {
                return Err("请先填写 FlClash 的 HTTP / Mixed 代理地址".into());
            }
            let mut proxy = reqwest::Proxy::all(&value.endpoint).map_err(|_| "代理地址无效")?;
            if !value.username.is_empty() {
                proxy = proxy.basic_auth(&value.username, &value.password);
            }
            let response = reqwest::Client::builder()
                .no_proxy()
                .proxy(proxy)
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|_| "无法创建网络测试")?
                .get("https://www.gstatic.com/generate_204")
                .send()
                .await
                .map_err(|_| "代理测试失败，请检查 FlClash 是否运行、端口及节点是否可用")?;
            if !response.status().is_success() {
                return Err(format!("代理测试返回 HTTP {}", response.status().as_u16()));
            }
            return Ok(json!({"message":"代理连接测试通过"}));
        }
        let _guard = state.0.mutation.lock().await;
        if !state.0.active.lock().unwrap().is_empty() {
            return Err("有任务正在进行，请先完成或取消任务再修改网络".into());
        }
        let mut saved = value.clone();
        if !saved.password.is_empty() {
            saved.password = crate::secrets::protect(&saved.password)?;
        }
        let directory = state.0.store.lock().unwrap().directory.clone();
        store::atomic_write(
            &directory.join("network.json"),
            &serde_json::to_vec(&saved).map_err(|e| e.to_string())?,
        )?;
        let resources = std::mem::take(&mut *state.0.resources.lock().await);
        for resource in resources.into_values() {
            resource.stop().await;
        }
        *shared().write().unwrap() = value.clone();
    } else if action != "get" {
        return Err("未知网络操作".into());
    }
    Ok(
        json!({"endpoint":value.endpoint,"username":value.username,"has_password":!value.password.is_empty(),"message":if action == "save" {"网络设置已保存，所有环境后续请求使用此代理；已断开旧隧道，重新启动工具后生效"} else {""}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_proxy_accepts_flclash_but_rejects_credentials_in_url_and_remote_hosts() {
        for endpoint in ["http://127.0.0.1:7890", "http://localhost:7897", ""] {
            assert!(validate(&Network {
                endpoint: endpoint.into(),
                ..Network::default()
            })
            .is_ok());
        }
        for endpoint in [
            "http://user:secret@127.0.0.1:7890",
            "http://example.com:7890",
            "file:///config",
            "http://127.0.0.1:7890/?key=secret",
        ] {
            assert!(validate(&Network {
                endpoint: endpoint.into(),
                ..Network::default()
            })
            .is_err());
        }
    }
}
