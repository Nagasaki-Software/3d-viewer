# 3Dモデル変換ツール（STEP → GLB）

CADから出力したSTEPファイルを、3Dビューアで高速表示できる圧縮GLBに変換します。

## 準備（初回のみ）

1. [uv](https://docs.astral.sh/uv/) をインストール（このPCでは導入済み）
2. このフォルダ（`converter/`）で:
   ```
   uv venv --python 3.12 .venv
   uv pip install --python .venv -r requirements.txt
   ```
   ※ cadquery が Python 3.13 以降に未対応のため、3.12 を指定します
3. gltfpack を配置:
   https://github.com/zeux/meshoptimizer/releases から
   `gltfpack-windows.zip` をダウンロードし、中の `gltfpack.exe` を
   `bin/gltfpack.exe` に置く

## 使い方

```
.venv\Scripts\python main.py
```

1. 「ファイルを選ぶ」でSTEPファイルを選択
2. 品質を選ぶ（迷ったら「標準」）
3. 「変換する」を押す → 元ファイルと同じフォルダに `〜.glb` ができます

できた `.glb` を3Dビューアにドラッグ&ドロップしてください。

## 品質の目安

| 品質 | 用途 | ファイルサイズ |
|---|---|---|
| 粗い | 全体確認・軽さ優先 | 小 |
| 標準 | 通常利用 | 中 |
| 細かい | 拡大して細部を見る | 大 |

## テスト

```
.venv\Scripts\python -m pytest
```

## 既知の制限

- 部品名に日本語などの非ASCII文字が含まれるSTEPファイルでは、部品名が文字化けする場合があります（内部ライブラリの制限）。形状の変換自体には影響しません
- 巨大なファイル（数百MB級）の変換にはメモリを多く使用します。変換中は他の重いアプリを閉じることを推奨します
