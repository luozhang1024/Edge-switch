$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
try {
    & npx.cmd tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed' }
    & (Join-Path $PSScriptRoot 'package-desktop.ps1')
} finally { Pop-Location }
