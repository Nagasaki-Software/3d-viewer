@echo off
cd /d "%~dp0"
title 3Dモデルビューア 初回セットアップ
echo ============================================
echo  3Dモデルビューア 初回セットアップ
echo ============================================
echo.
echo 必要な部品をインターネットから入れます。
echo 10～20分ほどかかることがあります。途中でこの画面を閉じないでください。
echo.

rem ---------- 1. ビューア ----------
echo [1/3] ビューア（3Dモデルを見るアプリ）の準備
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [エラー] Node.js が見つかりません。
    echo https://nodejs.org/ から「LTS」と書かれた版をインストールしてから、
    echo もう一度この「初回セットアップ.bat」をダブルクリックしてください。
    pause
    exit /b 1
)
pushd viewer
call npm ci
if errorlevel 1 (
    popd
    echo.
    echo [エラー] ビューアの部品を入れられませんでした。
    echo インターネットにつながっているか確かめて、もう一度実行してください。
    echo Node.js が古い場合も失敗します（LTS版を入れ直してください）。
    pause
    exit /b 1
)
popd
if not exist "viewer\models" mkdir "viewer\models"
echo ビューアの準備ができました。
echo 見せたいモデル（.glb）は viewer\models フォルダに置きます。
echo.

rem ---------- 2. 変換ツール ----------
echo [2/3] 変換ツール（STEPファイルを変換するアプリ）の準備
echo       ※ STEPファイルを変換しない人は、この準備ができなくても問題ありません。
set "PYCMD="
py -3.12 -c "import sys" >nul 2>nul && set "PYCMD=py -3.12"
if not defined PYCMD (
    python -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)" >nul 2>nul && set "PYCMD=python"
)
if not defined PYCMD (
    echo.
    echo [お知らせ] Python 3.12 が見つからないため、変換ツールの準備を飛ばしました。
    echo ビューアはこのまま使えます。
    echo 変換ツールも使うときは、https://www.python.org/ から Python 3.12 を
    echo インストールし（「Add Python to PATH」にチェック）、もう一度実行してください。
    goto :finish
)
if not exist "converter\.venv\Scripts\python.exe" (
    %PYCMD% -m venv converter\.venv
    if errorlevel 1 (
        echo [エラー] 変換ツール用の環境を作れませんでした。
        pause
        exit /b 1
    )
)
"converter\.venv\Scripts\python.exe" -m pip install -r converter\requirements.txt
if errorlevel 1 (
    echo.
    echo [エラー] 変換ツールの部品を入れられませんでした。
    echo インターネットにつながっているか確かめて、もう一度実行してください。
    pause
    exit /b 1
)
echo 変換ツールの部品を入れました。
echo.

rem ---------- 3. gltfpack ----------
echo [3/3] 圧縮用の部品（gltfpack）の準備
set "GLTFPACK=converter\bin\gltfpack.exe"
set "GLTFPACK_SHA256=a082a0db2332908133100332caeeddaa304afcf5e8094adc755ebdea8c720984"
if exist "%GLTFPACK%" (
    certutil -hashfile "%GLTFPACK%" SHA256 | findstr /i /c:"%GLTFPACK_SHA256%" >nul
    if not errorlevel 1 (
        echo すでに入っています。
        goto :finish
    )
)
if not exist "converter\bin" mkdir "converter\bin"
set "DLDIR=%TEMP%\3dviewer-gltfpack"
if not exist "%DLDIR%" mkdir "%DLDIR%"
echo 公式の配布元（GitHub: zeux/meshoptimizer v1.3）から取得しています...
"%SystemRoot%\System32\curl.exe" -L --fail -s -o "%DLDIR%\gltfpack-windows.zip" https://github.com/zeux/meshoptimizer/releases/download/v1.3/gltfpack-windows.zip
if errorlevel 1 goto :gltfpack_error
"%SystemRoot%\System32\tar.exe" -xf "%DLDIR%\gltfpack-windows.zip" -C "%DLDIR%" gltfpack.exe
if errorlevel 1 goto :gltfpack_error
certutil -hashfile "%DLDIR%\gltfpack.exe" SHA256 | findstr /i /c:"%GLTFPACK_SHA256%" >nul
if errorlevel 1 (
    echo [エラー] 取得したファイルが想定と違うため、使いません。
    goto :gltfpack_error
)
copy /y "%DLDIR%\gltfpack.exe" "%GLTFPACK%" >nul
echo gltfpack を入れました。
goto :finish

:gltfpack_error
echo.
echo [エラー] gltfpack を取得できませんでした。
echo 手で入れる場合は、https://github.com/zeux/meshoptimizer/releases の v1.3 から
echo gltfpack-windows.zip をダウンロードし、中の gltfpack.exe を
echo converter\bin\gltfpack.exe に置いてください。
pause
exit /b 1

:finish
echo.
echo ============================================
echo  セットアップが終わりました。
echo  ・3Dモデルを見る      →「ビューア起動.bat」
echo  ・STEPファイルを変換 →「変換ツール起動.bat」
echo ============================================
pause
