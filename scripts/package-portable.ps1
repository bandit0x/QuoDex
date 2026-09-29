param(
    [string]$Version = "",
    [string]$WebView2RuntimePath = "",
    [string]$BuildTargetDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Version)) {
    # 单一版本源：package.json；硬编码默认值曾随版本升级失同步（v0.1.8 包名残留到 v0.2.0）
    $Version = (Get-Content (Join-Path $PSScriptRoot "../package.json") -Raw | ConvertFrom-Json).version
}


$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$buildTargetRoot = if ([string]::IsNullOrWhiteSpace($BuildTargetDir)) {
    Join-Path $projectRoot "src-tauri\target"
} else {
    [System.IO.Path]::GetFullPath($BuildTargetDir)
}
$sourceExe = Join-Path $buildTargetRoot "release\codex-credits-view.exe"
$sourceRuntime = Join-Path $projectRoot "node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe"
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "QuoDex-$Version-win-x64"))
$runtimeDir = Join-Path $outputRoot "codex-runtime\bin"
$webview2Dir = Join-Path $outputRoot "webview2-runtime"

if (-not $outputRoot.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to package outside the release directory: $outputRoot"
}

if ([string]::IsNullOrWhiteSpace($WebView2RuntimePath)) {
    $WebView2RuntimePath = Get-ChildItem -LiteralPath (Join-Path $projectRoot ".scratch\tools\webview2-fixed") -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "Microsoft.WebView2.FixedVersionRuntime.*.x64" } |
        Sort-Object Name -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not (Test-Path -LiteralPath $sourceRuntime -PathType Leaf)) {
    throw "Pinned official Codex runtime not found. Run npm.cmd install first."
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

$previousCargoTargetDir = $env:CARGO_TARGET_DIR
try {
    if (-not [string]::IsNullOrWhiteSpace($BuildTargetDir)) {
        $env:CARGO_TARGET_DIR = $buildTargetRoot
    }
    & npm.cmd run tauri:build
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri production build failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $previousCargoTargetDir) {
        Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    } else {
        $env:CARGO_TARGET_DIR = $previousCargoTargetDir
    }
}

if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw "Release executable not found: $sourceExe"
}

if (Test-Path -LiteralPath $outputRoot) {
    Remove-Item -LiteralPath $outputRoot -Recurse -Force
}
[System.IO.Directory]::CreateDirectory($runtimeDir) | Out-Null
[System.IO.Directory]::CreateDirectory($webview2Dir) | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $outputRoot "QuoDex.exe") -Force
Copy-Item -LiteralPath $sourceRuntime -Destination (Join-Path $runtimeDir "codex.exe") -Force
Copy-Item -Path (Join-Path $WebView2RuntimePath "*") -Destination $webview2Dir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD_PARTY_NOTICES.md") -Destination $outputRoot -Force

$files = Get-ChildItem -LiteralPath $outputRoot -File -Recurse |
    Sort-Object FullName
$manifest = [ordered]@{
    product = "QuoDex"
    version = $Version
    platform = "windows-x64"
    webview2Mode = "fixed-runtime"
    webview2Version = ([System.Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $webview2Dir "msedgewebview2.exe")).ProductVersion)
    sourceCommit = (git -c safe.directory=$projectRoot rev-parse --short HEAD 2>$null)
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    files = @($files | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($outputRoot.Length).TrimStart('\')
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputRoot "manifest.json") -Encoding UTF8

[pscustomobject]@{
    Output = $outputRoot
    Files = $manifest.files.Count + 1
    Bytes = ($files | Measure-Object Length -Sum).Sum
}
