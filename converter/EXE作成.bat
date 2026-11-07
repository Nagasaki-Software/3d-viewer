@echo off
chcp 65001 >nul
cd /d %~dp0

if not exist .venv (
  echo エラー: .venv が見つかりません。先に開発環境をセットアップしてください。
  echo   uv venv --python 3.12 .venv
  echo   uv pip install --python .venv -r requirements.txt
  echo   uv pip install --python .venv pyinstaller
  pause
  exit /b 1
)

.venv\Scripts\pyinstaller.exe --clean --noconfirm Converter3DViewer.spec
if errorlevel 1 (
  echo.
  echo ビルドに失敗しました。
  pause
  exit /b 1
)

if not exist dist\Converter3DViewer\bin mkdir dist\Converter3DViewer\bin
copy /y bin\gltfpack.exe dist\Converter3DViewer\bin\ >nul

echo.
echo 完了しました。dist\Converter3DViewer フォルダを配布してください。
echo （dist\Converter3DViewer\bin\gltfpack.exe が同梱されていることを確認してください）
pause
