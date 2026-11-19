@echo off
cd /d "%~dp0"
title 3Dモデルビューア データ引き継ぎ
rem 古い版のフォルダから、モデル・ラベル・設定を、このフォルダへ写す。古いフォルダは変えない
rem 古いフォルダをこの bat へドラッグしても、実行してから場所を入れてもよい

where node >nul 2>nul
if errorlevel 1 (
    echo [エラー] Node.js が見つかりません。
    echo https://nodejs.org/ から Node.js（LTS版）をインストールしてください。
    pause
    exit /b 1
)

rem 日本語を正しく表示・入力するため、窓の文字コードを UTF-8 にする
chcp 65001 >nul
if "%~1"=="" (
    node migrate.mjs
) else (
    node migrate.mjs "%~1"
)
pause
