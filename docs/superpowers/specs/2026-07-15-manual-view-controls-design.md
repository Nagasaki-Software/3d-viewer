# ボタンによる視点操作（ピンチ操作の代替）設計

## 背景・目的

タッチパネルでのピンチアウト等、複数指を使う操作が苦手なユーザー向けに、画面上のボタンだけで視点の回転・平行移動・拡大縮小ができる機能を追加する。既存のOrbitControls（ドラッグ・ピンチ操作）はそのまま残し、追加の代替手段として提供する。

## ゴール

- 回転（上下左右）・平行移動（上下左右）・拡大縮小（＋－）をボタンで操作できる
- タップ1回ごとに固定量動く（連続押下による継続移動ではない）
- 普段は画面に出さず、必要な人がボタンで表示/非表示を切り替えられる
- 既存の見た目・操作感（既存パネルのデザイン言語）と統一する

## スコープ外

- 連続押下（押しっぱなしで動き続ける）操作
- 新しいアイコン・グラフィックの導入（既存アプリが全てテキストボタンのため、矢印記号(↑↓←→)や＋－で表現し統一感を保つ）
- ラベル配置モード等、操作（OrbitControls）が無効化されている間のボタン操作（後述の通り無視する）

## UI設計

既存の右上フローティングパネルに、他のセクション（モデルの向き・表示設定等）と同じ`<details class="ui-group">`パターンで新セクション「ボタンで操作」を追加する。既定で閉じており、タップで開閉する（ブラウザ標準のdetails/summaryを使うため新しい開閉ロジックは不要）。

```
[ボタンで操作 ▼]
 ピンチ操作が難しいときに、ボタンで視点を操作できます

 回転
 [↑] [↓] [←] [→]

 平行移動
 [↑] [↓] [←] [→]

 ズーム
 [＋] [－]
```

- 各ボタンは`min-width/min-height: 44px`（既存の他ボタンと同じ最小サイズ）、ボタン間8px以上の間隔
- ボタンの文字は矢印記号(↑↓←→)・＋－を使用（新規アイコン画像は導入しない）
- 読み上げ用に`aria-label`を付与する（例:「上に回転」「上へ移動」「拡大」）。回転と平行移動のボタンは同じ矢印記号を使うため、グループの見出し（回転/平行移動）と`aria-label`の両方で区別する
- 操作（OrbitControls）が無効化されている間（ラベル配置モード等）は、ボタンを押しても何も起きない（後述）

## 技術設計

### 純粋関数（新規モジュール `viewer/src/manual-controls.js`）

OrbitControlsの内部（プライベートメソッド）には触れず、カメラ位置・注視点から新しい値を計算する独立した関数として実装する（`camera-range.js`や`views.js`と同じ設計方針。THREE.Vector3/Spherical等の値を渡すだけで完結し、単体テストしやすい）。

- `rotateAroundTarget(cameraPos, target, axis, angleRad, polarLimits)`
  - `axis`: `'horizontal'`(左右/theta) | `'vertical'`(上下/phi)
  - `THREE.Spherical`で注視点からのオフセットを極座標化し、指定軸に角度を加算して新しいカメラ位置を返す
  - 上下方向は`polarLimits`（`{min, max}`、既定は0〜π）でクランプし、真上/真下を超えて反転しないようにする（`Spherical.makeSafe()`相当の下限・上限も適用）
  - 固定値: 1回のタップで **15°(π/12 rad)** 動かす

- `panByScreenDirection(cameraMatrix, direction, distanceToTarget, panRatio)`
  - `direction`: `'up' | 'down' | 'left' | 'right'`
  - カメラのローカルXY軸（右方向・上方向）を`cameraMatrix`から取り出し、`distanceToTarget * panRatio`だけ移動したオフセットベクトルを返す（呼び出し側がカメラ位置と注視点の両方に同じオフセットを加算する）
  - 距離に比例させることで、ズーム状態によらず体感移動量が一定になる（OrbitControls自身のパン処理と同じ考え方）
  - 固定値: 1回のタップで距離の **10%** 移動する

- `zoomByFactor(cameraPos, target, direction, zoomStep, minDistance, maxDistance)`
  - `direction`: `'in' | 'out'`
  - 注視点からの距離を`zoomStep`（拡大: ×0.9 / 縮小: ×(1/0.9)）で変化させ、`minDistance`/`maxDistance`でクランプした新しいカメラ位置を返す

### viewer.js側の配線

- 上記3関数をラップした`export`関数（`rotateStep(axis, sign)`, `panStep(direction)`, `zoomStep(direction)`）を追加し、内部で`camera`/`controls`の現在値を渡して呼び出し、結果を`camera.position`・`controls.target`に反映して`controls.update()`を呼ぶ
- 各関数の先頭で`if (!controls.enabled) return;`とし、操作無効化中（ラベル配置モード等）は何もしない
- カメラ位置が瞬間的に変わるため、既存のLOD切替（`animate()`内の動き検知）が自動的に反応し、タップ直後だけ軽量表示・低解像度になり、静止後に精密表示へ戻る（追加の特別対応は不要。動き検知は「動いたかどうか」だけを見ているため）

### main.js側の配線

- 新しいDOM要素（`#manual-controls-group`内のボタン群）にクリックハンドラを登録し、`data-action`/`data-dir`属性から対応する`rotateStep`/`panStep`/`zoomStep`を呼び出す

## テスト

- `viewer/src/manual-controls.js`の3関数を`viewer/tests/manual-controls.test.js`でTDD検証する
  - 回転: 水平回転で位置が正しく変わること、垂直回転が上限/下限でクランプされること
  - 平行移動: 移動後もカメラ⇄注視点の相対関係（向き）が変わらないこと、距離に比例した移動量になること
  - ズーム: 拡大/縮小で距離が正しく変化すること、min/maxDistanceでクランプされること
- viewer.js/main.jsへの配線はブラウザでの動作確認とする（既存のviewer.js統合部分と同じ方針。単体テスト対象外）
