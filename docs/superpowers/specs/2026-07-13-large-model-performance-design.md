# 大規模モデル（部品数千・三角形数百万級）の表示性能改善 設計

日付: 2026-07-13
背景: 660MB STEP → GLB 42MB（部品 9,800・三角形 868万）で、LAN経由の読み込みが遅く、
タッチ操作がノートPC（内蔵GPU）で追いつかない。

## 原因

1. 操作の重さ: 部品ごとに1メッシュ＝1ドローコール。9,800回/フレームは内蔵GPUの限界
   （目安 ~1,000回）を大きく超える。三角形数は二次的要因。
2. 読み込みの遅さ: ファイル転送 + 開発サーバーの非バンドル配信 + クライアント側の展開処理。

## 対策1: 描画バッチ化（BatchedMesh）

- `buildPartRegistry` で部品ツリーを走査後、テクスチャなしマテリアルのメッシュを
  「色＋不透明度」でグループ化し、グループごとに THREE.BatchedMesh を1つ生成して
  モデルルート直下に追加する。ドローコールは 9,800 → 色数程度になる。
- 元の Mesh はツリーから除去し geometry を破棄。部品ノード（Group）と稜線
  LineSegments はツリーに残す（注釈のローカル座標変換・エッジ表示は従来どおり）。
- バッチのマテリアルは白にし、部品の色は per-instance color（setColorAt）で持つ。
  選択強調は setColorAt(ハイライト色)、解除で元の色に戻す（従来のemissive方式は
  マテリアル共有のため使えない。乗算でなく色置換なので暗色部品でも視認できる）。
- 部品の表示/非表示: node.visible（真実の源）+ setVisibleAt を同期。
- タップ選択: BatchedMesh の raycast が返す batchId → 部品名の対応表を registry が持つ。
  非表示インスタンスは three の BatchedMesh.raycast が自動でスキップする。
- テクスチャ付きマテリアルのメッシュはバッチ化せず従来どおり残す
  （変換ツール出力は常にテクスチャなしなので全部品がバッチ化される）。
- per-instance frustum culling（画面外の部品の自動間引き）は BatchedMesh の既定で有効。

## 対策2: LAN公開の本番配信化

- `/api/models`・`/models/*`（GET/PUT）のロジックを `viewer/models-api.js` に抽出し、
  vite.config.js（開発）と新規 `viewer/server.js`（本番）で共用する。
- `server.js` は依存ゼロの Node http サーバー。`vite build` の dist/ を配信し、
  ハッシュ付きアセットは immutable キャッシュ、index.html は no-cache、
  GLB は ETag/304 対応（2回目以降の再ダウンロード不要）。
- `LAN公開で起動.bat` を「npm run build → node server.js」に変更。
  開発時の `ビューア起動.bat`（vite dev）は従来どおり。

## 見送り（必要になったら）

- 操作中だけ小部品を間引くLOD（バッチ化で不要になる見込み）
- 変換ツールへの gltfpack -si（メッシュ簡略化）品質の追加
