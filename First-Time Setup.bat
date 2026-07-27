@echo off
cd /d "%~dp0"
echo ==================================================
echo   Naukri Automation - First-Time Setup
echo ==================================================
echo.
echo This installs dependencies. Only needs to run once per computer.
echo.
call npm install
echo.
if not exist ".env" (
  copy .env.example .env >nul
  echo Created .env from .env.example.
  echo.
  echo IMPORTANT: place the service-account JSON file in this same folder,
  echo named exactly "service_account.json" - the default GOOGLE_APPLICATION_CREDENTIALS
  echo setting already points to it, so you likely don't need to edit anything.
  echo If you'd rather keep it somewhere else, edit that line in the Notepad window now.
  notepad .env
) else (
  echo .env already exists - leaving it as-is.
)
echo.
echo Setup complete. Next steps:
echo   1. Make sure service_account.json is in this folder (or .env points to it).
echo   2. Load the browser extension - see README.md "Load the browser extension".
echo   3. Double-click "Start Naukri Worker.bat" whenever you want to run it.
echo.
pause
