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

## 使い方（ビューア）

```
cd viewer
npm install   # 初回のみ
npm run dev
```

ブラウザで http://localhost:5173 を開き、変換済みの `.glb` をドラッグ&ドロップ。

- **部品タップ**: 部品名表示・隠す・すべて再表示
- **編集モード**: ラベル（注釈）追加、JSON保存/読込
- **視点ブックマーク**: カメラ位置と表示状態を記録・再現
- **標準ビュー / エッジ表示 / ライトモード**切替

## テスト

- ビューア: `cd viewer && npm test`
- 変換ツール: `cd converter && .venv\Scripts\python -m pytest`

## ライセンス

[Apache License 2.0](LICENSE)（Copyright 2026 Nagasaki-Software）

使っている部品（three.js、CadQuery、gltfpack など）は、それぞれのライセンスに従います。くわしくは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を見てください。
