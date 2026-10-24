# STT server

Parakeet TDT 0.6B v3 in Moondream Photon, bf16 weights, on the GPU, behind an
OpenAI-compatible endpoint at `http://127.0.0.1:52625`. It applies the rules
/refine-dictation saves, logs every dictation, and serves the report page.

## Running it

Run `start.cmd`. A console window opens and the model loads onto the GPU. Close the
window to stop the server and free its GPU memory. Keep Windows in Performance power
mode: Turbo mode was about 45% slower in testing.

The Python environment is `C:\stt-bench\.venv` (moondream 2.6.1, torch 2.14 cu130,
fastapi, uvicorn).

Vowen: Speech models → Local / Self-hosted → Custom Server, URL
`http://127.0.0.1:52625`, model name and API key blank.

## Your data

Everything that is yours is in `~/.stt`, outside the repo. The kit plugin installs a
copy of this folder into Claude Code's plugin cache, and /refine-dictation runs from
that copy while the server runs from the repo; keeping the data in one place outside
both is what lets them share it.

    corrections.json     the rules, one per line
    dictations.jsonl     every dictation for 90 days, before and after the rules
    removed.jsonl        rules removed after 60 days without a fix
    models/              Parakeet v3 bf16 weights (1.2 GB)

`test_report.py` sets the `STT_HOME` environment variable to a temporary folder, so
the tests never read or change these files. Leave it unset in normal use.

## Pages and endpoints

    /report                     the report page (/review-dictation opens it)
    /log?last=5                 the newest dictations, for /refine-dictation
    /log/<id>/reply             fixes /refine-dictation made in a reply
    /v1/audio/transcriptions    transcription, as OpenAI's API; ?debug=1 adds the raw text

## Files

    server.py            Photon load, warm-up, the transcription endpoint
    corrections.py       applies the rules; reloads them when the file changes
    dictlog.py           the dictation log
    report.py            the report data and the endpoints its buttons call
    report.html          the report page
    rules.py             try, add, narrow or turn off a rule from the command line
    test_corrections.py  runs each rule's own test against ~/.stt/corrections.json
    test_report.py       tests the log, report and endpoints in a temporary folder
