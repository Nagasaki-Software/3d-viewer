# ビューのPDF保存 設計

## 背景・目的

点検や打合せの記録として、いま表示している3Dビューの状態を、PDFで決まったフォルダに残したい。保存先はネットワーク上の共有フォルダでもよい。タッチパネルPC（LAN経由・Chromeのキオスク表示）からも保存できるようにする。

## ゴール

- 「PDF保存」ボタンで、今の画面・モデル名・日時・注釈ラベルの一覧・任意のメモを、A4横1ページのPDFにして保存先フォルダに保存する
- 保存先フォルダは画面から設定できる（編集モードのみ）。UNCパス（`\\server\share\...`）も使える
- 追加するライブラリは無し

## スコープ外

- 複数ページのPDFや、視点ブックマークをまとめて出力する機能
- PDFの中の文字を検索・コピーできるようにすること（画像1枚のPDFにする）
- 保存したPDFの一覧表示・削除・上書き
- 保存先を変更できる人を制限すること（社内LANの1台構成なので、認証は付けない）

## 画面（viewer/index.html, src/main.js）

- 「ビュー保存」「ビュー一覧」の並びに `#pdf-btn`「PDF保存」を置く。閲覧モードと編集モードの両方で使える
- 押すと、メモ入力の小窓 `#pdf-dialog` を開く。中身は `textarea#pdf-memo`（任意・最大500文字）と「保存」「キャンセル」。既存のラベル追加窓（`#label-confirm` 周辺）と同じ見た目にする
- 「表示設定」の中に、編集モードのときだけ表示する「PDF保存先」行を置く（`input#pdf-folder` と「設定」ボタン）。開いたときに、現在の設定を `GET /api/pdf-settings` から読んで表示する
- 結果は既存の `showMessage` で知らせる（「PDFを保存しました：<ファイル名>」、または失敗の理由）

## PDFの中身（viewer/src/pdf-report.js：新規）

A4横（297×210mm）のページを、150dpi相当の canvas（1754×1240px）に描き、JPEG（品質0.85）にする。

- 上部：モデル名（太字）と日時 `YYYY/MM/DD HH:mm`
- 中央：3D画面。`renderer.render()` の直後に `renderer.domElement` を `drawImage` し、縦横比を保って枠に収める。精密版を表示している状態で撮る（操作中の軽量版では撮らない）。ラベル表示がONなら、各注釈の画面上の位置（`toScreenPosition`。カメラの後ろにあるものは描かない）に、番号付きの丸印と文字を描き込む
- 下部：注釈の一覧（`番号. 文字`、入りきらない分は「ほか N 件」）と、メモ（折り返し、最大6行）
- フォントは `'Meiryo', 'メイリオ', sans-serif`

純粋関数：
- `buildImagePdf(jpegBytes: Uint8Array, imgW: number, imgH: number): Uint8Array`：JPEG1枚をA4横のページ全面に貼ったPDFを作る（DCTDecode。手書きの最小構成PDF：Catalog・Pages・Page・Image XObject・Content stream・xref・trailer）
- `pdfFileName(modelName: string, date: Date): string`：`<モデル名>_YYYYMMDD-HHmmss.pdf`。ファイル名に使えない文字（`\ / : * ? " < > |` と制御文字）は `_` に置き換える。モデル名が空なら `view`
- `wrapText(ctx, text, maxWidth, maxLines)`：canvas の文字幅で折り返し、超えた分は「…」で切る

## サーバー（viewer/pdf-api.js：新規。server.js と vite.config.js の両方から使う）

設定は `viewer/pdf-settings.json`（`{ "folder": "..." }`、UTF-8）に1つだけ持つ。環境ごとの値なので `.gitignore` に入れる。

- `GET /api/pdf-settings` → `{ folder: string }`（未設定なら空文字）
- `PUT /api/pdf-settings`（JSON `{ folder }`）→ 次を順に確かめてから保存する
  1. 空でない、かつ絶対パスである（`C:\...` または `\\server\share\...`）
  2. フォルダが存在する
  3. 書き込めるか、一時ファイル（`.3dviewer-write-test-<乱数>`）を書いて消すことで確かめる
  - 失敗したら 400 と、理由の日本語メッセージ（`{ error }`）を返す。設定は変えない
- `POST /api/pdf?model=<モデル名>`（本文はPDFのバイト列、`Content-Type: application/pdf`）
  - 保存先が未設定なら 409 `{ error: '保存先フォルダが設定されていません（編集モードの表示設定で設定してください）' }`
  - 本文が `%PDF-` で始まらない、または 30MB を超える場合は 400
  - ファイル名はサーバー側で `pdfFileName(model, 今の日時)` を使って作る（クライアントからパスは受け取らない）。同名があれば `_2`、`_3` … を付ける（`fs.openSync(path, 'wx')` で、既存ファイルを上書きしない）
  - 成功したら 200 `{ fileName }`。書き込みに失敗したら 500 `{ error: '保存できませんでした: <理由>' }`
- `pdfFileName` はビューアと同じものを使う（`pdf-report.js` から import する。pdf-report.js の DOM に依存する部分は関数の中だけにして、Node から import できるようにする）

書き込みは、サーバーを起動したWindowsユーザーの権限で行う。ネットワークフォルダの場合は、そのユーザーに書き込み権限が必要。

## エラー処理

- 保存中は「PDF保存」ボタンを押せなくし、二重保存を防ぐ
- 通信エラー・サーバーのエラーは、`error` の文言をそのまま `showMessage` で表示する
- ドラッグ&ドロップで開いたモデル（サーバー由来でない）でも保存できる。モデル名はファイル名から拡張子を除いたもの

## テスト

- vitest：`buildImagePdf`（`%PDF-` で始まり `%%EOF` で終わる、xref のオフセットが各 `obj` の位置と一致する、MediaBox が A4横（842×595pt））、`pdfFileName`（日時の書式、禁止文字の置換、空の名前）
- vitest（pdf-api）：一時フォルダを使って、設定の検証（相対パス・存在しない・正常）、未設定時の 409、`%PDF-` でない本文の 400、同名がある場合の `_2` の付与、既存ファイルを上書きしないこと
- 実機確認：確認用サーバー（ポート4001、確認用の models と設定ファイルは scratchpad）で保存し、生成したPDFを開いて中身を目で確かめる。ネットワークフォルダは、ユーザー環境の共有フォルダで、ユーザーに確かめてもらう
