# Test the installed Windows overlay against three real desktop colors in a fresh profile.
# Run from PowerShell 7 with Node.js and the installed QuoDex fixed WebView2 runtime available.
param(
    [Parameter(Mandatory)][string]$Executable,
    [string]$Label = 'transparency',
    [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'QTR-100: PowerShell 7 required' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class QuoDexTransparencyProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle,out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr handle,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
$taskProject = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $taskProject '.scratch/transparency' }
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$taskProfile = Join-Path $OutputDirectory ($Label + '-profile-' + [guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory((Join-Path $taskProfile 'config')) | Out-Null
@{opacity=0.92; reducedMotion=$true; alwaysOnTop=$true; source='codex'; zcodePlan='start'; x=$null; y=$null} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskProfile 'config/display-preferences.json') -Encoding utf8
$taskShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'QuoDex.lnk'
$taskShortcutBackup = Join-Path $taskProfile 'QuoDex.lnk'
if (Test-Path -LiteralPath $taskShortcutPath) { Copy-Item -LiteralPath $taskShortcutPath -Destination $taskShortcutBackup }
$taskInfo = [System.Diagnostics.ProcessStartInfo]::new()
$taskInfo.FileName = $Executable
$taskInfo.WorkingDirectory = Split-Path -Parent $Executable
$taskInfo.UseShellExecute = $false
$taskInfo.CreateNoWindow = $true
$taskInfo.RedirectStandardInput = $true
$taskInfo.RedirectStandardOutput = $true
$taskInfo.RedirectStandardError = $true
$taskEnvironment = @{
  APPDATA=(Join-Path $taskProfile 'Roaming'); LOCALAPPDATA=(Join-Path $taskProfile 'Local'); USERPROFILE=$taskProfile
  CODEX_CREDITS_CONFIG_DIR=(Join-Path $taskProfile 'config'); CODEX_SQLITE_HOME=(Join-Path $taskProfile 'codex')
  ZCODE_DATA_BASE_DIR=$taskProfile; WEBVIEW2_USER_DATA_FOLDER=(Join-Path $taskProfile 'WebView2')
  WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=(Join-Path (Split-Path -Parent $Executable) 'webview2-runtime')
  CODEX_CREDITS_APP_SERVER_EXECUTABLE=(Get-Command node.exe).Source
  CODEX_CREDITS_APP_SERVER_ARGS=(ConvertTo-Json -InputObject @((Join-Path $taskProject 'fixtures/app-server-fixture.mjs')) -Compress)
}
foreach ($taskKey in $taskEnvironment.Keys) { $taskInfo.Environment[$taskKey] = $taskEnvironment[$taskKey] }
$taskProcess = [System.Diagnostics.Process]::Start($taskInfo)
$taskForm = [System.Windows.Forms.Form]::new()
$taskForm.FormBorderStyle = 'None'
$taskForm.ShowInTaskbar = $false
$taskForm.StartPosition = 'Manual'
$taskForm.TopMost = $true
$taskColors = @(@(239,75,67), @(35,180,105), @(44,125,240))
$taskState = @{index=0; samples=[Collections.Generic.List[object]]::new(); error=$null}
$taskTimer = [System.Windows.Forms.Timer]::new()
$taskTimer.Interval = 700
try {
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 200
    $taskProcess.Refresh()
    if ($taskProcess.HasExited) { throw 'QTR-101: Test app exited during startup' }
  } while ($taskProcess.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $taskDeadline)
  if ($taskProcess.MainWindowHandle -eq [IntPtr]::Zero) { throw 'QTR-102: Test app window missing' }
  Start-Sleep -Seconds 3

  $taskTimer.Add_Tick({
    try {
      $taskIndex = $taskState.index
      if ($taskIndex -ge 9) { $taskTimer.Stop(); $taskForm.Close(); return }
      $taskRect = [QuoDexTransparencyProbe+Rect]::new()
      if (-not [QuoDexTransparencyProbe]::GetWindowRect($taskProcess.MainWindowHandle,[ref]$taskRect)) {
        throw 'QTR-103: Cannot read native window bounds'
      }
      $taskWidth = $taskRect.Right-$taskRect.Left
      $taskHeight = $taskRect.Bottom-$taskRect.Top
      $taskRgb = $taskColors[$taskIndex % 3]
      $taskForm.Bounds = [Drawing.Rectangle]::new($taskRect.Left-20,$taskRect.Top-20,$taskWidth+40,$taskHeight+40)
      $taskForm.BackColor = [Drawing.Color]::FromArgb($taskRgb[0],$taskRgb[1],$taskRgb[2])
      [void][QuoDexTransparencyProbe]::SetWindowPos($taskForm.Handle,[IntPtr]::new(-1),$taskRect.Left-20,$taskRect.Top-20,$taskWidth+40,$taskHeight+40,80)
      $taskForm.Refresh()
      [void][QuoDexTransparencyProbe]::SetWindowPos($taskProcess.MainWindowHandle,[IntPtr]::new(-1),0,0,0,0,19)
      Start-Sleep -Milliseconds 150
      $taskBitmap = [Drawing.Bitmap]::new($taskWidth+40,$taskHeight+40)
      try {
        $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
        try { $taskGraphics.CopyFromScreen($taskRect.Left-20,$taskRect.Top-20,0,0,$taskBitmap.Size) } finally { $taskGraphics.Dispose() }
        $taskLayout = if ($taskIndex -lt 3) { 'compact' } elseif ($taskIndex -lt 6) { 'settings' } else { 'restored' }
        $taskImage = Join-Path $OutputDirectory "$Label-$taskLayout-$($taskIndex % 3).png"
        $taskBitmap.Save($taskImage,[Drawing.Imaging.ImageFormat]::Png)
        $taskActual = $taskBitmap.GetPixel(23,23)
        $taskOutside = $taskBitmap.GetPixel(3,3)
        $taskMatches = [Math]::Abs($taskActual.R-$taskRgb[0]) -le 6 -and [Math]::Abs($taskActual.G-$taskRgb[1]) -le 6 -and [Math]::Abs($taskActual.B-$taskRgb[2]) -le 6
        $taskState.samples.Add(@{layout=$taskLayout; expected=$taskRgb; actual=@([int]$taskActual.R,[int]$taskActual.G,[int]$taskActual.B); outside=@([int]$taskOutside.R,[int]$taskOutside.G,[int]$taskOutside.B); transparent=$taskMatches; width=$taskWidth; height=$taskHeight; image=$taskImage})
      } finally { $taskBitmap.Dispose() }
      if ($taskIndex -eq 2 -or $taskIndex -eq 5) {
        $taskClickY = if ($taskIndex -eq 2) { $taskRect.Bottom-64 } else { $taskRect.Bottom-228 }
        [void][QuoDexTransparencyProbe]::SetCursorPos($taskRect.Left+100,$taskClickY)
        [QuoDexTransparencyProbe]::mouse_event(8,0,0,0,[UIntPtr]::Zero)
        [QuoDexTransparencyProbe]::mouse_event(16,0,0,0,[UIntPtr]::Zero)
      }
      $taskState.index++
    } catch { $taskState.error=$_; $taskTimer.Stop(); $taskForm.Close() }
  })
  $taskTimer.Start()
  [System.Windows.Forms.Application]::Run($taskForm)
  if ($taskState.error) { throw $taskState.error }
  $taskGeometryPassed = $taskState.samples.Count -eq 9 -and
    $taskState.samples[3].height -gt $taskState.samples[0].height -and
    $taskState.samples[6].height -eq $taskState.samples[0].height
  $taskResult = @{executable=$Executable; version=(Get-Item -LiteralPath $Executable).VersionInfo.ProductVersion; samples=$taskState.samples.ToArray(); passed=($taskGeometryPassed -and @($taskState.samples | Where-Object { -not $_.transparent }).Count -eq 0)}
  $taskResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory "$Label-result.json") -Encoding utf8
  $taskResult | Select-Object passed,version | ConvertTo-Json -Compress
  if (-not $taskGeometryPassed) { throw 'QTR-104: Settings did not open and restore the native window size' }
  if (-not $taskResult.passed) { throw 'QTR-001: Native window background does not transmit backdrop colors' }
} finally {
  $taskTimer.Dispose()
  $taskForm.Dispose()
  $taskProcess.Refresh()
  if (-not $taskProcess.HasExited) { Stop-Process -Id $taskProcess.Id -Force }
  $taskProcess.Dispose()
  if (Test-Path -LiteralPath $taskShortcutBackup) {
    $taskCurrentLink=(New-Object -ComObject WScript.Shell).CreateShortcut($taskShortcutPath)
    if ($taskCurrentLink.TargetPath -eq $Executable) { Copy-Item -LiteralPath $taskShortcutBackup -Destination $taskShortcutPath -Force }
  } elseif (Test-Path -LiteralPath $taskShortcutPath) {
    $taskCurrentLink=(New-Object -ComObject WScript.Shell).CreateShortcut($taskShortcutPath)
    if ($taskCurrentLink.TargetPath -eq $Executable) { Remove-Item -LiteralPath $taskShortcutPath }
  }
}
