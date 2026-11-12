//! Native Windows entry points. Local tools retain their existing configuration.
use crate::{store::Profile, transport};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

fn powershell(script: &str) -> tokio::process::Command {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut c = transport::command("powershell.exe");
    c.args(["-NoProfile", "-EncodedCommand", &STANDARD.encode(bytes)]);
    c
}

pub async fn execute(p: &Profile, action: &str) -> Result<Value, String> {
    p.validate()?;
    if !cfg!(windows) {
        return Err("本机环境需要 Windows".into());
    }
    if action == "diagnose" {
        let mut c = powershell(
            r#"
            $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
            $tools = @{}
            foreach ($name in @('node','codex','claude','gemini','opencode','dsh','code')) {
                $tools[$name] = [bool](Get-Command $name -ErrorAction SilentlyContinue)
            }
            @{ message = '本机 Windows 环境可用'; platform = 'Windows'; tools = $tools } | ConvertTo-Json -Compress
        "#,
        );
        let output = tokio::time::timeout(std::time::Duration::from_secs(20), c.output())
            .await
            .map_err(|_| "检查本机环境超时")?
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err("检查本机环境失败".into());
        }
        return serde_json::from_slice(&output.stdout).map_err(|_| "本机检查未返回有效结果".into());
    }
    let tool = match action {
        "ssh_console" => "",
        "codex" | "claude" | "gemini" | "opencode" => action,
        "harness" => "dsh",
        "vscode" => "code",
        _ => return Err(
            "本机环境目前支持检查、终端及已安装工具启动；安装、模型配置和账号登录请在本机终端完成"
                .into(),
        ),
    };
    if !std::path::Path::new(&p.project).is_dir() {
        return Err("本机工程目录不存在，请编辑工作环境".into());
    }
    if !tool.is_empty() {
        let mut check = powershell(
            "if (!(Get-Command $env:EDGE_LOCAL_TOOL -ErrorAction SilentlyContinue)) { exit 1 }",
        );
        check.env("EDGE_LOCAL_TOOL", tool);
        let status = tokio::time::timeout(std::time::Duration::from_secs(20), check.status())
            .await
            .map_err(|_| "检查本机工具超时")?
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("本机未找到 {tool}，请先安装并加入 PATH"));
        }
    }
    let mut c = powershell("Set-Location -LiteralPath $env:EDGE_LOCAL_PROJECT; if ($env:EDGE_LOCAL_TOOL) { if ($env:EDGE_LOCAL_TOOL -eq 'code') { & $env:EDGE_LOCAL_TOOL . } else { & $env:EDGE_LOCAL_TOOL } }");
    c.arg("-NoExit");
    c.env("EDGE_LOCAL_PROJECT", &p.project)
        .env("EDGE_LOCAL_TOOL", tool);
    if p.uses_proxy(if action == "harness" {
        "harness"
    } else {
        "codex"
    }) {
        let proxy = format!("http://127.0.0.1:{}", p.proxy_port);
        c.env("HTTP_PROXY", &proxy).env("HTTPS_PROXY", &proxy);
    }
    #[cfg(windows)]
    c.creation_flags(0x00000010);
    c.kill_on_drop(false);
    c.spawn().map_err(|e| format!("无法打开本机终端：{e}"))?;
    Ok(json!({"message":"已打开本机终端，工具使用本机已有配置"}))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn native_diagnosis_works_without_ssh() {
        let mut p = Profile::local();
        p.host = "-invalid-ssh-host".into();
        let result = execute(&p, "diagnose").await.unwrap();
        assert_eq!(result["platform"], "Windows");
        assert!(result["tools"]["node"].is_boolean());
        assert!(execute(&p, "setup_ssh")
            .await
            .unwrap_err()
            .contains("本机终端"));
        assert!(transport::Rpc::connect(&p).await.is_err());
    }
}
