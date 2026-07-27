@echo off
cd /d "%~dp0"
echo ==================================================
echo   Naukri Automation Worker
echo ==================================================
echo.
echo Keep this window open while you use the automation.
echo Close it (or press Ctrl+C) when you're done for the day.
echo.
call npm run agent:web
pause
