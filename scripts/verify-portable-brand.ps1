param(
    [string]$Executable = "",
    [string]$EvidenceDirectory = ""
)

$ErrorActionPreference = "Stop"

function Get-ChildProcessIds {
    param(
        [int]$ParentProcessId
    )

    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentProcessId" -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty ProcessId)
    foreach ($child in $children) {
        $child
        Get-ChildProcessIds -ParentProcessId $child
    }
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ([string]::IsNullOrWhiteSpace($Executable)) {
    $Executable = Join-Path $projectRoot "release\QuoDex-0.0.8-win-x64\QuoDex.exe"
}
$Executable = [System.IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "Portable executable not found: $Executable"
}

$evidenceDirectory = if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    Join-Path $projectRoot "docs\verification\screenshots"
} else {
    [System.IO.Path]::GetFullPath($EvidenceDirectory)
}
[System.IO.Directory]::CreateDirectory($evidenceDirectory) | Out-Null
$profileRoot = Join-Path $env:TEMP ("quodex-verification-" + [guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($profileRoot) | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexMeterWindowApi {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@

$process = $null
try {
    $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Executable)
    if ($version.ProductName -ne "QuoDex" -or $version.FileDescription -ne "QuoDex") {
        throw "Executable metadata does not identify QuoDex."
    }

    $iconPath = Join-Path $evidenceDirectory "quodex-exe-icon.png"
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Executable)
    try {
        $bitmap = $icon.ToBitmap()
        try { $bitmap.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png) }
        finally { $bitmap.Dispose() }
    }
    finally { $icon.Dispose() }

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable
    $startInfo.WorkingDirectory = Split-Path -Parent $Executable
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables["APPDATA"] = Join-Path $profileRoot "Roaming"
    $startInfo.EnvironmentVariables["LOCALAPPDATA"] = Join-Path $profileRoot "Local"
    $startInfo.EnvironmentVariables["USERPROFILE"] = $profileRoot
    $startInfo.EnvironmentVariables["WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"] = Join-Path (Split-Path -Parent $Executable) "webview2-runtime"
    $startInfo.EnvironmentVariables["WEBVIEW2_USER_DATA_FOLDER"] = Join-Path $profileRoot "WebView2"
    $process = [System.Diagnostics.Process]::Start($startInfo)

    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 200
        $process.Refresh()
        if ($process.HasExited) { throw "QuoDex exited during startup with code $($process.ExitCode)." }
    } while ($process.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw "QuoDex did not create a main window within 30 seconds." }

    $handle = $process.MainWindowHandle
    $text = [System.Text.StringBuilder]::new(256)
    do {
        [void]$text.Clear()
        [void][CodexMeterWindowApi]::GetWindowText($handle, $text, $text.Capacity)
        if ($text.ToString() -eq "QuoDex") { break }
        Start-Sleep -Milliseconds 200
        $process.Refresh()
        if ($process.HasExited) { throw "QuoDex exited while initializing with code $($process.ExitCode)." }
    } while ([DateTime]::UtcNow -lt $deadline)
    $rect = [CodexMeterWindowApi+Rect]::new()
    if (-not [CodexMeterWindowApi]::GetWindowRect($handle, [ref]$rect)) { throw "Could not read the window rectangle." }
    if ($text.ToString() -ne "QuoDex") { throw "Unexpected window title: $($text.ToString())" }
    if (($rect.Right - $rect.Left) -ne 300 -or ($rect.Bottom - $rect.Top) -ne 130) {
        throw "Unexpected compact window size: $($rect.Right - $rect.Left)x$($rect.Bottom - $rect.Top)"
    }

    Start-Sleep -Seconds 3
    $windowPath = Join-Path $evidenceDirectory "quodex-real-window.png"
    $windowCaptureStatus = "captured"
    try {
        $windowBitmap = [System.Drawing.Bitmap]::new($rect.Right - $rect.Left, $rect.Bottom - $rect.Top)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($windowBitmap)
            try { $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $windowBitmap.Size) }
            finally { $graphics.Dispose() }
            $windowBitmap.Save($windowPath, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $windowBitmap.Dispose() }
    }
    catch {
        Remove-Item -LiteralPath $windowPath -Force -ErrorAction SilentlyContinue
        $windowCaptureStatus = "not-captured: $($_.Exception.Message)"
    }

    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $nameCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        "QuoDex"
    )
    $namedElements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $nameCondition)
    $taskbarButtons = @($namedElements | Where-Object {
        $_.Current.ClassName -eq "TaskListButton" -or
        $_.Current.AutomationId -like "Taskbar.TaskListButtonAutomationPeer*"
    })
    if ($taskbarButtons.Count -ne 0) { throw "QuoDex unexpectedly created a taskbar button." }

    [void][CodexMeterWindowApi]::SendMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 800
    $process.Refresh()
    if ($process.HasExited) { throw "Closing the overlay terminated QuoDex instead of hiding it to the tray." }
    if ([CodexMeterWindowApi]::IsWindowVisible($handle)) { throw "Closing the overlay did not hide the main window." }

    [pscustomobject]@{
        Executable = $Executable
        ProductName = $version.ProductName
        WindowTitle = $text.ToString()
        WindowSize = "$(($rect.Right - $rect.Left))x$(($rect.Bottom - $rect.Top))"
        TaskbarButtons = $taskbarButtons.Count
        CloseBehavior = "hidden-to-tray"
        IconEvidence = $iconPath
        WindowEvidence = $windowPath
        WindowCapture = $windowCaptureStatus
    }
}
finally {
    $childProcessIds = @()
    if ($null -ne $process) {
        $childProcessIds = @(Get-ChildProcessIds -ParentProcessId $process.Id)
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    foreach ($childProcessId in $childProcessIds | Sort-Object -Descending) {
        Stop-Process -Id $childProcessId -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $profileRoot) {
        for ($attempt = 0; $attempt -lt 10 -and (Test-Path -LiteralPath $profileRoot); $attempt++) {
            try {
                [System.IO.Directory]::Delete($profileRoot, $true)
            }
            catch {
                if ($attempt -eq 9) {
                    Write-Warning "Could not remove temporary verification profile: $profileRoot. $($_.Exception.Message)"
                    break
                }
                Start-Sleep -Milliseconds 500
            }
        }
    }
}
