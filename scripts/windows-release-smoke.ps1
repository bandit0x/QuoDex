param(
  [Parameter(Mandatory)][string]$Installer,
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'QuoDex'),
  [string]$EvidenceDirectory = '.scratch/windows-release-smoke'
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'QWS-100: PowerShell 7 required' }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$EvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
[IO.Directory]::CreateDirectory($EvidenceDirectory) | Out-Null
$taskExecutable = Join-Path $InstallDirectory 'codex-credits-view.exe'
if (@(Get-Process -Name codex-credits-view -ErrorAction SilentlyContinue | Where-Object Path -eq $taskExecutable).Count) {
  throw 'QWS-106: Quit the installed QuoDex before testing its installer.'
}
$taskInstalled = Start-Process -FilePath $Installer -ArgumentList @('/S',"/D=$InstallDirectory") -WindowStyle Hidden -Wait -PassThru
if ($taskInstalled.ExitCode -ne 0) { throw "QWS-107: NSIS exited $($taskInstalled.ExitCode)" }
$taskVersion = (Get-Content (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).version
if ((Get-Item -LiteralPath $taskExecutable).VersionInfo.ProductVersion -ne $taskVersion) { throw 'QWS-108: Installed version differs from package.json' }
$taskRuntime = Join-Path $InstallDirectory 'webview2-runtime/msedgewebview2.exe'
if ((Get-AuthenticodeSignature -LiteralPath $taskRuntime).Status -ne 'Valid') { throw 'QWS-109: Installed fixed runtime signature invalid' }
$taskPreviousExecutable = $env:QUODEX_EXECUTABLE
$taskPreviousReview = $env:QUODEX_TASK_REVIEW_DIR
try {
  $env:QUODEX_EXECUTABLE = $taskExecutable
  $env:QUODEX_TASK_REVIEW_DIR = Join-Path $EvidenceDirectory 'tasks'
  & node.exe (Join-Path $PSScriptRoot 'verify-task-status.mjs') --ci-smoke *> (Join-Path $EvidenceDirectory 'tasks.log')
  if ($LASTEXITCODE -ne 0) { throw 'QWS-110: Native task regression failed; inspect tasks.log' }
  & (Join-Path $PSScriptRoot 'transparency-native.ps1') -Executable $taskExecutable -OutputDirectory (Join-Path $EvidenceDirectory 'transparency') *> (Join-Path $EvidenceDirectory 'transparency.log')
  $taskManifest = [ordered]@{
    status = 'Verified'; version = $taskVersion; source = (& git rev-parse HEAD)
    sourceDirty = [bool](& git status --porcelain)
    installerSha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
    executableSha256 = (Get-FileHash -LiteralPath $taskExecutable -Algorithm SHA256).Hash
    npmLockSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '../package-lock.json')).Hash
    cargoLockSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '../src-tauri/Cargo.lock')).Hash
    node = (& node.exe --version); rust = (& rustc --version)
    windows = [Environment]::OSVersion.VersionString
    runnerImage = $env:ImageVersion
    webview2 = (Get-Item -LiteralPath $taskRuntime).VersionInfo.ProductVersion
    checks = @('NSIS silent installation','two cold starts with both task sources','relocated ZCode desktop index and default CLI journal','native popup hold and normal quit','waiting and cancellation','nine RGB samples across settings round trip')
    limitations = @('Anonymous protocol/SQLite fixtures do not prove a live authenticated task.','125%/150% DPI and multiple monitors require separate acceptance.')
  }
  $taskManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'manifest.json') -Encoding utf8
} finally {
  $env:QUODEX_EXECUTABLE = $taskPreviousExecutable
  $env:QUODEX_TASK_REVIEW_DIR = $taskPreviousReview
}
