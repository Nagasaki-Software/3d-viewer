@echo off
rem 3D viewer launcher (double-click to start)
cd /d "%~dp0viewer"

if not exist node_modules (
  echo First-time setup: installing packages. This may take a few minutes...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed. Please check that Node.js is installed.
    echo   Download: https://nodejs.org/
    pause
    exit /b 1
  )
)

echo Starting 3D viewer... The browser will open automatically.
echo Keep this window open while using the viewer. Close it to stop.
call npm run dev -- --open
pause
