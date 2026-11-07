@echo off
cd /d "%~dp0viewer"
if "%~1"=="openbrowser" goto :openbrowser
title 3Dモデルビューア

if not exist "node_modules" (
    echo [エラー] まだ準備ができていません。
    echo 先に「初回セットアップ.bat」をダブルクリックしてください。
    pause
    exit /b 1
)

echo ============================================
echo  3Dモデルビューアを起動します
echo ============================================
echo 表示の準備をしています（10秒～1分ほど）...
call npm run build > "%TEMP%\3dviewer-build.log" 2>&1
if errorlevel 1 (
    echo.
    echo [エラー] 表示の準備に失敗しました。くわしくは次のファイルを見てください。
    echo %TEMP%\3dviewer-build.log
    pause
    exit /b 1
)
echo.
echo ・このあとブラウザが自動で開きます。
echo ・この黒い画面は閉じないでください。閉じるとビューアが止まります。
echo ・他のPCから見るときは、下に出る「Network: http://...」のアドレスを
echo   そのPCのブラウザで開きます（同じネットワークにつながっている場合）。
echo ・初めて起動したときに Windows ファイアウォールの確認が出たら、
echo  「アクセスを許可する」を押してください。
echo ・見せたいモデル（.glb）は viewer\models フォルダに置きます。
echo.
start /min "" "%~f0" openbrowser
node server.js 4000
echo.
echo ビューアが止まりました。
echo 「EADDRINUSE」と出ている場合は、すでに別の画面でビューアが動いています。
pause
exit /b 0

:openbrowser
rem サーバーが応答するまで最大30秒（1秒ごと）待つ。応答しなくてもブラウザは開く
set /a TRIES=0
:waitloop
curl.exe -s -o nul -w "%%{http_code}" --max-time 2 http://localhost:4000/api/models | findstr /c:"200" >nul
if not errorlevel 1 goto :ready
set /a TRIES+=1
if %TRIES% geq 30 goto :ready
timeout /t 1 /nobreak >nul
goto :waitloop

:ready
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" goto :fallback
start "" "%EDGE%" http://localhost:4000/
exit /b 0

:fallback
start "" http://localhost:4000/
exit /b 0
