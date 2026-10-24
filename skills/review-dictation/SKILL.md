---
name: review-dictation
description: Open the dictation report, where the STT rules can be turned off, narrowed or deleted. Invoke with /review-dictation.
disable-model-invocation: true
---

1. Check the STT server is up:

       curl -s -m 2 http://127.0.0.1:52625/health

   If it does not answer, reply with exactly this and stop:

       The STT server isn't running. Start it with start.cmd in the refine-dictation skill's server folder, then run /review-dictation again.

2. Open the report in the browser:

       powershell -NoProfile -Command "Start-Process 'http://127.0.0.1:52625/report'"

3. Reply with one line: `Opened the report at http://127.0.0.1:52625/report.` Do not
   read or summarize the report; the page shows it.
