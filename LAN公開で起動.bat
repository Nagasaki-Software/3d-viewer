@echo off
rem 3D viewer launcher for LAN sharing (double-click to start)
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

echo Building the viewer for fast delivery... (about 10-60 seconds)
call npm run build
if errorlevel 1 (
  echo.
  echo ERROR: build failed.
  pause
  exit /b 1
)

echo Starting 3D viewer in LAN sharing mode...
echo Other PCs on the same network will be able to access this viewer.
echo Look for the "Network:" address below and share it with others.
echo Keep this window open while sharing. Close it to stop.
start http://localhost:4000/
node server.js 4000
pause
