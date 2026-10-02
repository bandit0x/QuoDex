param([string]$RequestBase64)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$taskRequest = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json
if ($taskRequest.op -eq 'background') {
  Add-Type -AssemblyName System.Windows.Forms
  $taskForm = [System.Windows.Forms.Form]::new()
  $taskForm.FormBorderStyle = 'None'
  $taskForm.StartPosition = 'Manual'
  $taskForm.Location = [System.Drawing.Point]::new(350,100)
  $taskForm.Size = [System.Drawing.Size]::new(450,750)
  $taskForm.BackColor = [System.Drawing.Color]::FromArgb(19,34,47)
  $taskForm.ShowInTaskbar = $false
  $taskForm.TopMost = $true
  [System.Windows.Forms.Application]::Run($taskForm)
  exit
}
Add-Type -Path (Join-Path $PSHOME 'WindowsBase.dll')
Add-Type -Path (Join-Path $PSHOME 'UIAutomationTypes.dll')
Add-Type -Path (Join-Path $PSHOME 'UIAutomationClient.dll')
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class QuoDexNative {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr handle,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
$taskProcess = Get-Process -Id $taskRequest.pid
$taskHandle = $taskProcess.MainWindowHandle
if ($taskHandle -eq [IntPtr]::Zero) { throw 'Native window not available' }
if ($taskRequest.op -eq 'position') { [void][QuoDexNative]::SetWindowPos($taskHandle,[IntPtr]::Zero,400,500,0,0,5) }
if ($taskRequest.op -in @('position','capture','pulse','hover','click')) { [void][QuoDexNative]::SetWindowPos($taskHandle,[IntPtr]::new(-1),0,0,0,0,19) }
$taskRect = [QuoDexNative+Rect]::new()
[void][QuoDexNative]::GetWindowRect($taskHandle,[ref]$taskRect)
$taskRoot = [System.Windows.Automation.AutomationElement]::FromHandle($taskHandle)
$taskElements = $taskRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$taskButtons = @($taskElements | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
$taskResult = @{ width=$taskRect.Right-$taskRect.Left; height=$taskRect.Bottom-$taskRect.Top; x=$taskRect.Left; y=$taskRect.Top; buttons=@($taskButtons | ForEach-Object { $_.Current.Name }); names=@($taskElements | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) }
if($taskRequest.op -in @('click','hover')) {
  $taskTarget = $taskButtons | Where-Object { $_.Current.Name -eq $taskRequest.name } | Select-Object -First 1
  if(!$taskTarget){ throw "Button not found: $($taskRequest.name)" }
  $taskBounds = $taskTarget.Current.BoundingRectangle
  $taskResult.target = @{x=$taskBounds.X;y=$taskBounds.Y;width=$taskBounds.Width;height=$taskBounds.Height;offscreen=$taskTarget.Current.IsOffscreen;enabled=$taskTarget.Current.IsEnabled;patterns=@($taskTarget.GetSupportedPatterns() | ForEach-Object {$_.ProgrammaticName})}
  [void][QuoDexNative]::SetForegroundWindow($taskHandle)
  [void][QuoDexNative]::SetCursorPos($taskRect.Right+10,$taskRect.Bottom+10)
  Start-Sleep -Milliseconds 30
  [void][QuoDexNative]::SetCursorPos([int]($taskBounds.X+$taskBounds.Width/2),[int]($taskBounds.Y+$taskBounds.Height/2))
  if($taskRequest.op -eq 'click') {
    $taskInvoke = $null
    $taskExpand = $null
    if($taskTarget.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$taskInvoke)) { $taskResult.action='invoke'; $taskInvoke.Invoke() }
    elseif($taskTarget.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$taskExpand)) {
      $taskResult.action='expand-collapse'
      if($taskExpand.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) { $taskExpand.Collapse() } else { $taskExpand.Expand() }
    }
    else {
      $taskResult.action='mouse'
      Start-Sleep -Milliseconds 70
      [QuoDexNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
      [QuoDexNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    }
  } else {
    $taskResult.target = @{x=$taskBounds.X;y=$taskBounds.Y;width=$taskBounds.Width;height=$taskBounds.Height}
    [void][QuoDexNative]::SetCursorPos([int]($taskBounds.X+$taskBounds.Width/2),[int]($taskBounds.Y+$taskBounds.Height/2))
    $taskResult.trace = @(0..6 | ForEach-Object {
      $taskSample = [QuoDexNative+Rect]::new()
      [void][QuoDexNative]::GetWindowRect($taskHandle,[ref]$taskSample)
      @{time=$_*50;height=$taskSample.Bottom-$taskSample.Top;y=$taskSample.Top}
      Start-Sleep -Milliseconds 50
    })
  }
}
if($taskRequest.op -eq 'escape') {
  [void][QuoDexNative]::SetForegroundWindow($taskHandle)
  [QuoDexNative]::keybd_event(27,0,0,[UIntPtr]::Zero)
  [QuoDexNative]::keybd_event(27,0,2,[UIntPtr]::Zero)
  [void][QuoDexNative]::SetCursorPos($taskRect.Right+10,$taskRect.Bottom+10)
}
if($taskRequest.op -eq 'capture') {
  $taskBitmap = [System.Drawing.Bitmap]::new($taskResult.width,$taskResult.height)
  try {
    $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
    try { $taskGraphics.CopyFromScreen($taskRect.Left,$taskRect.Top,0,0,$taskBitmap.Size) } finally { $taskGraphics.Dispose() }
    $taskBitmap.Save($taskRequest.path,[System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $taskBitmap.Dispose() }
}
if($taskRequest.op -eq 'pulse') {
  $taskTarget = $taskButtons | Where-Object { $_.Current.Name -eq $taskRequest.name } | Select-Object -First 1
  $taskBounds = $taskTarget.Current.BoundingRectangle
  $taskClock = [Diagnostics.Stopwatch]::StartNew()
  $taskResult.pulse = @(0..14 | ForEach-Object {
    $taskFrame = $_
    $taskBitmap = [System.Drawing.Bitmap]::new($taskResult.width,$taskResult.height)
    try {
      $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
      try { $taskGraphics.CopyFromScreen($taskRect.Left,$taskRect.Top,0,0,$taskBitmap.Size) } finally { $taskGraphics.Dispose() }
      $taskGreen = 0
      for($taskX=0;$taskX -lt [int]$taskBounds.Width;$taskX++) { for($taskY=0;$taskY -lt [int]$taskBounds.Height;$taskY++) {
        $taskGreen += $taskBitmap.GetPixel([int]($taskBounds.X-$taskRect.Left)+$taskX,[int]($taskBounds.Y-$taskRect.Top)+$taskY).G
      } }
      if($taskFrame -in @(0,7,14)) { $taskBitmap.Save((Join-Path $taskRequest.path "pulse-$taskFrame.png"),[System.Drawing.Imaging.ImageFormat]::Png) }
      @{ elapsedMs=$taskClock.ElapsedMilliseconds; greenMean=$taskGreen/($taskBounds.Width*$taskBounds.Height) }
    } finally { $taskBitmap.Dispose() }
    Start-Sleep -Milliseconds 100
  })
}
$taskResult | ConvertTo-Json -Depth 5 -Compress
