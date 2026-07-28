@echo off
cd /d "%~dp0"
echo ==================================================
echo   Link this folder to the GitHub repo (one-time)
echo ==================================================
echo.
echo This connects your existing copy of the project to the shared
echo GitHub repo, so "Check for Updates.bat" can pull future changes.
echo.
git remote remove origin >nul 2>&1
git remote add origin https://github.com/aryangupta-cell/naukri-automation.git
echo Linked. Pulling the latest code now...
echo.
git pull origin master
echo.
echo Done. If it asked you to log into GitHub in a browser window, that's
echo normal the first time - just follow the prompts.
echo.
pause
