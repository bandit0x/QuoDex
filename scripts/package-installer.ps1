param(
    [string]$Version = "0.1.7",
    [string]$WebView2RuntimePath = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$scratchRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot ".scratch\installer"))
$cargoTargetRoot = Join-Path $scratchRoot "cargo-target"
$codexRuntime = Join-Path $projectRoot "node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe"
$installerHooks = Join-Path $projectRoot "src-tauri\windows\installer-hooks.nsh"
$generatedConfig = Join-Path $scratchRoot "tauri.installer.conf.json"

if ([string]::IsNullOrWhiteSpace($WebView2RuntimePath)) {
    $WebView2RuntimePath = Get-ChildItem -LiteralPath (Join-Path $projectRoot ".scratch\tools\webview2-fixed") -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "Microsoft.WebView2.FixedVersionRuntime.*.x64" } |
        Sort-Object Name -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not (Test-Path -LiteralPath $codexRuntime -PathType Leaf)) {
    throw "Pinned official Codex runtime not found. Run npm.cmd install first."
}
if (-not (Test-Path -LiteralPath $installerHooks -PathType Leaf)) {
    throw "NSIS installer hooks not found: $installerHooks"
}
if ([string]::IsNullOrWhiteSpace($WebView2RuntimePath) -or
    -not (Test-Path -LiteralPath (Join-Path $WebView2RuntimePath "msedgewebview2.exe") -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $WebView2RuntimePath "msedge.dll") -PathType Leaf)) {
    throw "Complete WebView2 Fixed Runtime not found. Run scripts\fetch-webview2-fixed-runtime.ps1 first."
}

$webviewSignature = Get-AuthenticodeSignature -LiteralPath (Join-Path $WebView2RuntimePath "msedgewebview2.exe")
if ($webviewSignature.Status -ne "Valid" -or $webviewSignature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
    throw "WebView2 runtime signature is not a valid Microsoft signature."
}

[System.IO.Directory]::CreateDirectory($releaseRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($scratchRoot) | Out-Null

$config = [ordered]@{
    version = $Version
    bundle = [ordered]@{
        active = $true
        targets = @("nsis")
        resources = [ordered]@{
            $codexRuntime = "codex-runtime/bin/codex.exe"
            (Join-Path $projectRoot "README.md") = "README.md"
            (Join-Path $projectRoot "THIRD_PARTY_NOTICES.md") = "THIRD_PARTY_NOTICES.md"
        }
        windows = [ordered]@{
            webviewInstallMode = [ordered]@{
                type = "fixedRuntime"
                path = $WebView2RuntimePath
            }
            nsis = [ordered]@{
                installMode = "currentUser"
                installerHooks = $installerHooks
            }
        }
    }
}
$config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $generatedConfig -Encoding UTF8

$previousCargoTargetDir = $env:CARGO_TARGET_DIR
$env:CARGO_TARGET_DIR = $cargoTargetRoot
try {
    & npm.cmd run tauri:build -- --config $generatedConfig
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri NSIS build failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $previousCargoTargetDir) {
        Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    }
    else {
        $env:CARGO_TARGET_DIR = $previousCargoTargetDir
    }
}

$bundleRoot = Join-Path $cargoTargetRoot "release\bundle\nsis"
$builtInstaller = Get-ChildItem -LiteralPath $bundleRoot -File -Filter "*.exe" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if ($null -eq $builtInstaller) {
    throw "Tauri did not produce an NSIS installer under $bundleRoot."
}

$outputInstaller = Join-Path $releaseRoot "CodexMeter-$Version-win-x64-setup.exe"
Copy-Item -LiteralPath $builtInstaller.FullName -Destination $outputInstaller -Force

[pscustomobject]@{
    Output = $outputInstaller
    Bytes = (Get-Item -LiteralPath $outputInstaller).Length
    Sha256 = (Get-FileHash -LiteralPath $outputInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
}
