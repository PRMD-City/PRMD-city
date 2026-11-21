@echo off
cd /d "%~dp0"
set "PORT=3002"
rem Reuse the React site if Codex or another terminal already started it.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:3002/api/site'; if ($r.StatusCode -eq 200 -and $r.Content.Contains('discordUrl')) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo PRMD City is already running at http://127.0.0.1:%PORT%/
  start "" "http://127.0.0.1:%PORT%/"
  exit /b 0
)
echo Starting PRMD City at http://127.0.0.1:%PORT%/
call npm run build
if errorlevel 1 (
  echo.
  echo React build failed. Check the message above.
  pause
  exit /b 1
)
node server.mjs
if errorlevel 1 (
  echo.
  echo PRMD City stopped or could not start. Check the message above.
  pause
)
