@echo off
cd /d "%~dp0"
echo ==================================================
echo   Checking for updates...
echo ==================================================
echo.
git pull origin master
echo.
echo If package.json changed, refreshing dependencies...
call npm install
echo.
echo Done. You can close this window.
echo.
pause
