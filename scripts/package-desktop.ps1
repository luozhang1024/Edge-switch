$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
try {
    $version = (Get-Content -Raw package.json | ConvertFrom-Json).version
    $binary = Get-Item -LiteralPath 'src-tauri/target/release/edge-switch.exe'
    if ($binary.VersionInfo.ProductVersion -ne $version) {
        throw "Executable version $($binary.VersionInfo.ProductVersion) does not match $version; rebuild before packaging"
    }
    $output = Join-Path $repo 'dist/tauri'
    $portable = Join-Path $repo ('build/tauri/portable-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $output | Out-Null
    New-Item -ItemType Directory -Force $portable | Out-Null
    Copy-Item -LiteralPath 'src-tauri/target/release/edge-switch.exe' -Destination (Join-Path $portable 'EdgeSwitch.exe') -Force
    Copy-Item -LiteralPath 'LICENSE', 'README.md', 'README.en.md' -Destination $portable -Force
    Copy-Item -LiteralPath 'scripts/portable/Launch-EdgeSwitch.cmd', 'scripts/portable/Launch-EdgeSwitch.ps1' -Destination $portable -Force
    $bootstrapper = Join-Path $repo 'build/tauri/MicrosoftEdgeWebview2Setup.exe'
    if (-not (Test-Path -LiteralPath $bootstrapper)) {
        New-Item -ItemType Directory -Force (Split-Path -Parent $bootstrapper) | Out-Null
        Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper -UseBasicParsing
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 bootstrapper signature verification failed' }
    Copy-Item -LiteralPath $bootstrapper -Destination $portable -Force
    Copy-Item -LiteralPath 'image/providers/LICENSE' -Destination (Join-Path $portable 'LobeHub-Icons-LICENSE.txt') -Force
    $portableDocs = Join-Path $portable 'docs'
    New-Item -ItemType Directory -Force $portableDocs | Out-Null
    Copy-Item -LiteralPath 'docs/tauri-migration.md', 'docs/model-services.md', 'docs/skills.md' -Destination $portableDocs -Force
    $standalone = Join-Path $output 'EdgeSwitch.exe'
    try {
        Copy-Item -LiteralPath 'src-tauri/target/release/edge-switch.exe' -Destination $standalone -Force
    } catch [System.IO.IOException] {
        # Keep a running portable app intact; produce a reviewable new executable.
        $standalone = Join-Path $output ("EdgeSwitch-$version-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.exe')
        Copy-Item -LiteralPath 'src-tauri/target/release/edge-switch.exe' -Destination $standalone -Force
        Write-Output "Running portable EXE retained; new executable: $standalone"
    }
    Copy-Item -LiteralPath 'image/providers/LICENSE' -Destination (Join-Path $output 'LobeHub-Icons-LICENSE.txt') -Force
    $installer = Join-Path $repo "src-tauri/target/release/bundle/nsis/Edge Switch_${version}_x64-setup.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Current-version installer not found: $installer" }
    Copy-Item -LiteralPath $installer -Destination $output -Force
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
