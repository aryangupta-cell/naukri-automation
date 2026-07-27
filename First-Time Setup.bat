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
  echo Created .env from .env.example - now edit it and fill in:
  echo   - GOOGLE_APPLICATION_CREDENTIALS  (path to the service-account JSON file)
  echo A blank .env has been opened for you.
  notepad .env
) else (
  echo .env already exists - leaving it as-is.
)
echo.
echo Setup complete. Next steps:
echo   1. Make sure the service-account JSON file is on this computer.
echo   2. Load the browser extension - see README.md "Load the browser extension".
echo   3. Double-click "Start Naukri Worker.bat" whenever you want to run it.
echo.
pause
