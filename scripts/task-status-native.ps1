param([string]$RequestBase64)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$taskRequest = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json
if ($taskRequest.op -eq 'shortcut') {
  $taskShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'QuoDex.lnk'
  if ($taskRequest.action -eq 'save') {
    $taskShortcutExists = Test-Path -LiteralPath $taskShortcutPath
    if ($taskShortcutExists) { Copy-Item -LiteralPath $taskShortcutPath -Destination $taskRequest.backup }
    @{ exists=$taskShortcutExists } | ConvertTo-Json -Compress
  } elseif (Test-Path -LiteralPath $taskShortcutPath) {
    $taskShortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($taskShortcutPath)
    $taskShortcutRestored = $false
    if ($taskShortcut.TargetPath -eq $taskRequest.executable) {
      if ($taskRequest.existed) { Copy-Item -LiteralPath $taskRequest.backup -Destination $taskShortcutPath -Force }
      else { Remove-Item -LiteralPath $taskShortcutPath }
      $taskShortcutRestored = $true
    }
    @{ restored=$taskShortcutRestored } | ConvertTo-Json -Compress
  } else { @{ restored=$false } | ConvertTo-Json -Compress }
  exit
}
if ($taskRequest.op -eq 'background') {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public class QuoDexBackdrop {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr handle,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
}
'@
  $taskForm = [System.Windows.Forms.Form]::new()
  $taskForm.FormBorderStyle = 'None'
  $taskForm.StartPosition = 'Manual'
  $taskForm.Bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $taskForm.BackColor = [System.Drawing.Color]::FromArgb(19,34,47)
  $taskForm.ShowInTaskbar = $false
  $taskForm.TopMost = $true
  if ($taskRequest.clickPath) {
    $taskClickState = @{count=0}
    @{count=0} | ConvertTo-Json -Compress | Set-Content -LiteralPath $taskRequest.clickPath -Encoding utf8
    $taskForm.Add_MouseDown({
      $taskClickState.count++
      @{count=$taskClickState.count; x=[System.Windows.Forms.Cursor]::Position.X; y=[System.Windows.Forms.Cursor]::Position.Y} |
        ConvertTo-Json -Compress | Set-Content -LiteralPath $taskRequest.clickPath -Encoding utf8
    })
  }
  # A hidden process launch can suppress the first ShowWindow call. Reveal only
  # this test-owned form after startup, without activating another application.
  $taskTimer = [System.Windows.Forms.Timer]::new()
  $taskTimer.Interval = 250
  $taskTimer.Add_Tick({
    $taskBounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
    [void][QuoDexBackdrop]::SetWindowPos($taskForm.Handle,[IntPtr]::new(-1),$taskBounds.X,$taskBounds.Y,$taskBounds.Width,$taskBounds.Height,80)
    if ($taskRequest.readyPath) {
      @{visible=[QuoDexBackdrop]::IsWindowVisible($taskForm.Handle)} | ConvertTo-Json -Compress | Set-Content -LiteralPath $taskRequest.readyPath -Encoding utf8
    }
    $taskTimer.Stop()
  })
  $taskTimer.Start()
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
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr handle,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr handle,int index);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr handle,uint flags);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr handle);
  public static void MovePointer(int x,int y) {
    uint nx=(uint)Math.Clamp((x-GetSystemMetrics(76)+0.5)*65536/GetSystemMetrics(78),0,65535);
    uint ny=(uint)Math.Clamp((y-GetSystemMetrics(77)+0.5)*65536/GetSystemMetrics(79),0,65535);
    // Generate a real input movement (including low-level hooks), rather than
    // silently warping the pointer with SetCursorPos before an immediate click.
    mouse_event(0xC001,nx,ny,0,UIntPtr.Zero);
  }
}
'@
$taskProcess = Get-Process -Id $taskRequest.pid
$taskHandle = $taskProcess.MainWindowHandle
if ($taskHandle -eq [IntPtr]::Zero) { throw 'Native window not available' }
if ($taskRequest.op -eq 'zorder') {
  $taskOrder=if ($taskRequest.topmost) { -1 } else { -2 }
  [void][QuoDexNative]::SetWindowPos($taskHandle,[IntPtr]::new($taskOrder),0,0,0,0,19)
}
if ($taskRequest.op -eq 'position') {
  $taskX=if ($null -ne $taskRequest.x) { [int]$taskRequest.x } else { 400 }
  $taskY=if ($null -ne $taskRequest.y) { [int]$taskRequest.y } else { 500 }
  [void][QuoDexNative]::SetWindowPos($taskHandle,[IntPtr]::Zero,$taskX,$taskY,0,0,5)
}
if ($taskRequest.op -in @('position','capture','pulse','hover','click','settings')) { [void][QuoDexNative]::SetWindowPos($taskHandle,[IntPtr]::new(-1),0,0,0,0,19) }
$taskRect = [QuoDexNative+Rect]::new()
[void][QuoDexNative]::GetWindowRect($taskHandle,[ref]$taskRect)
$taskRoot = [System.Windows.Automation.AutomationElement]::FromHandle($taskHandle)
$taskElements = $taskRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
$taskButtons = @($taskElements | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
$taskResult = @{ width=$taskRect.Right-$taskRect.Left; height=$taskRect.Bottom-$taskRect.Top; x=$taskRect.Left; y=$taskRect.Top; buttons=@($taskButtons | ForEach-Object { $_.Current.Name }); names=@($taskElements | ForEach-Object { $_.Current.Name } | Where-Object { $_ }) }
$taskCursor=[QuoDexNative+Point]::new()
[void][QuoDexNative]::GetCursorPos([ref]$taskCursor)
$taskResult.cursor=@{x=$taskCursor.X;y=$taskCursor.Y}
$taskResult.topmost=([QuoDexNative]::GetWindowLongPtr($taskHandle,-20).ToInt64() -band 8) -ne 0
$taskResult.dpi=[int][QuoDexNative]::GetDpiForWindow($taskHandle)
$taskResult.executable=$taskProcess.Path
$taskResult.version=(Get-Item -LiteralPath $taskProcess.Path).VersionInfo.ProductVersion
$taskResult.buttonBounds = @($taskButtons | ForEach-Object { $taskB = $_.Current.BoundingRectangle; @{ name=$_.Current.Name; help=$_.Current.HelpText; x=$taskB.X; y=$taskB.Y; width=$taskB.Width; height=$taskB.Height } })
if ($taskRequest.op -eq 'cpu') {
  $taskAllProcesses = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId
  $taskOwnedIds = [Collections.Generic.HashSet[int]]::new()
  [void]$taskOwnedIds.Add([int]$taskRequest.pid)
  do {
    $taskAdded = $false
    foreach ($taskChild in $taskAllProcesses) {
      if ($taskOwnedIds.Contains([int]$taskChild.ParentProcessId) -and $taskOwnedIds.Add([int]$taskChild.ProcessId)) { $taskAdded = $true }
    }
  } while ($taskAdded)
  $taskCpuProcesses = @(Get-Process -Id @($taskOwnedIds) -ErrorAction SilentlyContinue)
  $taskResult.cpuSeconds = ($taskCpuProcesses | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
  $taskResult.processCount = $taskCpuProcesses.Count
}
if($taskRequest.op -in @('click','hover')) {
  $taskTarget = $taskButtons | Where-Object { $_.Current.Name -eq $taskRequest.name } | Select-Object -First 1
  if(!$taskTarget){ throw "Button not found: $($taskRequest.name)" }
  $taskBounds = $taskTarget.Current.BoundingRectangle
  $taskResult.target = @{x=$taskBounds.X;y=$taskBounds.Y;width=$taskBounds.Width;height=$taskBounds.Height;offscreen=$taskTarget.Current.IsOffscreen;enabled=$taskTarget.Current.IsEnabled;patterns=@($taskTarget.GetSupportedPatterns() | ForEach-Object {$_.ProgrammaticName})}
  [void][QuoDexNative]::SetForegroundWindow($taskHandle)
  # Activation can restore the previous WebView focus and resize its popover.
  # Let that settle before locating and entering a different task's button.
  Start-Sleep -Milliseconds 300
  [void][QuoDexNative]::GetWindowRect($taskHandle,[ref]$taskRect)
  $taskBounds = $taskTarget.Current.BoundingRectangle
  $taskResult.target = @{x=$taskBounds.X;y=$taskBounds.Y;width=$taskBounds.Width;height=$taskBounds.Height;offscreen=$taskTarget.Current.IsOffscreen;enabled=$taskTarget.Current.IsEnabled;patterns=@($taskTarget.GetSupportedPatterns() | ForEach-Object {$_.ProgrammaticName})}
  [QuoDexNative]::MovePointer($taskRect.Right+10,$taskRect.Bottom+10)
  Start-Sleep -Milliseconds 30
  [QuoDexNative]::MovePointer([int]($taskBounds.X+$taskBounds.Width/2),[int]($taskBounds.Y+$taskBounds.Height/2))
  if($taskRequest.op -eq 'click') {
    # WebView's aria-expanded pattern can change without delivering React's click event.
    $taskResult.action='mouse'
    Start-Sleep -Milliseconds 70
    [QuoDexNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [QuoDexNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    # A resize can place a chat under the old click position; hover is tested separately.
    if ($taskRequest.movePointerAway) { [QuoDexNative]::MovePointer($taskRect.Right+100,$taskRect.Bottom+100) }
  } else {
    $taskResult.target = @{x=$taskBounds.X;y=$taskBounds.Y;width=$taskBounds.Width;height=$taskBounds.Height}
    [QuoDexNative]::MovePointer([int]($taskBounds.X+$taskBounds.Width/2),[int]($taskBounds.Y+$taskBounds.Height/2))
    $taskResult.trace = @(0..6 | ForEach-Object {
      $taskSample = [QuoDexNative+Rect]::new()
      [void][QuoDexNative]::GetWindowRect($taskHandle,[ref]$taskSample)
      @{time=$_*50;height=$taskSample.Bottom-$taskSample.Top;y=$taskSample.Top}
      Start-Sleep -Milliseconds 50
    })
  }
}
if($taskRequest.op -eq 'settings') {
  [void][QuoDexNative]::SetForegroundWindow($taskHandle)
  [QuoDexNative]::MovePointer($taskRect.Left+100,$taskRect.Bottom-64)
  [QuoDexNative]::mouse_event(8,0,0,0,[UIntPtr]::Zero)
  [QuoDexNative]::mouse_event(16,0,0,0,[UIntPtr]::Zero)
}
if($taskRequest.op -eq 'escape') {
  [void][QuoDexNative]::SetForegroundWindow($taskHandle)
  [QuoDexNative]::keybd_event(27,0,0,[UIntPtr]::Zero)
  [QuoDexNative]::keybd_event(27,0,2,[UIntPtr]::Zero)
  [QuoDexNative]::MovePointer($taskRect.Right+10,$taskRect.Bottom+10)
}
if($taskRequest.op -eq 'leave') {
  [QuoDexNative]::MovePointer($taskRect.Right+100,$taskRect.Bottom+100)
}
if($taskRequest.op -eq 'clickPoint') {
  [QuoDexNative]::MovePointer([int]$taskRequest.x,[int]$taskRequest.y)
  $taskDelay = if ($null -ne $taskRequest.delayMs) { [int]$taskRequest.delayMs } else { 100 }
  if ($taskDelay -gt 0) { Start-Sleep -Milliseconds $taskDelay }
  $taskResult.styleBeforeClick=('0x{0:X}' -f [QuoDexNative]::GetWindowLongPtr($taskHandle,-20).ToInt64())
  $taskPoint=[QuoDexNative+Point]::new(); $taskPoint.X=[int]$taskRequest.x; $taskPoint.Y=[int]$taskRequest.y
  $taskResult.hitRootBeforeClick=('0x{0:X}' -f [QuoDexNative]::GetAncestor([QuoDexNative]::WindowFromPoint($taskPoint),2).ToInt64())
  [QuoDexNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  [QuoDexNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}
if($taskRequest.op -eq 'movePoint') {
  [QuoDexNative]::MovePointer([int]$taskRequest.x,[int]$taskRequest.y)
}
if($taskRequest.op -eq 'dragPoint') {
  [QuoDexNative]::MovePointer([int]$taskRequest.x,[int]$taskRequest.y)
  [QuoDexNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  try {
    for ($taskStep=1;$taskStep -le 10;$taskStep++) {
      [QuoDexNative]::MovePointer([int]($taskRequest.x+$taskRequest.dx*$taskStep/10),[int]($taskRequest.y+$taskRequest.dy*$taskStep/10))
      Start-Sleep -Milliseconds 15
    }
  } finally { [QuoDexNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
}
if($taskRequest.op -eq 'toggle') {
  $taskTarget = $taskElements | Where-Object { $_.Current.Name -eq $taskRequest.name -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::CheckBox } | Select-Object -First 1
  if(!$taskTarget){ throw "Checkbox not found: $($taskRequest.name)" }
  $taskTarget.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()
}
if($taskRequest.op -eq 'capture') {
  $taskBitmap = [System.Drawing.Bitmap]::new($taskResult.width,$taskResult.height)
  try {
    $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
    try { $taskGraphics.CopyFromScreen($taskRect.Left,$taskRect.Top,0,0,$taskBitmap.Size) } finally { $taskGraphics.Dispose() }
    $taskBitmap.Save($taskRequest.path,[System.Drawing.Imaging.ImageFormat]::Png)
    $taskCorner=$taskBitmap.GetPixel(0,0)
    $taskResult.backgroundPixel=@{r=[int]$taskCorner.R;g=[int]$taskCorner.G;b=[int]$taskCorner.B}
    if ($null -ne $taskRequest.sampleX -and $null -ne $taskRequest.sampleY) {
      $taskPixel=$taskBitmap.GetPixel([int]$taskRequest.sampleX,[int]$taskRequest.sampleY)
      $taskResult.samplePixel=@{r=[int]$taskPixel.R;g=[int]$taskPixel.G;b=[int]$taskPixel.B}
    }
    if ($null -ne $taskRequest.contentX -and $null -ne $taskRequest.contentY) {
      $taskPixel=$taskBitmap.GetPixel([int]$taskRequest.contentX,[int]$taskRequest.contentY)
      $taskResult.contentPixel=@{r=[int]$taskPixel.R;g=[int]$taskPixel.G;b=[int]$taskPixel.B}
    }
  } finally { $taskBitmap.Dispose() }
}
if($taskRequest.op -eq 'pulse') {
  $taskTarget = $taskButtons | Where-Object { $_.Current.Name -eq $taskRequest.name } | Select-Object -First 1
  $taskBounds = $taskTarget.Current.BoundingRectangle
  $taskClock = [Diagnostics.Stopwatch]::StartNew()
  $taskSampleCount = if ($taskRequest.samples) { [int]$taskRequest.samples } else { 15 }
  $taskResult.pulse = @(0..($taskSampleCount-1) | ForEach-Object {
    $taskFrame = $_
    $taskBitmap = [System.Drawing.Bitmap]::new($taskResult.width,$taskResult.height)
    try {
      $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
      try { $taskGraphics.CopyFromScreen($taskRect.Left,$taskRect.Top,0,0,$taskBitmap.Size) } finally { $taskGraphics.Dispose() }
      $taskGreen = 0; $taskRingPixels = 0; $taskBrightWeight = 0; $taskBrightX = 0; $taskBrightY = 0
      # Sample inside the opaque water rim, excluding the transparent hit target and desktop.
      # UIA's 28px button height is the 100% Windows scale reference; radius scales with DPI.
      $taskRingScale = $taskBounds.Height / 28
      for($taskX=0;$taskX -lt [int]$taskBounds.Width;$taskX++) { for($taskY=0;$taskY -lt [int]$taskBounds.Height;$taskY++) {
        $taskDx = $taskX+.5-$taskBounds.Width/2; $taskDy = $taskY+.5-$taskBounds.Height/2
        $taskRadius = [Math]::Sqrt($taskDx*$taskDx+$taskDy*$taskDy)/$taskRingScale
        if($taskRadius -lt 8 -or $taskRadius -gt 9.6) { continue }
        $taskPixelGreen = $taskBitmap.GetPixel([int]($taskBounds.X-$taskRect.Left)+$taskX,[int]($taskBounds.Y-$taskRect.Top)+$taskY).G
        $taskGreen += $taskPixelGreen; $taskRingPixels++
        $taskWeight = [Math]::Max(0,$taskPixelGreen-150)
        $taskBrightWeight += $taskWeight; $taskBrightX += $taskDx*$taskWeight; $taskBrightY += $taskDy*$taskWeight
      } }
      if($taskFrame -in @(0,7,14)) { $taskBitmap.Save((Join-Path $taskRequest.path "pulse-$taskFrame.png"),[System.Drawing.Imaging.ImageFormat]::Png) }
      if($taskRequest.saveAll) { $taskBitmap.Save((Join-Path $taskRequest.path ("flow-{0:D3}.png" -f $taskFrame)),[System.Drawing.Imaging.ImageFormat]::Png) }
      @{ elapsedMs=$taskClock.ElapsedMilliseconds; ringPixels=$taskRingPixels; brightWeight=$taskBrightWeight; greenMean=$taskGreen/$taskRingPixels; brightX=if($taskBrightWeight){$taskBrightX/$taskBrightWeight}else{0}; brightY=if($taskBrightWeight){$taskBrightY/$taskBrightWeight}else{0} }
    } finally { $taskBitmap.Dispose() }
    Start-Sleep -Milliseconds 100
  })
}
$taskResult | ConvertTo-Json -Depth 5 -Compress
