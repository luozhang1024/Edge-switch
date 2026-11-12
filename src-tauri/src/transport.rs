use crate::store::Profile;
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::{write::ZlibEncoder, Compression};
use serde_json::{json, Value};
use std::{io::Write, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

pub fn command(exe: &str) -> Command {
    let mut c = Command::new(exe);
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    c.kill_on_drop(true);
    c
}
pub fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}
pub fn options(p: &Profile, batch: bool) -> Vec<String> {
    let mut args = vec![
        "-o".into(),
        format!(
            "StrictHostKeyChecking={}",
            if batch { "yes" } else { "ask" }
        ),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
    ];
    if batch {
        args.extend(["-o".into(), "BatchMode=yes".into()]);
    }
    if !p.identity.is_empty() {
        args.extend([
            "-i".into(),
            p.identity.clone(),
            "-o".into(),
            "IdentitiesOnly=yes".into(),
        ]);
    }
    args
}
pub fn ssh(p: &Profile, batch: bool) -> Command {
    let mut c = command("ssh");
    c.args(options(p, batch));
    c
}
pub fn destination(c: &mut Command, p: &Profile) {
    c.args(["-p", &p.port.to_string(), "-l", &p.user, &p.host]);
}
pub async fn output(mut c: Command, seconds: u64) -> Result<String, String> {
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let result = tokio::time::timeout(Duration::from_secs(seconds), c.output())
        .await
        .map_err(|_| "操作超时，已停止本地子进程；请核对远端状态后重试".to_string())?
        .map_err(|e| format!("无法运行本机程序：{e}"))?;
    if !result.status.success() {
        let message = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "本机命令失败：{}",
            message
                .chars()
                .rev()
                .take(1500)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&result.stdout).into_owned())
}

pub(crate) fn bootstrap_source() -> Result<String, String> {
    let source=format!("import base64\nns={{'__name__':'edge_remote','SERVICE_SOURCE':base64.b64decode('{}')}}\nexec(compile(base64.b64decode('{}'),'edge-agent','exec'),ns)\nexec(compile(base64.b64decode('{}'),'edge-rpc','exec'))\nserve(ns)\n",
        STANDARD.encode(include_bytes!("../../workbench/harness_service.py")),
        STANDARD.encode([include_bytes!("../../workbench/usage.py").as_slice(), b"\nusage_query = query\n", include_bytes!("../../workbench/sessions.py").as_slice(), b"\n", include_bytes!("../../workbench/remote_agent.py").as_slice()].concat()),
        STANDARD.encode(include_bytes!("agent_rpc.py")));
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
    encoder
        .write_all(source.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(encoder.finish().map_err(|e| e.to_string())?))
}

pub struct Rpc {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    sequence: u64,
}
impl Rpc {
    pub fn child_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
    pub async fn connect(p: &Profile) -> Result<Self, String> {
        p.validate()?;
        if p.is_local() {
            return Err("本机环境不使用 SSH".into());
        }
        let encoded = bootstrap_source()?;
        let bootstrap = "import sys,base64,zlib;exec(compile(zlib.decompress(base64.b64decode(sys.stdin.readline())),'edge-bootstrap','exec'))";
        let mut c = ssh(p, true);
        c.arg("-T");
        destination(&mut c, p);
        c.arg(format!("python3 -X utf8 -u -c {}", quote(bootstrap)));
        c.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = c.spawn().map_err(|e| format!("无法启动 OpenSSH：{e}"))?;
        // Drain stderr without retaining it: shell output must not become a credential leak.
        if let Some(mut stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                while matches!(stderr.read(&mut buf).await,Ok(n) if n>0) {}
            });
        }
        let mut input = child.stdin.take().ok_or("SSH 输入不可用")?;
        input
            .write_all(format!("{encoded}\n").as_bytes())
            .await
            .map_err(|_| "SSH 源码传送失败")?;
        input.flush().await.map_err(|e| e.to_string())?;
        let output = BufReader::new(child.stdout.take().ok_or("SSH 输出不可用")?);
        Ok(Self {
            child,
            input,
            output,
            sequence: 0,
        })
    }
    pub async fn call(&mut self, payload: Value, seconds: u64) -> Result<Value, String> {
        self.sequence += 1;
        let id = self.sequence;
        let request = json!({"id":id,"payload":payload}).to_string() + "\n";
        let exchange = async {
            self.input
                .write_all(request.as_bytes())
                .await
                .map_err(|e| format!("SSH 写入失败：{e}"))?;
            self.input.flush().await.map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            // Limit malformed/login-script output as well as valid responses to 4 MiB.
            loop {
                let buf = self.output.fill_buf().await.map_err(|e| e.to_string())?;
                if buf.is_empty() {
                    return Err("SSH 通道已关闭，请检查密钥、主机指纹、网络和板卡 Python3；本次操作未自动重放".into());
                }
                let count = buf
                    .iter()
                    .position(|b| *b == b'\n')
                    .map(|n| n + 1)
                    .unwrap_or(buf.len());
                let complete = buf[count - 1] == b'\n';
                bytes.extend_from_slice(&buf[..count]);
                self.output.consume(count);
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err("SSH 返回结果超过限制".into());
                }
                if complete {
                    break;
                }
            }
            let result: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "SSH 未返回有效协议数据，请检查 shell 启动输出")?;
            if result["id"] != id {
                return Err("SSH 响应标识不匹配".into());
            }
            if let Some(error) = result["error"].as_str() {
                return Err(error.to_string());
            }
            Ok(result["result"].clone())
        };
        match tokio::time::timeout(Duration::from_secs(seconds), exchange).await {
            Ok(result) => result,
            Err(_) => {
                let _ = self.child.kill().await;
                Err("操作超时，连接已关闭；远端结果待核对，未自动重试".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn quotes_shell_paths() {
        assert_eq!(super::quote("a'b"), "'a'\"'\"'b'");
    }
    #[test]
    fn ssh_batch_never_prompts_or_weakens_host_verification() {
        let p = crate::store::Profile::default();
        let a = super::options(&p, true);
        assert!(a.contains(&"StrictHostKeyChecking=yes".into()));
        assert!(a.contains(&"BatchMode=yes".into()));
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::*;
    // Uses a local Python interpreter only in tests; the desktop ships no Python runtime.
    #[tokio::test]
    async fn embedded_agent_serves_multiple_requests_and_recovers_after_error() {
        let mut c = command("python");
        c.args(["-X","utf8","-u","-c","import sys,base64,zlib;exec(compile(zlib.decompress(base64.b64decode(sys.stdin.readline())),'bootstrap','exec'))"]);
        c.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = c.spawn().expect("Protocol test requires Python 3 on PATH");
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        let mut rpc = Rpc {
            child,
            input,
            output,
            sequence: 0,
        };
        rpc.input
            .write_all(format!("{}\n", bootstrap_source().unwrap()).as_bytes())
            .await
            .unwrap();
        // Invalid scope must return an error, never terminate or desynchronize the stream.
        for _ in 0..2 {
            let error = rpc
                .call(json!({"action":"prepare","scope":"invalid"}), 5)
                .await
                .unwrap_err();
            assert!(error.contains("Invalid workspace ID"));
        }
        let error = rpc
            .call(json!({"action":"unknown","scope":"a".repeat(32)}), 5)
            .await
            .unwrap_err();
        assert!(error.contains("unknown"));
        let success = rpc
            .call(
                json!({"action":"codex_auth_status","scope":crate::store::new_id()}),
                5,
            )
            .await
            .unwrap();
        assert_eq!(success["authenticated"], false);
        let usage = rpc
            .call(
                json!({"action":"usage","scope":crate::store::new_id(),"start":1,"end":86401}),
                5,
            )
            .await
            .unwrap();
        assert_eq!(usage["totals"]["requests"], 0);
        assert_eq!(usage["trend"].as_array().unwrap().len(), 24);
        assert!(rpc.child_alive());
        let sessions = rpc
            .call(
                json!({"action":"session_files","scope":crate::store::new_id()}),
                5,
            )
            .await
            .unwrap();
        assert_eq!(sessions["files"], json!([]));
        assert!(rpc.call(json!({"action":"session_files","scope":crate::store::new_id(),"key":"0/../auth.json"}),5).await.is_err());
        rpc.child.kill().await.unwrap();
    }
    #[tokio::test]
    async fn timeout_kills_stream_without_replaying() {
        let mut c = command("python");
        c.args([
            "-u",
            "-c",
            "import sys,time;sys.stdin.readline();time.sleep(10)",
        ]);
        c.stdin(Stdio::piped()).stdout(Stdio::piped());
        let mut child = c.spawn().unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        let mut rpc = Rpc {
            child,
            input,
            output,
            sequence: 0,
        };
        assert!(rpc
            .call(json!({}), 1)
            .await
            .unwrap_err()
            .contains("未自动重试"));
        assert!(!rpc.child_alive());
        assert_eq!(rpc.sequence, 1);
    }
}
