@echo off
setlocal EnableDelayedExpansion

REM Starts Ollama and wordbridge together, then opens the page.
REM Double-click it, or run `start.bat` from a terminal.

REM Work from this script's own folder, so it doesn't matter where it's run from
REM or where the repo lives.
cd /d "%~dp0"

REM Keep model weights beside the project unless the machine already has
REM OLLAMA_MODELS configured — an existing setting always wins.
if "%OLLAMA_MODELS%"=="" set "OLLAMA_MODELS=%~dp0model-store"
echo Models:  %OLLAMA_MODELS%

REM Only launch Ollama if nothing is already listening on its port. Starting a
REM second one just fails with "address already in use".
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:":11434" >nul 2>&1
if errorlevel 1 (
  echo Starting Ollama...
  start "Ollama" cmd /k "set ""OLLAMA_MODELS=%OLLAMA_MODELS%"" && ollama serve"
) else (
  echo Ollama already running.
)

REM Wait for the service to actually answer before starting the app — a cold
REM start takes a few seconds, and the app is useless until it responds.
echo Waiting for Ollama to respond...
powershell -NoProfile -Command ^
  "$deadline = (Get-Date).AddSeconds(60);" ^
  "while ((Get-Date) -lt $deadline) {" ^
  "  try { Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -UseBasicParsing ^| Out-Null; exit 0 }" ^
  "  catch { Start-Sleep -Milliseconds 700 } };" ^
  "exit 1"

if errorlevel 1 (
  echo.
  echo Ollama did not respond within 60 seconds.
  echo Check the Ollama window for errors, then try again.
  pause
  exit /b 1
)

echo Ollama ready.
start "wordbridge" cmd /k "npm start"

REM Give the web server a moment to bind before the browser asks for the page.
timeout /t 3 /nobreak >nul
start "" http://localhost:3000

echo.
echo Running. Close the two terminal windows to stop.
