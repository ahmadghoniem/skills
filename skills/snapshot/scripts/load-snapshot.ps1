# One-shot handoff file for /snapshot. Path: %TEMP%\claude-snapshot-<parent>-<folder>.md
# SessionStart (matcher: clear): inject contents, then delete the file.

$ttlHours = 12

$utf8 = New-Object System.Text.UTF8Encoding $false

$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir) { $projectDir = (Get-Location).Path }

# The last two folders, not just one: two checkouts called 'api' in different
# places would otherwise share one file and overwrite each other's brief.
# Split on the separators, so a hyphen inside a folder name survives.
$parts = $projectDir -split '[:\\/]+' | Where-Object { $_ }
$slug  = ($parts | Select-Object -Last 2) -join '-'
$handoff = Join-Path $env:TEMP "claude-snapshot-$slug.md"
if (-not (Test-Path -LiteralPath $handoff)) { exit 0 }

# Expire a brief nobody came back for: snapshot then no /clear leaves it on disk
# indefinitely, and a stale brief is worse than none -- it describes a session
# whose working tree has since moved on.
$age = (Get-Date) - (Get-Item -LiteralPath $handoff).LastWriteTime
if ($age.TotalHours -gt $ttlHours) { Remove-Item -LiteralPath $handoff -Force; exit 0 }

$body = [System.IO.File]::ReadAllText($handoff, $utf8)
if ([string]::IsNullOrWhiteSpace($body)) { Remove-Item -LiteralPath $handoff -Force; exit 0 }

$json = @{
  hookSpecificOutput = @{
    hookEventName     = 'SessionStart'
    additionalContext = $body
  }
} | ConvertTo-Json -Depth 5 -Compress

# Write UTF-8 bytes straight to stdout. PowerShell's own writers re-encode in the
# console codepage, which turns any non-ASCII character in the brief into bytes
# Claude Code cannot decode as UTF-8 -- the JSON arrives truncated.
$stdout = [Console]::OpenStandardOutput()
$bytes = $utf8.GetBytes($json)
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Flush()

# Delete only after the brief is out; a failed write must not lose it.
Remove-Item -LiteralPath $handoff -Force
