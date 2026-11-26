# QuoDex official `agy` /statusline bridge (zero-network local push)
# Inspired by yuhuan-dev/antigravity-usage-monitor.
#
# Usage inside `agy` CLI:
#   /statusline powershell -NoProfile -ExecutionPolicy Bypass -File "<LOCALAPPDATA>\QuoDex\GeminiQuota\agy-statusline-bridge.ps1"
#
# Or in ~/.gemini/antigravity-cli/settings.json:
# {
#   "statusLine": {
#     "type": "command",
#     "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"<LOCALAPPDATA>\\QuoDex\\GeminiQuota\\agy-statusline-bridge.ps1\"",
#     "enabled": true
#   }
# }

$ErrorActionPreference = "SilentlyContinue"
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) {
    exit 0
}

try {
    $payload = $raw | ConvertFrom-Json
} catch {
    exit 0
}

# Atomically save ONLY minimal quota fields for QuoDex (no workspace paths, git branch, or chat data).
if ($null -ne $payload.quota) {
    $target = if ($env:QUODEX_AGY_STATUSLINE_FILE) {
        $env:QUODEX_AGY_STATUSLINE_FILE
    } else {
        Join-Path $env:LOCALAPPDATA "QuoDex\GeminiQuota\statusline-quota.json"
    }

    $dir = Split-Path -Parent $target
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $minimalPayload = [ordered]@{
        quota = $payload.quota
    }
    $envelope = [ordered]@{
        observedAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        payload      = $minimalPayload
    } | ConvertTo-Json -Depth 12 -Compress

    $tmp = "$target.$PID.tmp"
    [System.IO.File]::WriteAllText($tmp, $envelope, [System.Text.UTF8Encoding]::new($false))
    Move-Item -Path $tmp -Destination $target -Force
}

# Render a clean compact status line back to `agy` CLI stdout.
$parts = [System.Collections.Generic.List[string]]::new()
if ($payload.model -and $payload.model.id) {
    $parts.Add([string]$payload.model.id)
} elseif ($payload.model -is [string] -and $payload.model) {
    $parts.Add($payload.model)
}

if ($payload.quota) {
    foreach ($entry in @(
        @{ key = "gemini-5h"; label = "G5h" },
        @{ key = "gemini-weekly"; label = "Gw" },
        @{ key = "3p-5h"; label = "3P5h" },
        @{ key = "3p-weekly"; label = "3Pw" }
    )) {
        $bucket = $payload.quota.$($entry.key)
        if ($bucket -and -not $bucket.disabled -and $null -ne $bucket.remaining_fraction) {
            $pct = [Math]::Round([double]$bucket.remaining_fraction * 100)
            $parts.Add("$($entry.label):${pct}%")
        }
    }
}

if ($parts.Count -gt 0) {
    [Console]::Out.Write(($parts -join " | "))
}
