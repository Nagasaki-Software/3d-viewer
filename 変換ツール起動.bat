@echo off
cd /d "%~dp0converter"

if not exist ".venv\Scripts\pythonw.exe" (
    echo [エラー] 変換ツールの準備ができていません。
    echo 先に「初回セットアップ.bat」をダブルクリックしてください。
    echo （変換ツールには Python 3.12 が必要です）
    pause
    exit /b 1
)
if not exist "bin\gltfpack.exe" (
    echo [エラー] 圧縮用の部品（gltfpack）がありません。
    echo もう一度「初回セットアップ.bat」をダブルクリックしてください。
    pause
    exit /b 1
)

start "" ".venv\Scripts\pythonw.exe" main.py
