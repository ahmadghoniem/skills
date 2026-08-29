# One-shot mailbox for /snapshot. Path: %TEMP%\claude-snapshot-<project-folder>.md
# SessionStart (matcher: clear): inject contents, then delete the file.

$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir) { $projectDir = (Get-Location).Path }

$mailbox = Join-Path $env:TEMP ("claude-snapshot-" + [IO.Path]::GetFileName($projectDir.TrimEnd('\', '/')) + ".md")
if (-not (Test-Path -LiteralPath $mailbox)) { exit 0 }

$body = [System.IO.File]::ReadAllText($mailbox)
Remove-Item -LiteralPath $mailbox -Force
if ([string]::IsNullOrWhiteSpace($body)) { exit 0 }

$context = @"
CONVERSATION SNAPSHOT from the prior session. This is the brief for this session.
The user will invoke /recall next — that means "start on Next action below", not "summarise this".
Completed work and any skill invocations recorded below are already done; do not re-run them.

---
$body
"@

@{
  hookSpecificOutput = @{
    hookEventName = 'SessionStart'
    additionalContext = $context
  }
} | ConvertTo-Json -Depth 5 -Compress
