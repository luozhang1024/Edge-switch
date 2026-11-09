$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
try {
    & node (Join-Path $PSScriptRoot 'check-version.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop version check failed' }
    $buildLog = Join-Path $repo 'build/tauri-build.log'
    New-Item -ItemType Directory -Force (Split-Path -Parent $buildLog) | Out-Null
    & npx.cmd tauri build --bundles nsis 2>&1 | Tee-Object -FilePath $buildLog
    if ($LASTEXITCODE -ne 0) {
        if ($env:GITHUB_ACTIONS -eq 'true') {
            $tail = (Get-Content -LiteralPath $buildLog -Tail 35) -join "`n"
            $escaped = $tail.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
            Write-Output "::error title=Desktop build failed::$escaped"
        }
        throw 'Tauri build failed; see build/tauri-build.log'
    }
    & (Join-Path $PSScriptRoot 'package-desktop.ps1')
} finally { Pop-Location }
