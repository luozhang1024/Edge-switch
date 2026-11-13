use crate::{store, transport, State};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

fn ps(script: &str) -> tokio::process::Command {
    let bytes: Vec<_> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut command = transport::command("powershell.exe");
    command.args(["-NoProfile", "-EncodedCommand", &STANDARD.encode(bytes)]);
    command
}
pub async fn inventory_local() -> Result<Value, String> {
    let mut command = ps(r#"
      $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
      $env:PATH=[Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine')+';'+$env:PATH
      $rows=@(); $npmPackages=@{}
      if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
        try { $raw= & npm.cmd list -g --depth=0 --json 2>$null; $npmPackages=($raw -join "`n" | ConvertFrom-Json).dependencies } catch {}
      }
      foreach ($item in @(@('codex','codex','@openai/codex'),@('claude','claude','@anthropic-ai/claude-code'),@('harness','dsh','@deepseek-ai/dsh'),@('gemini','gemini','@google/gemini-cli'),@('opencode','opencode','opencode-ai'),@('grok','grok','@vibe-kit/grok-cli'),@('qwen','qwen','@qwen-code/qwen-code'),@('copilot','copilot','@github/copilot'),@('kimi','kimi',''),@('node','node',''),@('git','git',''),@('vscode','code',''))) {
        $found=Get-Command $item[1] -ErrorAction SilentlyContinue | Select-Object -First 1
        $version=''; $managed=$false
        if ($item[0] -eq 'kimi' -and (Get-Command uv -ErrorAction SilentlyContinue)) { $managed=[bool]((& uv tool list 2>$null) -match '^kimi-cli\s') }
        if ($item[2] -and $npmPackages.($item[2])) { $version=$npmPackages.($item[2]).version; $managed=$true }
        elseif ($found) { try { $version=((& $found.Source --version 2>$null | Select-Object -First 1) -join '').Trim() } catch {} }
        $rows+=@{id=$item[0];installed=([bool]$found -or $managed);version=$version;path=if($found){$found.Source}else{''};managed=$managed;can_remove=($managed -or $item[0] -in @('node','git','vscode'));can_upgrade=($managed -or !$found -or $item[0] -in @('node','git','vscode'))}
      }
      @{tools=$rows} | ConvertTo-Json -Depth 5 -Compress
    "#);
    let output = tokio::time::timeout(std::time::Duration::from_secs(90), command.output())
        .await
        .map_err(|_| "检查工具超时")?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("读取本机工具信息失败".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "读取本机工具信息失败".into())
}

pub async fn local_action(tool: &str, operation: &str) -> Result<Value, String> {
    if !["install", "upgrade", "uninstall"].contains(&operation) {
        return Err("工具操作无效".into());
    }
    let (package, winget) = match tool {
        "codex" => ("@openai/codex", ""),
        "claude" => ("@anthropic-ai/claude-code", ""),
        "harness" => ("@deepseek-ai/dsh", ""),
        "gemini" => ("@google/gemini-cli", ""),
        "opencode" => ("opencode-ai", ""),
        "grok" => ("@vibe-kit/grok-cli", ""),
        "qwen" => ("@qwen-code/qwen-code", ""),
        "copilot" => ("@github/copilot", ""),
        "kimi" => ("kimi-cli", ""),
        "node" => ("", "OpenJS.NodeJS.LTS"),
        "git" => ("", "Git.Git"),
        "vscode" => ("", "Microsoft.VisualStudioCode"),
        _ => return Err("工具无效".into()),
    };
    if !package.is_empty() && operation != "install" {
        let inventory = inventory_local().await?;
        if !inventory["tools"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|v| v["id"] == tool && v["managed"] == true)
        {
            return Err("该工具不是 Edge Switch 支持的包管理器安装，请使用原安装方式管理".into());
        }
    }
    let script = if tool == "kimi" {
        r#"
      $ErrorActionPreference='Stop'
      $uv=Get-Command uv -ErrorAction SilentlyContinue
      if (!$uv) {
        if (!(Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw '请先安装 uv：winget install --id astral-sh.uv --exact' }
        $proxyArgs=@(); if ($env:HTTPS_PROXY) { $proxyArgs=@('--proxy',$env:HTTPS_PROXY) }
        & winget.exe install --id astral-sh.uv --exact --source winget --silent --disable-interactivity --accept-source-agreements --accept-package-agreements @proxyArgs
        if ($LASTEXITCODE) { exit $LASTEXITCODE }
        $env:PATH=[Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine')
        $uv=Get-Command uv -ErrorAction SilentlyContinue
        if (!$uv) { throw 'uv 安装完成，请重启应用后安装 Kimi Code' }
      }
      if ($env:EDGE_TOOL_OPERATION -eq 'uninstall') { & $uv.Source tool uninstall kimi-cli }
      elseif ($env:EDGE_TOOL_OPERATION -eq 'upgrade') { & $uv.Source tool upgrade kimi-cli }
      else { & $uv.Source tool install --python 3.13 kimi-cli; if (!$LASTEXITCODE) { & $uv.Source tool update-shell } }
      exit $LASTEXITCODE
    "#
    } else if winget.is_empty() {
        r#"
      $ErrorActionPreference='Stop'
      if (!(Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js LTS' }
      if ($env:EDGE_TOOL_OPERATION -eq 'uninstall') { & npm.cmd uninstall -g $env:EDGE_TOOL_PACKAGE }
      else { & npm.cmd install -g ($env:EDGE_TOOL_PACKAGE+'@latest') --no-audit --no-fund }
      exit $LASTEXITCODE
    "#
    } else {
        r#"
      $ErrorActionPreference='Stop'
      if (!(Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw '未找到 winget，请安装 Windows 应用安装程序' }
      $verb=$env:EDGE_TOOL_OPERATION
      $proxyArgs=@(); if ($env:HTTPS_PROXY) { $proxyArgs=@('--proxy',$env:HTTPS_PROXY) }
      if ($verb -eq 'uninstall') { & winget.exe uninstall --id $env:EDGE_TOOL_WINGET --exact --silent --disable-interactivity }
      else { & winget.exe $verb --id $env:EDGE_TOOL_WINGET --exact --source winget --silent --disable-interactivity --accept-source-agreements --accept-package-agreements @proxyArgs }
      exit $LASTEXITCODE
    "#
    };
    let script = format!(
        "$env:PATH=[Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine')+';'+$env:PATH\n{script}"
    );
    let mut command = ps(&script);
    command
        .env("EDGE_TOOL_OPERATION", operation)
        .env("EDGE_TOOL_PACKAGE", package)
        .env("EDGE_TOOL_WINGET", winget);
    if crate::network::configured().is_some() {
        let proxy = crate::network::url_at(crate::network::port(7890));
        command.env("HTTP_PROXY", &proxy).env("HTTPS_PROXY", &proxy);
    }
    let output = tokio::time::timeout(std::time::Duration::from_secs(1800), command.output())
        .await
        .map_err(|_| "工具操作超时，请刷新核对安装状态")?
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let s = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "工具操作未完成：{}",
            s.chars().take(1500).collect::<String>()
        ));
    }
    Ok(json!({"message":"工具操作已完成，请刷新检查版本","tool":tool,"operation":operation}))
}

#[tauri::command]
pub async fn tool_inventory(
    state: tauri::State<'_, State>,
    profile_id: String,
) -> Result<Value, String> {
    let (p, scope) = {
        let s = state.0.store.lock().unwrap();
        (s.profile(&profile_id)?, s.scope(&profile_id))
    };
    if p.is_local() {
        inventory_local().await
    } else {
        state
            .0
            .call(&p, &scope, "tool_inventory", json!({}), 90)
            .await
    }
}
#[tauri::command]
pub async fn set_tool_visibility(
    state: tauri::State<'_, State>,
    profile_id: String,
    tool: String,
    visible: bool,
) -> Result<(), String> {
    if !store::TOOLS.contains(&tool.as_str()) {
        return Err("工具无效".into());
    }
    let _guard = state.0.mutation.lock().await;
    let mut live = state.0.store.lock().unwrap();
    let mut p = live.profile(&profile_id)?;
    let mut visibility = p.extra.get("tool_visibility").cloned().unwrap_or(json!({}));
    visibility[&tool] = json!(visible);
    p.extra.insert("tool_visibility".into(), visibility);
    live.save_profile(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_unknown_tool_and_operation_without_starting_installer() {
        assert!(local_action("codex", "invalid").await.is_err());
        assert!(local_action("bad;calc", "install").await.is_err());
    }
    #[tokio::test]
    #[ignore = "Read-only inspection of native Windows tool versions"]
    async fn native_inventory_has_version_and_management_metadata() {
        let result = inventory_local().await.unwrap();
        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 12);
        for item in tools {
            assert!(item["installed"].is_boolean());
            assert!(item["version"].is_string());
            assert!(item["can_remove"].is_boolean());
        }
        println!(
            "Native tool detection: {} entries, {} installed",
            tools.len(),
            tools.iter().filter(|v| v["installed"] == true).count()
        );
    }
}
