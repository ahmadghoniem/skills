"""Where the server keeps your data: the rules, the dictation log and the model weights.

It is `~/.stt`, outside the repo. The kit plugin installs a copy of this folder into
Claude Code's plugin cache, and /refine-dictation runs rules.py from that copy while
the server runs from the repo. Both copies read and write `~/.stt`, so a rule the
skill saves is the rule the server applies, and a plugin update deletes nothing.

STT_HOME exists for the tests. test_report.py sets it to a temporary folder before
importing anything, so it can add, delete and expire rules and write log entries
without touching your real ones. Leave it unset in normal use.
"""

import os
from pathlib import Path

HOME = Path(os.environ.get("STT_HOME") or Path.home() / ".stt")
