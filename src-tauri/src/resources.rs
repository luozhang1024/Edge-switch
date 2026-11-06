use crate::{store::Profile, transport, Core};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Weak;
use std::{
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Child,
    sync::watch,
};

#[derive(Clone, Serialize)]
pub struct Status {
    pub kind: String,
    pub state: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub background: bool,
}
pub struct Managed {
    pub status: Arc<Mutex<Status>>,
    stop: watch::Sender<bool>,
    join: Option<tokio::task::JoinHandle<()>>,
}

pub struct HarnessIdentity {
    pub core: Weak<Core>,
    pub scope: String,
    pub pid: u64,
}
impl HarnessIdentity {
    fn matches(&self, value: &Value, local: u16, remote: u16) -> bool {
        value["running"] == true
            && value["pid"] == self.pid
            && value["local_port"] == local
            && value["port"] == remote
    }
    async fn verify(&self, p: &Profile, local: u16, remote: u16) -> Result<bool, String> {
        let core = self.core.upgrade().ok_or("工作台已退出")?;
        let value = tokio::time::timeout(
            Duration::from_secs(15),
            core.call(p, &self.scope, "harness_status", json!({}), 12),
        )
        .await
        .map_err(|_| "服务状态检查超时")??;
        Ok(self.matches(&value, local, remote))
    }
}
impl Drop for Managed {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
        if let Some(join) = self.join.take() {
            join.abort();
        }
    }
}

async fn forward(
    p: &Profile,
    local: u16,
    remote: u16,
    reverse: bool,
) -> Result<(Child, u16), String> {
    if reverse {
        tokio::time::timeout(
            Duration::from_secs(3),
            tokio::net::TcpStream::connect(("127.0.0.1", local)),
        )
        .await
        .map_err(|_| "本机代理连接超时")?
        .map_err(|_| "本机代理端口不可用")?;
    }
    let mut c = transport::ssh(p, true);
    let mapping = if reverse {
        format!("127.0.0.1:{remote}:127.0.0.1:{local}")
    } else {
        format!("127.0.0.1:{local}:127.0.0.1:{remote}")
    };
    c.args([
        "-N",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "LogLevel=DEBUG1",
        if reverse { "-R" } else { "-L" },
        &mapping,
    ]);
    transport::destination(&mut c, p);
    c.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(child.stderr.take().ok_or("SSH 日志不可用")?).lines();
    let ready = async {
        while let Some(line) = reader.next_line().await.map_err(|e| e.to_string())? {
            if reverse && line.contains("Allocated port ") {
                let port = line
                    .split("Allocated port ")
                    .nth(1)
                    .and_then(|v| v.split_whitespace().next())
                    .and_then(|v| v.parse::<u16>().ok())
                    .ok_or("SSH 分配端口无效")?;
                return Ok(port);
            }
            if reverse && remote > 0 && line.contains("remote forward success") {
                return Ok(remote);
            }
            if !reverse && line.contains("Local forwarding listening on 127.0.0.1 port") {
                return Ok(remote);
            }
        }
        Err::<u16, String>("SSH 转发未建立，请检查端口、密钥和主机指纹".into())
    };
    let port = tokio::time::timeout(Duration::from_secs(20), ready)
        .await
        .map_err(|_| "SSH 转发建立超时")??;
    tokio::spawn(async move { while matches!(reader.next_line().await, Ok(Some(_))) {} });
    Ok((child, port))
}

impl Managed {
    pub async fn start(
        p: Profile,
        local: u16,
        remote: u16,
        reverse: bool,
        background: bool,
        identity: Option<HarnessIdentity>,
    ) -> Result<Self, String> {
        let (mut child, remote) = forward(&p, local, remote, reverse).await?;
        let status = Arc::new(Mutex::new(Status {
            kind: if reverse { "proxy" } else { "harness" }.into(),
            state: "已连接".into(),
            local_port: local,
            remote_port: remote,
            background,
        }));
        let shared = status.clone();
        let (stop, mut cancel) = watch::channel(false);
        let join = tokio::spawn(async move {
            let mut delay = 1;
            let mut checked = tokio::time::Instant::now();
            let mut final_state = "已停止";
            loop {
                tokio::select! {
                    _=cancel.changed()=>break,
                    _=tokio::time::sleep(Duration::from_secs(2))=>{}
                }
                let alive = matches!(child.try_wait(), Ok(None));
                if let Some(identity) = &identity {
                    if !alive || checked.elapsed() >= Duration::from_secs(15) {
                        let verified = tokio::select! { _=cancel.changed()=>break, result=identity.verify(&p,local,remote)=>result };
                        checked = tokio::time::Instant::now();
                        match verified {
                            Ok(true) => {
                                shared.lock().unwrap().state = "已连接".into();
                            }
                            Ok(false) => {
                                final_state = "板卡服务已停止或更换，请重新打开";
                                break;
                            }
                            Err(_) => {
                                shared.lock().unwrap().state =
                                    "暂时无法确认原板卡服务，等待恢复".into();
                                continue;
                            }
                        }
                    }
                }
                if alive {
                    if reverse {
                        let reachable = matches!(
                            tokio::time::timeout(
                                Duration::from_secs(2),
                                tokio::net::TcpStream::connect(("127.0.0.1", local))
                            )
                            .await,
                            Ok(Ok(_))
                        );
                        shared.lock().unwrap().state = if reachable {
                            "已连接"
                        } else {
                            "本机代理不可用"
                        }
                        .into();
                    }
                    continue;
                }
                shared.lock().unwrap().state = format!("连接中断，{delay} 秒后重连");
                let attempt = async {
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                    forward(&p, local, remote, reverse).await
                };
                tokio::select! {
                    _=cancel.changed()=>break,
                    result=attempt=>match result {
                        Ok((replacement,_))=>{child=replacement;delay=1;shared.lock().unwrap().state="已连接".into();}
                        Err(_)=>{delay=(delay*2).min(30);}
                    }
                }
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            shared.lock().unwrap().state = final_state.into();
        });
        Ok(Self {
            status,
            stop,
            join: Some(join),
        })
    }
    pub async fn stop(mut self) {
        let _ = self.stop.send(true);
        if let Some(join) = self.join.take() {
            let _ = join.await;
        }
    }
}

pub fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn harness_reconnection_requires_original_process_and_ports() {
        let identity = HarnessIdentity {
            core: Weak::new(),
            scope: "a".repeat(32),
            pid: 42,
        };
        let mut info = json!({"running":true,"pid":42,"local_port":3000,"port":4000});
        assert!(identity.matches(&info, 3000, 4000));
        info["pid"] = json!(43);
        assert!(!identity.matches(&info, 3000, 4000));
        info["pid"] = json!(42);
        info["port"] = json!(4001);
        assert!(!identity.matches(&info, 3000, 4000));
        info["port"] = json!(4000);
        info["running"] = json!(false);
        assert!(!identity.matches(&info, 3000, 4000));
    }
}
