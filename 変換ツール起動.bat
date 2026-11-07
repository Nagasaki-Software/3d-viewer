@echo off
rem STEP to GLB converter launcher (double-click to start)
cd /d "%~dp0converter"

if not exist .venv\Scripts\pythonw.exe (
  echo ERROR: Python environment not found.
  echo Please run the first-time setup described in converter\README.md:
  echo   uv venv --python 3.12 .venv
  echo   uv pip install --python .venv -r requirements.txt
  pause
  exit /b 1
)

start "" .venv\Scripts\pythonw.exe main.py
