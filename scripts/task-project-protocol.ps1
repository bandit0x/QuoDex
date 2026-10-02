param([ValidateSet('install','receive','restore')][string]$Action,[string]$Root,[string]$Url)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$taskRoot=[IO.Path]::GetFullPath($Root)
$taskScratch=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.scratch'))
if (!$taskRoot.StartsWith($taskScratch+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Protocol evidence must stay inside .scratch' }
$taskBackup=Join-Path $taskRoot 'zcode-protocol-original.json'
$taskCommand='"'+(Get-Process -Id $PID).Path+'" -NoProfile -WindowStyle Hidden -File "'+$PSCommandPath+'" -Action receive -Root "'+$taskRoot+'" -Url "%1"'
if ($Action -eq 'receive') {
  @{url=$Url;receivedAtMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'project-launch.json') -Encoding utf8
  exit
}
$taskKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Classes\zcode\shell\open\command',$true)
if (!$taskKey) { throw 'Native dispatch smoke requires the installed ZCode protocol' }
try {
  if ($Action -eq 'install') {
    if (Test-Path -LiteralPath $taskBackup) { throw 'Refusing to overwrite protocol backup' }
    $taskOriginal=$taskKey.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $taskKind=$taskKey.GetValueKind('').ToString()
    if ($taskKind -notin @('String','ExpandString')) { throw 'Unsupported protocol command value kind' }
    @{command=$taskOriginal;kind=$taskKind;captureCommand=$taskCommand} | ConvertTo-Json | Set-Content -LiteralPath $taskBackup -Encoding utf8
    $taskKey.SetValue('',$taskCommand,[Microsoft.Win32.RegistryValueKind]::String)
    @{installed=$taskKey.GetValue('') -eq $taskCommand} | ConvertTo-Json -Compress
  } else {
    $taskOriginal=Get-Content -LiteralPath $taskBackup -Raw | ConvertFrom-Json
    if ($taskKey.GetValue('') -ne $taskOriginal.captureCommand) { throw 'Protocol command changed concurrently; preserving the newer command and backup' }
    $taskOriginalKind=[Enum]::Parse([Microsoft.Win32.RegistryValueKind],$taskOriginal.kind)
    $taskKey.SetValue('',$taskOriginal.command,$taskOriginalKind)
    @{restored=$taskKey.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -eq $taskOriginal.command} | ConvertTo-Json -Compress
  }
} finally { $taskKey.Dispose() }
