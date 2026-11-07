# 使っているソフトウェアのライセンス

このリポジトリには、他の人が作ったプログラムのファイルを同梱していません。下の部品は、セットアップのときにインターネットから入るか、利用者が自分で入手して置くものです。ライセンスの全文は、各部品に同梱されています。

## ビューア（`viewer/`）

`npm install` で npm から入ります。表は、開発に使った環境の `viewer/node_modules/<部品>/package.json` の表示を写したものです。

| 部品 | 確認したバージョン | ライセンス | 用途 |
|---|---|---|---|
| three.js（three） | 0.184.0 | MIT | 3D表示。`npm run build` の成果物（`viewer/dist/`）に組み込まれます |
| Vite（vite） | 8.1.4 | MIT | 開発サーバー・ビルド（開発用） |
| Vitest（vitest） | 4.1.10 | MIT | テスト（開発用） |

## 変換ツール（`converter/`）

`requirements.txt` から PyPI 経由で入ります。表は、開発に使った環境の `converter/.venv/Lib/site-packages/*.dist-info` の表示を写したものです。

| 部品 | 確認したバージョン | ライセンス |
|---|---|---|
| CadQuery（cadquery） | 2.5.2 | Apache License 2.0 |
| OCP（cadquery-ocp） | 7.7.2 | Apache License 2.0（中に含まれる部品の一覧と各ライセンスは `cadquery_ocp-7.7.2.dist-info/LICENSES_bundled`） |
| NumPy（numpy） | 2.5.1 | BSD-3-Clause ほか（`BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`） |
| pytest（テスト用） | 9.1.1 | MIT |

CadQuery と一緒に自動で入る部品の例：casadi（LGPL-3.0 以降）、ezdxf（MIT）、nlopt（MIT）、multimethod（Apache License 2.0）、typish（MIT）、path（MIT）。

## gltfpack（`converter/bin/gltfpack.exe`）

meshoptimizer プロジェクトの gltfpack（作者 Arseny Kapoulkine、MIT License）です。リポジトリには含みません。利用者が GitHub の [zeux/meshoptimizer の Releases](https://github.com/zeux/meshoptimizer/releases) から入手して、`converter/bin/` に置きます。

## 確認していないこと（未確認）

- 各部品の最新版のライセンス表示。部品はインストールの時点の版が入るため、上の表と変わる可能性があります。ライセンスは、配布元の表示が正です
- 変換ツールを EXE にまとめて配る場合の条件。EXE には OCP の中身（OpenCASCADE などの部品。`LICENSES_bundled` には LGPL や GPL を含む複数のライセンスが並んでいます）、casadi（LGPL）、gltfpack（MIT）が入ります。EXE を配るときは、それぞれの条件（ライセンス文の同梱、LGPL 部品の差し替えを可能にすることなど）を、配る前に確かめてください
