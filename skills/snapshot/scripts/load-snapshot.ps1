# One-shot mailbox for /snapshot. Path: %TEMP%\claude-snapshot-<project-folder>.md
# SessionStart (matcher: clear): inject contents, then delete the file.

$utf8 = New-Object System.Text.UTF8Encoding $false

$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir) { $projectDir = (Get-Location).Path }

$mailbox = Join-Path $env:TEMP ("claude-snapshot-" + [IO.Path]::GetFileName($projectDir.TrimEnd('\', '/')) + ".md")
if (-not (Test-Path -LiteralPath $mailbox)) { exit 0 }

$body = [System.IO.File]::ReadAllText($mailbox, $utf8)
if ([string]::IsNullOrWhiteSpace($body)) { Remove-Item -LiteralPath $mailbox -Force; exit 0 }

$context = @"
CONVERSATION SNAPSHOT from the prior session. This is the brief for this session.
The user will invoke /recall next - that means "start on Next action below", not "summarise this".
Completed work and any skill invocations recorded below are already done; do not re-run them.

---
$body
"@

$json = @{
  hookSpecificOutput = @{
    hookEventName     = 'SessionStart'
    additionalContext = $context
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
Remove-Item -LiteralPath $mailbox -Force
