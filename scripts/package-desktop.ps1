$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
try {
    $version = (Get-Content -Raw package.json | ConvertFrom-Json).version
    $output = Join-Path $repo 'dist/tauri'
    $portable = Join-Path $repo ('build/tauri/portable-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $output | Out-Null
    New-Item -ItemType Directory -Force $portable | Out-Null
    Copy-Item -LiteralPath 'src-tauri/target/release/edge-switch.exe' -Destination (Join-Path $portable 'EdgeSwitch.exe') -Force
    Copy-Item -LiteralPath 'LICENSE', 'README.md', 'README.en.md' -Destination $portable -Force
    $portableDocs = Join-Path $portable 'docs'
    New-Item -ItemType Directory -Force $portableDocs | Out-Null
    Copy-Item -LiteralPath 'docs/tauri-migration.md' -Destination $portableDocs -Force
    Copy-Item -LiteralPath 'src-tauri/target/release/edge-switch.exe' -Destination (Join-Path $output 'EdgeSwitch.exe') -Force
    Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle/nsis' -Filter '*.exe' -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $output -Force }
    $zip = Join-Path $output "EdgeSwitch-$version-Windows-x64.zip"
    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        try {
            Compress-Archive -Path (Join-Path $portable '*') -DestinationPath $zip -Force
            break
        } catch {
            if ($attempt -eq 7) { throw }
            Start-Sleep -Milliseconds (500 * ($attempt + 1))
        }
    }
    $lines = Get-ChildItem -LiteralPath $output -File | Where-Object { $_.Extension -in '.exe', '.zip' } | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name }
    [System.IO.File]::WriteAllLines((Join-Path $output 'SHA256SUMS.txt'), $lines, [System.Text.UTF8Encoding]::new($false))
    Write-Output "Build artifacts: $output"
} finally { Pop-Location }
