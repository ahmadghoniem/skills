"""Where the server keeps your data: the rules, the dictation log and the model weights.

`~/.stt` unless STT_HOME says otherwise. It lives outside the repo so the code can
be updated, or installed as a copy, without touching any of it.
"""

import os
from pathlib import Path

HOME = Path(os.environ.get("STT_HOME") or Path.home() / ".stt")
