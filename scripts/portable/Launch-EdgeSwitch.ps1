$ErrorActionPreference = 'Stop'
$diagnosticDirectory = Join-Path $env:LOCALAPPDATA 'EdgeSSHAI'
$logPath = Join-Path $diagnosticDirectory 'portable-launch.log'
New-Item -ItemType Directory -Force -Path $diagnosticDirectory | Out-Null
Start-Transcript -Path $logPath -Append | Out-Null
try {
    Write-Host 'Edge Switch - Portable startup check'
    Write-Host ('Windows: ' + [System.Environment]::OSVersion.VersionString)
    Write-Host ('Architecture: ' + $env:PROCESSOR_ARCHITECTURE)
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'This package requires 64-bit Windows 10/11. A 32-bit OS is not supported.' }
    if ([System.Environment]::OSVersion.Version.Major -lt 10) { throw 'Windows 10 or Windows 11 is required.' }
    $executable = Join-Path $PSScriptRoot 'EdgeSwitch.exe'
    if (-not (Test-Path -LiteralPath $executable)) { throw 'EdgeSwitch.exe is missing. Extract the entire ZIP to a local folder first.' }
    $webviewId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $webviewKeys = @(
        "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$webviewId",
        "HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\$webviewId",
        "HKLM:\Software\Microsoft\EdgeUpdate\Clients\$webviewId"
    )
    $hasWebView = $false
    foreach ($key in $webviewKeys) {
        $version = (Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue).pv
        if ($version -and $version -ne '0.0.0.0') { $hasWebView = $true; Write-Host ('WebView2: ' + $version); break }
    }
    if (-not $hasWebView) {
        Write-Host 'Microsoft Edge WebView2 Runtime is required. The Microsoft bootstrapper needs Internet access.'
        $bootstrapper = Join-Path $PSScriptRoot 'MicrosoftEdgeWebview2Setup.exe'
        if (-not (Test-Path -LiteralPath $bootstrapper)) { throw 'WebView2 bootstrapper is missing. Download WebView2 from https://developer.microsoft.com/microsoft-edge/webview2/ or use the Edge Switch installer.' }
        $setup = Start-Process -FilePath $bootstrapper -ArgumentList '/install' -WindowStyle Hidden -PassThru -Wait
        if ($setup.ExitCode -ne 0) { throw ('WebView2 installation failed: ' + $setup.ExitCode) }
    }
    Write-Host 'Starting Edge Switch...'
    $process = Start-Process -FilePath $executable -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    if ($process.WaitForExit(8000)) {
        if ($process.ExitCode -ne 0) { throw ('Application exited with code ' + $process.ExitCode + '. See startup.log in ' + $diagnosticDirectory) }
        Write-Host 'The startup process exited. An existing instance may be in the system tray.'
    } else { Write-Host 'Edge Switch is running.' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ('Diagnostic log: ' + $logPath)
    exit 1
} finally { Stop-Transcript | Out-Null }
