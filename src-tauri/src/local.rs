//! Native Windows entry points. Local tools retain their existing configuration.
use crate::{store::Profile, transport};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};

#[cfg(windows)]
struct DeviceJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for DeviceJob {}
#[cfg(windows)]
impl DeviceJob {
    fn attach(child: &tokio::process::Child) -> Result<Self, String> {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let job = Self(CreateJobObjectW(std::ptr::null(), std::ptr::null()));
            if job.0.is_null() {
                return Err("无法创建授权进程组".into());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(
                    job.0,
                    child.raw_handle().ok_or("登录进程已退出")?.cast(),
                ) == 0
            {
                return Err("无法管理授权进程，请重试".into());
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for DeviceJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

/// Device login is a piped CLI task, so its code and errors stay in the app.
pub async fn device_login(p: &Profile, app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut command = powershell(
        r#"
      $ErrorActionPreference='Stop'
      $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
      Set-Location -LiteralPath $env:EDGE_LOCAL_PROJECT
      $cli=Get-Command codex.cmd,codex.exe,codex -ErrorAction SilentlyContinue | Select-Object -First 1
      if (!$cli) { throw '未找到 Codex，请先安装工具' }
      $ErrorActionPreference='Continue'
      & $cli.Source login --device-auth 2>&1 | ForEach-Object { [Console]::WriteLine($_.ToString()) }
      exit $LASTEXITCODE
    "#,
    );
    command.env("EDGE_LOCAL_PROJECT", &p.project);
    if p.uses_proxy("codex") || crate::network::configured().is_some() {
        let proxy = crate::network::url_at(crate::network::port(p.proxy_port));
        command.env("HTTP_PROXY", &proxy).env("HTTPS_PROXY", &proxy);
    }
    stream_device(command, |line| crate::tasks::progress(app, id, line)).await
}

async fn stream_device(
    mut command: tokio::process::Command,
    output_line: impl Fn(&str),
) -> Result<(), String> {
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    command.kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动设备码登录：{e}"))?;
    #[cfg(windows)]
    let _job = DeviceJob::attach(&child)?;
    let mut output = BufReader::new(child.stdout.take().ok_or("无法读取登录输出")?).lines();
    let mut errors = BufReader::new(child.stderr.take().ok_or("无法读取登录错误")?).lines();
    let ansi = regex::Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").unwrap();
    let work = async {
        let mut last = String::new();
        let (mut out_done, mut err_done) = (false, false);
        while !out_done || !err_done {
            let line = tokio::select! {
                line = output.next_line(), if !out_done => { if line.as_ref().is_ok_and(|v| v.is_none()) { out_done = true; } line },
                line = errors.next_line(), if !err_done => { if line.as_ref().is_ok_and(|v| v.is_none()) { err_done = true; } line },
            }.map_err(|_| "读取设备码登录结果失败")?;
            if let Some(line) = line {
                let clean = ansi.replace_all(&line, "");
                if !clean.trim().is_empty() {
                    last = clean.chars().take(1500).collect();
                    output_line(&last);
                }
            }
        }
        let status = child.wait().await.map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("设备码登录失败：{last}"));
        }
        Ok(())
    };
    tokio::time::timeout(std::time::Duration::from_secs(900), work)
        .await
        .map_err(|_| "设备码授权超时，请重新登录")?
}

fn powershell(script: &str) -> tokio::process::Command {
    let script = format!("$env:PATH=[Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine')+';'+$env:PATH; {script}");
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut c = transport::command("powershell.exe");
    c.args(["-NoProfile", "-EncodedCommand", &STANDARD.encode(bytes)]);
    c
}

pub async fn login(p: &Profile, tool: &str, wait: bool) -> Result<Value, String> {
    let args = match tool {
        "codex" => " login --device-auth",
        "claude" | "opencode" => " auth login",
        "gemini" => "",
        "kimi" => " login",
        "qwen" => "",
        "copilot" => " login",
        _ => return Err("此工具不支持官方终端登录".into()),
    };
    if !std::path::Path::new(&p.project).is_dir() {
        return Err("本机工程目录不存在，请编辑工作环境".into());
    }
    let mut check = powershell(
        "if (!(Get-Command $env:EDGE_LOCAL_TOOL -ErrorAction SilentlyContinue)) { exit 1 }",
    );
    check.env("EDGE_LOCAL_TOOL", tool);
    if !tokio::time::timeout(std::time::Duration::from_secs(20), check.status())
        .await
        .map_err(|_| "检查本机工具超时")?
        .map_err(|e| e.to_string())?
        .success()
    {
        return Err(format!("本机未找到 {tool}，请先在工具安装页安装"));
    }
    let mut command = powershell(&format!("Set-Location -LiteralPath $env:EDGE_LOCAL_PROJECT; $cli=Get-Command ($env:EDGE_LOCAL_TOOL+'.cmd'),($env:EDGE_LOCAL_TOOL+'.exe'),$env:EDGE_LOCAL_TOOL -ErrorAction SilentlyContinue | Select-Object -First 1; & $cli.Source{args}; if ($LASTEXITCODE) {{ Write-Host ('登录失败，退出码：'+$LASTEXITCODE); Read-Host '按 Enter 关闭'; exit $LASTEXITCODE }}"));
    command
        .env("EDGE_LOCAL_TOOL", tool)
        .env("EDGE_LOCAL_PROJECT", &p.project);
    if p.uses_proxy(tool) || crate::network::configured().is_some() {
        let proxy = crate::network::url_at(crate::network::port(p.proxy_port));
        command.env("HTTP_PROXY", &proxy).env("HTTPS_PROXY", &proxy);
    }
    if !wait {
        command.arg("-NoExit");
    }
    #[cfg(windows)]
    command.creation_flags(0x00000010);
    command.kill_on_drop(wait);
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法打开本机授权终端：{e}"))?;
    if wait {
        let status = tokio::time::timeout(std::time::Duration::from_secs(900), child.wait())
            .await
            .map_err(|_| "本机授权等待超时，请重试")?
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("本机授权未完成，请检查终端结果".into());
        }
    }
    Ok(json!({"message":"已打开本机官方授权终端，请按提示完成登录；打开终端不代表授权成功"}))
}

pub async fn execute(p: &Profile, action: &str) -> Result<Value, String> {
    execute_extra(p, action, &Value::Null).await
}
pub async fn execute_extra(p: &Profile, action: &str, payload: &Value) -> Result<Value, String> {
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
        "codex" | "claude" | "gemini" | "opencode" | "kimi" | "grok" | "qwen" | "copilot" => action,
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
    let mut c = powershell("Set-Location -LiteralPath $env:EDGE_LOCAL_PROJECT; if ($env:EDGE_LOCAL_TOOL) { $cli=Get-Command ($env:EDGE_LOCAL_TOOL+'.cmd'),($env:EDGE_LOCAL_TOOL+'.exe'),$env:EDGE_LOCAL_TOOL -ErrorAction SilentlyContinue | Select-Object -First 1; if ($env:EDGE_LOCAL_TOOL -eq 'code') { & $cli.Source . } elseif ($env:EDGE_KIMI_AGENT) { & $cli.Source --agent-file $env:EDGE_KIMI_AGENT } else { & $cli.Source } }");
    c.arg("-NoExit");
    c.env("EDGE_LOCAL_PROJECT", &p.project)
        .env("EDGE_LOCAL_TOOL", tool);
    crate::extra_tools::configure_launch(&mut c, p, action)?;
    if action == "qwen" {
        if let Some(key) = payload["key"].as_str() {
            c.env("EDGE_QWEN_API_KEY", key).env("OPENAI_API_KEY", key);
        }
    }
    if action == "grok" {
        if let (Some(key), Some(base), Some(model)) = (
            payload["key"].as_str(),
            payload["base_url"].as_str(),
            payload["model"].as_str(),
        ) {
            c.env("GROK_API_KEY", key)
                .env("GROK_BASE_URL", base)
                .env("GROK_MODEL", model);
        }
    }
    if crate::network::configured().is_some()
        || p.uses_proxy(if action == "harness" {
            "harness"
        } else {
            "codex"
        })
    {
        let proxy = crate::network::url_at(crate::network::port(p.proxy_port));
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
    async fn device_login_retains_device_code_and_failure_output() {
        let lines = std::sync::Mutex::new(Vec::new());
        let command=powershell("[Console]::WriteLine('https://auth.openai.com/codex/device'); [Console]::WriteLine('ABCD-EFGH'); [Console]::Error.WriteLine('fixture-login-failure'); exit 7");
        let result =
            stream_device(command, |line| lines.lock().unwrap().push(line.to_string())).await;
        assert!(result.is_err());
        let lines = lines.lock().unwrap();
        assert!(lines.iter().any(|line| line.contains("ABCD-EFGH")));
        assert!(lines
            .iter()
            .any(|line| line.contains("fixture-login-failure")));
    }

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
