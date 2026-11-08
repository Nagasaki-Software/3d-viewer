# 3D モデルビューア

タッチパネルで3Dモデル（CAD由来）を自在に動かしながら詳細を確認できるアプリ。

## 免責事項

- このアプリは「現状有姿」で提供します。作者は、いかなる保証もしません。
- 使ったことで生じた損害について、作者は責任を負いません。
- 法令にもとづく記録や、安全にかかわる判断に、このアプリだけを用いないでください。表示やPDFは、確認のための補助です。
- テストや説明に出てくるモデル名・部品名は、すべて架空のものです。
- 不具合の報告や要望は、GitHub の Issues で受け付けますが、対応やその時期はお約束できません。

## 構成

| フォルダ | 役割 |
|---|---|
| `converter/` | STEP → 圧縮GLB 変換ツール（Python）。使い方は converter/README.md |
| `viewer/` | ブラウザで動く3Dビューア（Vite + Three.js） |
| `docs/manual/` | 取扱説明書（[PDF](docs/manual/取扱説明書.pdf)・[Markdown](docs/manual/取扱説明書.md)） |
| `samples/` | 試しに見られるサンプルモデル（[ブルドーザー](samples/bulldozer/README.md)） |

## 必要なもの

- Windows 10 / 11
- [Node.js](https://nodejs.org/)（LTS版）… ビューアに必要
- [Python 3.12](https://www.python.org/)（インストール時に「Add Python to PATH」にチェック）… 変換ツールを使う人だけ必要
- インターネット接続（初回セットアップのときだけ）

## はじめかた

1. **「初回セットアップ.bat」をダブルクリック**（最初の1回だけ。10～20分ほど）
   - ビューアの部品、変換ツールの部品、圧縮用の gltfpack（公式の配布元から取得）を入れます
   - Python 3.12 が無い場合は、変換ツールの準備だけ飛ばします（ビューアは使えます）
2. **「ビューア起動.bat」をダブルクリック** → ブラウザが自動で開きます
   - 黒い画面は閉じないでください（閉じるとビューアが止まります）
   - 見せたいモデル（`.glb`）は `viewer\models\` に置くと、最初の画面に一覧で出ます。`.glb` をブラウザにドラッグ&ドロップしても開けます
   - 試しに見るなら、`samples\bulldozer\` の3つの `.glb` を `viewer\models\` にコピーしてください
   - 同じネットワークの他のPCからは、黒い画面の「Network: http://…:4000/」のアドレスで見られます
3. **「変換ツール起動.bat」をダブルクリック** → STEPファイルを選んで `.glb` に変換します

## 機能

- **部品タップ**: 部品名表示・隠す・すべて再表示
- **編集モード**: ラベル（注釈）追加、JSON保存/読込
- **視点ブックマーク**: カメラ位置と表示状態を記録・再現
- **標準ビュー / エッジ表示 / ライトモード**切替
- **PDF保存**: 今の画面・注釈・メモをPDFにして、編集モードで設定したフォルダ（ネットワーク上も可）に保存

## 開発する人向け

- ビューアの開発サーバー: `cd viewer && npm run dev`（ポート4000）
- 本番と同じ配信: `cd viewer && npm run build && node server.js 4000`

## テスト

- ビューア: `cd viewer && npm test`
- 変換ツール: `cd converter && .venv\Scripts\python -m pytest`

## ライセンス

[Apache License 2.0](LICENSE)（Copyright 2026 Nagasaki-Software）

使っている部品（three.js、CadQuery、gltfpack など）は、それぞれのライセンスに従います。くわしくは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を見てください。
