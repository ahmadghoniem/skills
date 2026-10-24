@echo off
title Blazing Fast STT - close this window to stop the server
setlocal

set HERE=%~dp0
set URL=http://127.0.0.1:52625
set PY=C:\stt-bench\.venv\Scripts\python.exe

REM Parakeet v3 in Moondream Photon, loading the bf16 weights in
REM %USERPROFILE%\.stt\models\parakeet-tdt-0.6b-v3-bf16. Expandable segments let PyTorch hand back
REM GPU memory it no longer needs.
set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

REM If a server is already up, say so rather than failing on a port clash and
REM leaving a confusing error in the window.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Invoke-RestMethod '%URL%/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo   A server is already running.
  timeout /t 2 >nul
  exit /b 0
)

echo.
echo   Blazing Fast STT (Photon)
echo   ----------------------
echo   Loading the model onto the GPU.
echo   Close this window to stop the server and free its VRAM.
echo   Report: %URL%/report
echo.

"%PY%" "%HERE%server.py" %*

echo.
echo   Server stopped.
timeout /t 3 >nul
