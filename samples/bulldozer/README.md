# サンプル：ブルドーザー

取扱説明書の画面写真に使った、デモ用の 3D モデルです。特定の製品をまねたものではない、架空の機械です（部品数 2,648）。

## 見るには

次の3つのファイルを `viewer\models\` にコピーすると、ビューアの最初の画面に「SampleBulldozerFull」が出ます。

| ファイル | 内容 |
|---|---|
| SampleBulldozerFull.glb | 本体 |
| SampleBulldozerFull_mid.glb | 操作中に使う中くらいの軽さの版 |
| SampleBulldozerFull_lod.glb | 操作中に使ういちばん軽い版 |

## 作り直すには

`make_bulldozer.py` は、このモデルを CadQuery で組み立てて STEP ファイルに書き出すプログラムです。初回セットアップで変換ツールを準備したあと、アプリのフォルダで次を実行し、できた STEP を変換ツールで `.glb` にします。

```
converter\.venv\Scripts\python samples\bulldozer\make_bulldozer.py SampleBulldozerFull.step
```
