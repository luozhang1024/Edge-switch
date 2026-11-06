$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
try {
    & node (Join-Path $PSScriptRoot 'check-version.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop version check failed' }
    & npx.cmd tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed' }
    & (Join-Path $PSScriptRoot 'package-desktop.ps1')
} finally { Pop-Location }
