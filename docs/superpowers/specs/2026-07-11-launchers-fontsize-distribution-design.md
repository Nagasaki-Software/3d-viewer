# 起動bat・フォントサイズ設定・配布手順 設計書

作成日: 2026-07-11
対象: `apps/3d-viewer`

## 1. 起動用batファイル（リポジトリ直下）

- `ビューア起動.bat`: `viewer/` で `npm run dev -- --open`（ブラウザ自動オープン）。`node_modules` が無ければ先に `npm install` を実行。npm失敗時はNode.js未導入の可能性を案内して pause
- `変換ツール起動.bat`: `converter/.venv\Scripts\pythonw.exe main.py` を `start` で起動（コンソール非表示）。`.venv` が無ければセットアップ案内を表示して pause
- 文字化け防止のため bat の中身はASCII（英語メッセージ）のみ。ファイル名は日本語

## 2. フォントサイズ設定（viewer）

- 「表示設定」グループにスライダー3本: 注釈 10〜32px（既定14）/ タイトル 12〜40px（既定18）/ スペック 8〜24px（既定12）。現在値をpx表示し、操作で即時反映
- 実装: CSS変数 `--font-annotation` `--font-title` `--font-specs` を `:root` にJSで設定し、`.annotation-label` `#model-title` `#model-specs` の font-size を変数参照に変更
- 永続化: localStorage キー `viewer-font-sizes`。新モジュール `fontsize.js`（FONT_LIMITS / normalizeFontSizes / load / save / apply）。normalize（範囲クランプ・不正値→既定）はvitestで自動テスト
- 保存JSONには含めない（端末ごとの表示設定のため）

## 3. README.txt（配布手順・リポジトリ直下・日本語・メモ帳で読める）

- 前提: 「見るだけの人」はビューア+GLBのみでよい。変換ツールは変換担当者のPCだけ
- パターンA（各PCに配布）: フォルダ一式コピー + Node.js（ビューア）/ Python 3.12+uv（変換ツール）導入 + batで起動。gltfpack.exe の手動配置も記載。「インストール不要のEXE版は今後対応可能」と明記
- パターンB（社内LAN共有）: 1台で `npm run dev -- --host` を起動し、他のPCから `http://<IP>:5173` を開く。Windowsファイアウォールの許可（初回ダイアログ）とIPアドレスの調べ方（ipconfig）を記載

## 4. テスト・検証

- fontsize.js の normalize/load をvitest（不正JSON・範囲外・欠損キー）
- スライダーの即時反映・再読込後の保持をブラウザで確認
- batは実行して起動することを確認（pythonwでのGUI起動はユーザー実機確認も依頼）

## 5. 対象外

- フォント種類の変更、行間設定
- EXE化（releaseスキルでの対応は別途）
- LAN公開の自動化（lan-webapp-serveスキルでの恒久設定は別途）
