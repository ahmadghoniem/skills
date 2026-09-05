# Nudge after the second compaction of a session. PostCompact hook.
#
# PostCompact output is shown to the user and never reaches the model. That is the
# right audience anyway: /snapshot is user-invoked only, so nobody but you can act
# on this.

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
try { $in = ConvertFrom-Json $raw } catch { exit 0 }

$transcript = $in.transcript_path
if (-not $transcript) { exit 0 }

# Each compaction leaves exactly one boundary marker in the transcript, so the count
# is already on disk -- no counter file to write, go stale, or clean up. /clear starts
# a new transcript, which is also how the count resets.
#
# The marker for the compaction happening right now is written *after* this hook runs
# (PostCompact fires before the boundary is persisted), so what is on disk is the
# count of prior compactions. This one makes it one more.
#
# A hook that throws prints a red error over the user's terminal, so a bad or
# unreadable path just means no nudge.
try {
  if (-not (Test-Path -LiteralPath $transcript -ErrorAction Stop)) { exit 0 }
  $prior = @(Select-String -LiteralPath $transcript -Pattern '"subtype":"compact_boundary"' -SimpleMatch -ErrorAction Stop).Count
} catch { exit 0 }
$total = $prior + 1
if ($total -lt 2) { exit 0 }

Write-Output "Compacted $total times. The next one summarizes a summary. Consider /snapshot, then /clear, then /recall."
exit 0
