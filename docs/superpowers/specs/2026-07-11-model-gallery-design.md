# URLで開くモデル共有（モデル一覧+自動読み込み） 設計書

作成日: 2026-07-11
対象: `apps/3d-viewer/viewer`

## 1. 目的

LAN共有時に、閲覧者がドラッグ&ドロップなしで「URLを開くだけ」「一覧から選ぶだけ」でモデル+注釈を見られるようにする。

## 2. 仕組み

- **置き場**: `viewer/models/`（新設・Git管理外）。担当者はGLBを置く。注釈は同名の `<名前>_annotations.json` を隣に置く
- **URL直指定**: `?model=<名前>`（拡張子なし）で自動読み込み。注釈JSONは存在すれば自動で重ねて読む（404なら注釈なし表示）
- **一覧**: URLパラメータなしで開くと、ドロップゾーン内にサーバー上のモデル一覧（名前・サイズ・注釈ありバッジ）を表示。タップで読み込み、URLを `?model=<名前>` に書き換え（コピーして共有可能）
- 既存のドラッグ&ドロップは維持

## 3. 実装

- **サーバー側**（vite.config.js のプラグイン、開発サーバー専用）:
  - `GET /api/models` → models/ 内の *.glb 一覧（name/size/hasAnnotations）をJSONで返す。フォルダ未作成なら空配列
  - `GET /models/<ファイル名>` → ファイル配信。ファイル名は `.glb`/`.json` のみ許可し、パス区切り文字・`..` を拒否（パストラバーサル対策）
- **クライアント側**:
  - 新モジュール `modelsource.js`: `sanitizeModelName`（不正名→null、`.glb` 拡張子は除去、日本語名は許可）と `modelPaths`（URLエンコード済みのglb/jsonパスを返す）— vitestで自動テスト
  - main.js: 起動時に `?model` を検証して `loadFromServer(name)`。fetch→File化→既存の handleGLBDrop / handleJSONDrop を再利用。モデル404は日本語メッセージ
  - 一覧は起動時に `/api/models` を取得して描画（取得失敗は静かにスキップ=従来のドロップ案内のみ）
- **その他**: `.gitignore` に `viewer/models/`、README.txt のパターンBを新手順に更新

## 4. テスト

- modelsource.js（sanitize/paths）を vitest
- 一覧表示・タップ読み込み・?model 直指定・注釈自動ペア・404時メッセージをブラウザで検証

## 5. 対象外

- ブラウザからのモデルアップロード、削除などの管理機能
- 閲覧権限・認証
- 本番ビルド（vite preview / 静的ホスティング）での一覧機能（LAN共有は開発サーバー運用のため）
