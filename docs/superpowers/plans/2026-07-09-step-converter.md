# STEP変換ツール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** STEPファイル（最大500MB級）を、部品名・色を保持したままmeshopt圧縮GLBに変換するWindows用GUIツールを作る。

**Architecture:** Python製。OCP（OpenCascadeバインディング、cadquery同梱）のXDE機能でSTEPの部品構造・名前・色を読み、品質設定に応じてメッシュ化し、自前のGLBビルダーでglTFバイナリを組み立て、gltfpack（meshoptimizer）でmeshopt圧縮する。GUIはtkinter（標準ライブラリ）。

**Tech Stack:** Python 3.11+, cadquery/OCP, numpy, pytest, gltfpack (meshoptimizer), tkinter

**設計書からの変更点（意図的な単純化）:** glTF内の部品はネスト構造ではなく「フラットなノード一覧 + パス形式の名前（例 `"アセンブリ/サブ組立/部品A"`）」で持つ。選択済み機能（タップで部品名・非表示・強調）にはこれで十分であり、階層情報は名前のパスから復元できるため将来の部品ツリー機能も妨げない。GLB構築が大幅に単純になる。

**作業ディレクトリ:** `apps/3d-viewer/converter/`（新規）。以下、パスはすべて `apps/3d-viewer/` からの相対パス。

**実行前の注意（ユーザールール）:**
- パッケージインストール前に package-security-scan スキルでスキャンし、ユーザーの承認を得ること
- 削除系コマンドは使わない

---

## ファイル構成（完成形）

```
converter/
├── requirements.txt        # cadquery, numpy, pytest
├── pytest.ini
├── README.md               # 使い方（日本語）
├── main.py                 # GUIエントリポイント
├── bin/                    # gltfpack.exe を配置（git管理外）
├── src/
│   ├── __init__.py
│   ├── models.py           # Part / PartMesh データクラス
│   ├── step_loader.py      # STEP読み込み（XDE）→ Part一覧
│   ├── tessellate.py       # メッシュ化 + エッジ折れ線抽出
│   ├── glb_builder.py      # Part一覧 → GLBバイナリ
│   ├── compress.py         # gltfpack呼び出し
│   ├── pipeline.py         # convert() 全体パイプライン
│   └── gui.py              # tkinter GUI
└── tests/
    ├── conftest.py         # テスト用STEPフィクスチャ生成
    ├── test_step_loader.py
    ├── test_tessellate.py
    ├── test_glb_builder.py
    ├── test_compress.py
    └── test_pipeline.py
```

---

### Task 1: プロジェクト雛形とPython環境

**Files:**
- Create: `converter/requirements.txt`
- Create: `converter/pytest.ini`
- Create: `converter/src/__init__.py`（空ファイル）
- Modify: `.gitignore`

- [ ] **Step 1: ディレクトリとファイルを作成**

`converter/requirements.txt`:

```
cadquery==2.5.2
numpy>=1.26
pytest>=8.0
```

`converter/pytest.ini`:

```ini
[pytest]
testpaths = tests
```

`converter/src/__init__.py` は空で作成。

- [ ] **Step 2: .gitignore に追記**

リポジトリ直下の `.gitignore` に以下を追記:

```
converter/.venv/
converter/bin/
```

- [ ] **Step 3: パッケージのセキュリティスキャンとユーザー承認**

package-security-scan スキルで `cadquery` `numpy` `pytest` をスキャンする。
その後、以下をユーザーに説明して承認を得る:
- 何を入れるか: cadquery（CADエンジンOpenCascade同梱）、numpy（数値計算）、pytest（テスト）
- 目的: STEP読み込み・メッシュ化・テスト
- 影響範囲: `converter/.venv/` へのローカルインストールのみ（PC全体には影響しない。合計約600MB）

- [ ] **Step 4: venv作成とインストール**

このPCのPythonは3.14（cadquery非対応）のため、uvでPython 3.12のvenvを作る
（uvは導入済み、cpython 3.12.13はダウンロード済み）:

```powershell
cd apps/3d-viewer/converter
uv venv --python 3.12 .venv
uv pip install --python .venv -r requirements.txt
```

確認: `.venv\Scripts\python -c "import cadquery; print(cadquery.__version__)"` がバージョンを表示する。

- [ ] **Step 5: Commit**

```bash
git add converter/requirements.txt converter/pytest.ini converter/src/__init__.py .gitignore
git commit -m "Add converter project scaffold"
```

---

### Task 2: テスト用STEPフィクスチャ

小さなアセンブリSTEP（名前・色付きの部品2個）をテスト時に生成する。バイナリをリポジトリに含めない。

**Files:**
- Create: `converter/tests/conftest.py`

- [ ] **Step 1: conftest.py を作成**

```python
import cadquery as cq
import pytest


@pytest.fixture(scope="session")
def fixture_step(tmp_path_factory):
    """名前・色付きの2部品アセンブリSTEPを生成して返す"""
    asm = cq.Assembly(name="fixture_asm")
    asm.add(
        cq.Workplane().box(10, 10, 10),
        name="base_plate",
        color=cq.Color(1, 0, 0),
    )
    asm.add(
        cq.Workplane().cylinder(8, 3),
        name="pin",
        loc=cq.Location((0, 0, 9)),
        color=cq.Color(0, 1, 0),
    )
    path = tmp_path_factory.mktemp("fixtures") / "fixture.step"
    asm.save(str(path))
    return path
```

- [ ] **Step 2: フィクスチャが動くことを確認するテストを作成**

`converter/tests/test_smoke.py`:

```python
def test_fixture_created(fixture_step):
    assert fixture_step.exists()
    assert fixture_step.stat().st_size > 0
```

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_smoke.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add converter/tests/conftest.py converter/tests/test_smoke.py
git commit -m "Add STEP assembly test fixture"
```

---

### Task 3: データモデルとSTEP読み込み（step_loader）

**Files:**
- Create: `converter/src/models.py`
- Create: `converter/src/step_loader.py`
- Create: `converter/tests/test_step_loader.py`

- [ ] **Step 1: 失敗するテストを書く**

`converter/tests/test_step_loader.py`:

```python
import pytest
from src.step_loader import load_step


def test_load_step_returns_named_parts(fixture_step):
    parts = load_step(fixture_step)
    assert len(parts) == 2
    names = sorted(p.name.split("/")[-1] for p in parts)
    assert names == ["base_plate", "pin"]


def test_load_step_preserves_colors(fixture_step):
    parts = load_step(fixture_step)
    by_name = {p.name.split("/")[-1]: p for p in parts}
    r, g, b = by_name["base_plate"].color
    assert r > 0.9 and g < 0.1 and b < 0.1
    r, g, b = by_name["pin"].color
    assert g > 0.9 and r < 0.1


def test_load_step_missing_file():
    with pytest.raises(FileNotFoundError):
        load_step("no_such_file.step")
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_step_loader.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'src.step_loader'`）

- [ ] **Step 3: models.py を実装**

```python
from dataclasses import dataclass

import numpy as np


@dataclass
class PartMesh:
    positions: np.ndarray       # (N, 3) float32 絶対座標の頂点
    indices: np.ndarray         # (M, 3) uint32 三角形
    edge_positions: np.ndarray  # (K*2, 3) float32 稜線の線分ペア


@dataclass
class Part:
    name: str                          # "親アセンブリ/部品名" 形式のパス
    color: tuple[float, float, float] | None
    shape: object                      # TopoDS_Shape（絶対位置に配置済み）
    mesh: PartMesh | None = None
```

- [ ] **Step 4: step_loader.py を実装**

```python
"""STEPファイルをXDE経由で読み込み、部品名・色を保持したPart一覧を返す"""
from pathlib import Path

from OCP.IFSelect import IFSelect_RetDone
from OCP.Quantity import Quantity_ColorRGBA
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopLoc import TopLoc_Location
from OCP.XCAFDoc import XCAFDoc_ColorGen, XCAFDoc_ColorSurf, XCAFDoc_DocumentTool

from src.models import Part


def load_step(path) -> list[Part]:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"STEPファイルが見つかりません: {path}")

    doc = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    reader.SetColorMode(True)
    if reader.ReadFile(str(path)) != IFSelect_RetDone:
        raise ValueError(f"STEPファイルを読み込めません（形式が不正）: {path}")
    if not reader.Transfer(doc):
        raise ValueError(f"STEPデータの変換に失敗しました: {path}")

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())

    parts: list[Part] = []
    free = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free)
    for i in range(1, free.Length() + 1):
        _walk(shape_tool, color_tool, free.Value(i),
              TopLoc_Location(), [], parts)
    if not parts:
        raise ValueError("STEPファイルに形状が含まれていません")
    return parts


def _walk(shape_tool, color_tool, label, loc, path, out, inst_name=None):
    # 部品名はインスタンス名（コンポーネント側）を優先する
    name = inst_name or _label_name(label) or f"part_{len(out) + 1}"

    if shape_tool.IsAssembly_s(label):
        comps = TDF_LabelSequence()
        shape_tool.GetComponents_s(label, comps)
        for i in range(1, comps.Length() + 1):
            comp = comps.Value(i)
            comp_loc = loc.Multiplied(shape_tool.GetLocation_s(comp))
            ref = TDF_Label()
            if shape_tool.GetReferredShape_s(comp, ref):
                _walk(shape_tool, color_tool, ref, comp_loc,
                      path + [name], out, _label_name(comp))
        return

    shape = shape_tool.GetShape_s(label).Moved(loc)
    full_name = "/".join(path + [name])
    out.append(Part(name=full_name, color=_label_color(color_tool, label),
                    shape=shape))


def _label_name(label) -> str | None:
    attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
        return TCollection_AsciiString(attr.Get()).ToCString()
    return None


def _label_color(color_tool, label):
    rgba = Quantity_ColorRGBA()
    for ctype in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen):
        if color_tool.GetColor(label, ctype, rgba):
            rgb = rgba.GetRGB()
            return (rgb.Red(), rgb.Green(), rgb.Blue())
    return None
```

実装上の注意（実装者向け）:
- OCPのAPI名（`_s` サフィックスの静的メソッド等）はバージョンで微妙に異なることがある。テストが `AttributeError` で落ちる場合は `python -c "from OCP.XCAFDoc import XCAFDoc_DocumentTool; print([m for m in dir(XCAFDoc_DocumentTool) if 'Shape' in m])"` のように実際の名前を確認して合わせる
- 色は部品ラベルに無い場合がある。フィクスチャで取れない場合は、コンポーネントラベル側 (`comp`) の色も試すよう `_walk` から渡す

- [ ] **Step 5: テストが通ることを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_step_loader.py -v`
Expected: 3件 PASS

- [ ] **Step 6: Commit**

```bash
git add converter/src/models.py converter/src/step_loader.py converter/tests/test_step_loader.py
git commit -m "Add STEP loader preserving part names and colors"
```

---

### Task 4: メッシュ化とエッジ抽出（tessellate）

**Files:**
- Create: `converter/src/tessellate.py`
- Create: `converter/tests/test_tessellate.py`

- [ ] **Step 1: 失敗するテストを書く**

`converter/tests/test_tessellate.py`:

```python
import numpy as np

from src.step_loader import load_step
from src.tessellate import tessellate


def test_tessellate_produces_mesh(fixture_step):
    parts = tessellate(load_step(fixture_step), quality="standard")
    for p in parts:
        assert p.mesh is not None
        assert p.mesh.positions.shape[1] == 3
        assert len(p.mesh.positions) >= 3
        assert p.mesh.indices.dtype == np.uint32
        assert len(p.mesh.indices) >= 1
        assert p.mesh.indices.max() < len(p.mesh.positions)


def test_finer_quality_gives_more_triangles(fixture_step):
    parts = load_step(fixture_step)
    coarse = tessellate(load_step(fixture_step), quality="coarse")
    fine = tessellate(parts, quality="fine")
    # 円柱(pin)は品質を上げると三角形が増える
    pin_c = next(p for p in coarse if p.name.endswith("pin"))
    pin_f = next(p for p in fine if p.name.endswith("pin"))
    assert len(pin_f.mesh.indices) > len(pin_c.mesh.indices)


def test_tessellate_extracts_edges(fixture_step):
    parts = tessellate(load_step(fixture_step), quality="standard")
    box = next(p for p in parts if p.name.endswith("base_plate"))
    assert len(box.mesh.edge_positions) >= 2   # 線分が存在する
    assert len(box.mesh.edge_positions) % 2 == 0  # 2点で1線分
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_tessellate.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'src.tessellate'`）

- [ ] **Step 3: tessellate.py を実装**

```python
"""Part一覧をメッシュ化し、三角形と稜線折れ線を抽出する"""
import numpy as np
from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Tool
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS
from OCP.TopTools import TopTools_MapOfShape

from src.models import Part, PartMesh

# 品質 → (線形偏差の係数, 角度偏差 rad)。線形偏差はモデル対角長に掛ける
_QUALITY = {
    "coarse":   (0.004,  0.6),
    "standard": (0.0012, 0.35),
    "fine":     (0.0004, 0.2),
}


def tessellate(parts: list[Part], quality: str = "standard") -> list[Part]:
    if quality not in _QUALITY:
        raise ValueError(f"品質は coarse/standard/fine のいずれか: {quality}")
    lin_factor, ang = _QUALITY[quality]

    box = Bnd_Box()
    for p in parts:
        BRepBndLib.Add_s(p.shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    diag = ((xmax - xmin) ** 2 + (ymax - ymin) ** 2 + (zmax - zmin) ** 2) ** 0.5
    lin = max(diag * lin_factor, 1e-6)

    for p in parts:
        BRepMesh_IncrementalMesh(p.shape, lin, False, ang, True)
        p.mesh = _extract(p.shape)
    return parts


def _extract(shape) -> PartMesh:
    positions: list[tuple] = []
    tris: list[tuple] = []
    edge_pts: list[tuple] = []
    seen_edges = TopTools_MapOfShape()

    fexp = TopExp_Explorer(shape, TopAbs_FACE)
    while fexp.More():
        face = TopoDS.Face_s(fexp.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is not None:
            trsf = loc.Transformation()
            base = len(positions)
            for i in range(1, tri.NbNodes() + 1):
                pnt = tri.Node(i).Transformed(trsf)
                positions.append((pnt.X(), pnt.Y(), pnt.Z()))
            reversed_ = face.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                if reversed_:
                    a, c = c, a
                tris.append((base + a - 1, base + b - 1, base + c - 1))

            eexp = TopExp_Explorer(face, TopAbs_EDGE)
            while eexp.More():
                edge = TopoDS.Edge_s(eexp.Current())
                if seen_edges.Add(edge):
                    poly = BRep_Tool.PolygonOnTriangulation_s(edge, tri, loc)
                    if poly is not None:
                        nodes = poly.Nodes()
                        pts = [
                            tri.Node(nodes.Value(k)).Transformed(trsf)
                            for k in range(1, nodes.Length() + 1)
                        ]
                        for p0, p1 in zip(pts, pts[1:]):
                            edge_pts.append((p0.X(), p0.Y(), p0.Z()))
                            edge_pts.append((p1.X(), p1.Y(), p1.Z()))
                eexp.Next()
        fexp.Next()

    return PartMesh(
        positions=np.array(positions, dtype=np.float32).reshape(-1, 3),
        indices=np.array(tris, dtype=np.uint32).reshape(-1, 3),
        edge_positions=np.array(edge_pts, dtype=np.float32).reshape(-1, 3),
    )
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_tessellate.py -v`
Expected: 3件 PASS

- [ ] **Step 5: Commit**

```bash
git add converter/src/tessellate.py converter/tests/test_tessellate.py
git commit -m "Add tessellation with quality levels and BRep edge extraction"
```

---

### Task 5: GLBビルダー（glb_builder）

依存ライブラリなしで glTF 2.0 のGLBバイナリを組み立てる。部品 = 1ノード（三角形プリミティブ + 稜線LINESプリミティブの2つを持つ1メッシュ）。

**Files:**
- Create: `converter/src/glb_builder.py`
- Create: `converter/tests/test_glb_builder.py`

- [ ] **Step 1: 失敗するテストを書く**

`converter/tests/test_glb_builder.py`:

```python
import json
import struct

from src.glb_builder import build_glb
from src.step_loader import load_step
from src.tessellate import tessellate


def _parse_glb(data: bytes) -> dict:
    magic, version, _length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67  # "glTF"
    assert version == 2
    json_len, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A  # "JSON"
    return json.loads(data[20:20 + json_len])


def test_build_glb_valid_structure(fixture_step):
    parts = tessellate(load_step(fixture_step), quality="standard")
    gltf = _parse_glb(build_glb(parts))
    assert gltf["asset"]["version"] == "2.0"
    assert len(gltf["nodes"]) == 2
    assert len(gltf["meshes"]) == 2


def test_build_glb_node_names(fixture_step):
    parts = tessellate(load_step(fixture_step), quality="standard")
    gltf = _parse_glb(build_glb(parts))
    names = sorted(n["name"].split("/")[-1] for n in gltf["nodes"])
    assert names == ["base_plate", "pin"]


def test_build_glb_has_edge_lines(fixture_step):
    parts = tessellate(load_step(fixture_step), quality="standard")
    gltf = _parse_glb(build_glb(parts))
    modes = [prim.get("mode", 4) for m in gltf["meshes"] for prim in m["primitives"]]
    assert 4 in modes  # TRIANGLES
    assert 1 in modes  # LINES（稜線）


def test_build_glb_material_colors(fixture_step):
    parts = tessellate(load_step(fixture_step), quality="standard")
    gltf = _parse_glb(build_glb(parts))
    base_colors = [
        m["pbrMetallicRoughness"]["baseColorFactor"][:3]
        for m in gltf["materials"]
    ]
    assert any(c[0] > 0.9 and c[1] < 0.1 for c in base_colors)  # 赤がある
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_glb_builder.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'src.glb_builder'`）

- [ ] **Step 3: glb_builder.py を実装**

```python
"""Part一覧からglTF 2.0 GLBバイナリを組み立てる（外部依存なし）"""
import json
import struct

import numpy as np

from src.models import Part

_EDGE_COLOR = [0.1, 0.1, 0.12, 1.0]
_DEFAULT_COLOR = (0.62, 0.64, 0.67)  # 色情報のない部品用（金属っぽいグレー）


def build_glb(parts: list[Part]) -> bytes:
    buf = bytearray()
    buffer_views = []
    accessors = []
    materials = []
    material_index = {}  # color tuple -> index
    meshes = []
    nodes = []

    def add_view(data: bytes, target: int) -> int:
        # 4バイト境界に揃える
        while len(buf) % 4:
            buf.append(0)
        buffer_views.append({
            "buffer": 0, "byteOffset": len(buf),
            "byteLength": len(data), "target": target,
        })
        buf.extend(data)
        return len(buffer_views) - 1

    def add_positions(arr: np.ndarray) -> int:
        view = add_view(arr.tobytes(), 34962)  # ARRAY_BUFFER
        accessors.append({
            "bufferView": view, "componentType": 5126, "count": len(arr),
            "type": "VEC3",
            "min": arr.min(axis=0).tolist(), "max": arr.max(axis=0).tolist(),
        })
        return len(accessors) - 1

    def add_indices(arr: np.ndarray) -> int:
        flat = arr.reshape(-1)
        view = add_view(flat.tobytes(), 34963)  # ELEMENT_ARRAY_BUFFER
        accessors.append({
            "bufferView": view, "componentType": 5125, "count": len(flat),
            "type": "SCALAR",
        })
        return len(accessors) - 1

    def get_material(color, name):
        key = tuple(round(c, 3) for c in color)
        if key not in material_index:
            materials.append({
                "name": name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": [*key, 1.0],
                    "metallicFactor": 0.1,
                    "roughnessFactor": 0.6,
                },
                "doubleSided": True,
            })
            material_index[key] = len(materials) - 1
        return material_index[key]

    edge_material = None

    for part in parts:
        mesh = part.mesh
        primitives = [{
            "attributes": {"POSITION": add_positions(mesh.positions)},
            "indices": add_indices(mesh.indices),
            "material": get_material(part.color or _DEFAULT_COLOR, "surface"),
            "mode": 4,
        }]
        if len(mesh.edge_positions) >= 2:
            if edge_material is None:
                materials.append({
                    "name": "edge",
                    "pbrMetallicRoughness": {"baseColorFactor": _EDGE_COLOR},
                })
                edge_material = len(materials) - 1
            primitives.append({
                "attributes": {"POSITION": add_positions(mesh.edge_positions)},
                "material": edge_material,
                "mode": 1,
            })
        meshes.append({"name": part.name, "primitives": primitives})
        nodes.append({"name": part.name, "mesh": len(meshes) - 1})

    gltf = {
        "asset": {"version": "2.0", "generator": "3d-viewer-converter"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(buf)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    while len(buf) % 4:
        buf.append(0)

    total = 12 + 8 + len(json_bytes) + 8 + len(buf)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    out += struct.pack("<II", len(buf), 0x004E4942) + buf
    return bytes(out)
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_glb_builder.py -v`
Expected: 4件 PASS

- [ ] **Step 5: Commit**

```bash
git add converter/src/glb_builder.py converter/tests/test_glb_builder.py
git commit -m "Add dependency-free GLB builder with edge line primitives"
```

---

### Task 6: meshopt圧縮（compress + gltfpack導入）

**Files:**
- Create: `converter/src/compress.py`
- Create: `converter/tests/test_compress.py`
- Create: `converter/bin/gltfpack.exe`（ダウンロード、git管理外）

- [ ] **Step 1: gltfpack バイナリを導入**

meshoptimizer 公式リリースからWindows版をダウンロードして配置する:

```powershell
cd apps/3d-viewer/converter
mkdir bin
curl -L -o bin/gltfpack.zip https://github.com/zeux/meshoptimizer/releases/latest/download/gltfpack-windows.zip
tar -xf bin/gltfpack.zip -C bin
```

確認: `bin\gltfpack.exe -v` がバージョンを表示する。
（URLのファイル名がリリースにより異なる場合は https://github.com/zeux/meshoptimizer/releases を確認する）

- [ ] **Step 2: 失敗するテストを書く**

`converter/tests/test_compress.py`:

```python
import json
import struct
from pathlib import Path

import pytest

from src.compress import compress_glb, find_gltfpack
from src.glb_builder import build_glb
from src.step_loader import load_step
from src.tessellate import tessellate

needs_gltfpack = pytest.mark.skipif(
    find_gltfpack() is None, reason="gltfpack.exe が converter/bin に無い"
)


@needs_gltfpack
def test_compress_applies_meshopt(fixture_step, tmp_path):
    raw = build_glb(tessellate(load_step(fixture_step), quality="standard"))
    src = tmp_path / "raw.glb"
    src.write_bytes(raw)
    dst = tmp_path / "out.glb"

    compress_glb(src, dst)

    data = dst.read_bytes()
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    assert "EXT_meshopt_compression" in gltf.get("extensionsUsed", [])
    # ノード名が保持されている
    names = [n.get("name", "") for n in gltf["nodes"]]
    assert any(n.endswith("base_plate") for n in names)


def test_compress_missing_binary(tmp_path, monkeypatch):
    import src.compress as c
    monkeypatch.setattr(c, "find_gltfpack", lambda: None)
    with pytest.raises(RuntimeError, match="gltfpack"):
        c.compress_glb(tmp_path / "a.glb", tmp_path / "b.glb")
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_compress.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'src.compress'`）

- [ ] **Step 4: compress.py を実装**

```python
"""gltfpack(meshoptimizer)でGLBにmeshopt圧縮を適用する"""
import shutil
import subprocess
from pathlib import Path

_BIN_DIR = Path(__file__).resolve().parent.parent / "bin"


def find_gltfpack() -> Path | None:
    local = _BIN_DIR / "gltfpack.exe"
    if local.exists():
        return local
    on_path = shutil.which("gltfpack")
    return Path(on_path) if on_path else None


def compress_glb(src: Path, dst: Path) -> None:
    exe = find_gltfpack()
    if exe is None:
        raise RuntimeError(
            "gltfpack.exe が見つかりません。converter/bin/ に配置してください"
        )
    # -cc: meshopt高圧縮  -kn: ノード名を保持（部品選択に必須）
    result = subprocess.run(
        [str(exe), "-i", str(src), "-o", str(dst), "-cc", "-kn"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"圧縮に失敗しました: {result.stderr.strip()}")
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_compress.py -v`
Expected: 2件 PASS（gltfpack導入済みのため skip されないこと）

- [ ] **Step 6: Commit**

```bash
git add converter/src/compress.py converter/tests/test_compress.py
git commit -m "Add gltfpack meshopt compression wrapper"
```

---

### Task 7: パイプライン統合（pipeline）

**Files:**
- Create: `converter/src/pipeline.py`
- Create: `converter/tests/test_pipeline.py`

- [ ] **Step 1: 失敗するテストを書く**

`converter/tests/test_pipeline.py`:

```python
import pytest

from src.compress import find_gltfpack
from src.pipeline import convert

needs_gltfpack = pytest.mark.skipif(
    find_gltfpack() is None, reason="gltfpack.exe が converter/bin に無い"
)


@needs_gltfpack
def test_convert_end_to_end(fixture_step, tmp_path):
    out = tmp_path / "fixture.glb"
    stages = []

    convert(fixture_step, out, quality="standard",
            progress=lambda stage: stages.append(stage))

    assert out.exists()
    assert out.stat().st_size > 0
    assert stages == ["load", "tessellate", "build", "compress", "done"]


def test_convert_bad_input(tmp_path):
    with pytest.raises(FileNotFoundError):
        convert(tmp_path / "missing.step", tmp_path / "o.glb",
                quality="standard", progress=lambda s: None)
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_pipeline.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'src.pipeline'`）

- [ ] **Step 3: pipeline.py を実装**

```python
"""STEP → meshopt圧縮GLB の変換パイプライン"""
import tempfile
from pathlib import Path

from src.compress import compress_glb
from src.glb_builder import build_glb
from src.step_loader import load_step
from src.tessellate import tessellate


def convert(step_path, out_path, quality: str, progress) -> None:
    """progress にはステージ名 'load'/'tessellate'/'build'/'compress'/'done' を通知する"""
    step_path = Path(step_path)
    out_path = Path(out_path)

    progress("load")
    parts = load_step(step_path)

    progress("tessellate")
    tessellate(parts, quality=quality)

    progress("build")
    glb = build_glb(parts)

    progress("compress")
    with tempfile.TemporaryDirectory() as td:
        raw = Path(td) / "raw.glb"
        raw.write_bytes(glb)
        compress_glb(raw, out_path)

    progress("done")
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest tests/test_pipeline.py -v`
Expected: 2件 PASS

- [ ] **Step 5: 全テストを回す**

Run: `cd apps/3d-viewer/converter && .venv\Scripts\python -m pytest -v`
Expected: 全件 PASS

- [ ] **Step 6: Commit**

```bash
git add converter/src/pipeline.py converter/tests/test_pipeline.py
git commit -m "Add end-to-end conversion pipeline with progress stages"
```

---

### Task 8: GUI（tkinter）

「ファイル選択 → 品質選択 → 変換」の3ステップGUI。変換は別スレッドで実行し、進捗をステージ表示する。GUIは自動テストせず、手動スモークテストで確認する。

**Files:**
- Create: `converter/src/gui.py`
- Create: `converter/main.py`

- [ ] **Step 1: gui.py を実装**

```python
"""STEP→GLB変換ツールのtkinter GUI"""
import queue
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk

from src.pipeline import convert

_STAGE_TEXT = {
    "load": "STEPファイルを読み込み中…（大きいファイルは数分かかります）",
    "tessellate": "形状をメッシュ化中…",
    "build": "GLBファイルを組み立て中…",
    "compress": "圧縮中…",
    "done": "完了",
}

_QUALITY_LABELS = [("粗い", "coarse"), ("標準", "standard"), ("細かい", "fine")]


class ConverterApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("3Dモデル変換ツール（STEP → GLB）")
        root.geometry("560x260")
        font = ("Meiryo UI", 11)

        self.step_path: Path | None = None
        self.queue: queue.Queue = queue.Queue()

        frame = ttk.Frame(root, padding=16)
        frame.pack(fill="both", expand=True)

        self.file_label = tk.Label(frame, text="① STEPファイルを選んでください",
                                   font=font, anchor="w")
        self.file_label.pack(fill="x")
        tk.Button(frame, text="ファイルを選ぶ", font=font,
                  command=self.pick_file).pack(anchor="w", pady=(4, 12))

        tk.Label(frame, text="② 品質（細かいほど滑らか・ファイル大）",
                 font=font, anchor="w").pack(fill="x")
        self.quality = tk.StringVar(value="standard")
        row = ttk.Frame(frame)
        row.pack(anchor="w", pady=(4, 12))
        for label, value in _QUALITY_LABELS:
            tk.Radiobutton(row, text=label, value=value, font=font,
                           variable=self.quality).pack(side="left", padx=(0, 12))

        self.convert_btn = tk.Button(frame, text="③ 変換する", font=font,
                                     state="disabled", command=self.start)
        self.convert_btn.pack(anchor="w")

        self.status = tk.Label(frame, text="", font=font, anchor="w", fg="#333")
        self.status.pack(fill="x", pady=(12, 0))

    def pick_file(self):
        path = filedialog.askopenfilename(
            filetypes=[("STEPファイル", "*.step *.stp"), ("すべて", "*.*")])
        if path:
            self.step_path = Path(path)
            self.file_label.config(text=f"① {self.step_path.name}")
            self.convert_btn.config(state="normal")

    def start(self):
        out = self.step_path.with_suffix(".glb")
        self.convert_btn.config(state="disabled")
        threading.Thread(target=self._run, args=(out,), daemon=True).start()
        self.root.after(100, self._poll)

    def _run(self, out: Path):
        try:
            convert(self.step_path, out, quality=self.quality.get(),
                    progress=lambda s: self.queue.put(("stage", s)))
            self.queue.put(("ok", str(out)))
        except Exception as e:  # noqa: GUIでは全エラーをユーザー向けに表示する
            self.queue.put(("error", str(e)))

    def _poll(self):
        try:
            while True:
                kind, value = self.queue.get_nowait()
                if kind == "stage":
                    self.status.config(text=_STAGE_TEXT.get(value, value), fg="#333")
                elif kind == "ok":
                    self.status.config(text=f"完了: {value} に保存しました", fg="#060")
                    self.convert_btn.config(state="normal")
                    return
                elif kind == "error":
                    self.status.config(text=f"エラー: {value}", fg="#a00")
                    self.convert_btn.config(state="normal")
                    return
        except queue.Empty:
            pass
        self.root.after(100, self._poll)


def run():
    root = tk.Tk()
    ConverterApp(root)
    root.mainloop()
```

- [ ] **Step 2: main.py を実装**

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from src.gui import run

if __name__ == "__main__":
    run()
```

- [ ] **Step 3: 手動スモークテスト**

```powershell
cd apps/3d-viewer/converter
.venv\Scripts\python main.py
```

確認項目:
- ウィンドウが開き、日本語が文字化けしていない
- ファイル選択前は「変換する」が押せない
- テスト用STEP（`tests/conftest.py` と同じ内容を一時生成して使用可）を選んで変換すると、ステージ表示が進み「完了: 〜.glb に保存しました」と出る
- 存在しない/壊れたファイルではエラーが赤字で表示され、再操作できる

- [ ] **Step 4: Commit**

```bash
git add converter/src/gui.py converter/main.py
git commit -m "Add tkinter GUI for STEP to GLB conversion"
```

---

### Task 9: README と実データ検証

**Files:**
- Create: `converter/README.md`

- [ ] **Step 1: README.md を書く**

```markdown
# 3Dモデル変換ツール（STEP → GLB）

CADから出力したSTEPファイルを、3Dビューアで高速表示できる圧縮GLBに変換します。

## 準備（初回のみ）

1. Python 3.11以上をインストール
2. このフォルダで:
   ```
   py -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt
   ```
3. gltfpack を配置:
   https://github.com/zeux/meshoptimizer/releases から
   gltfpack-windows.zip をダウンロードし、`bin/gltfpack.exe` に展開

## 使い方

```
.venv\Scripts\python main.py
```

1. 「ファイルを選ぶ」でSTEPファイルを選択
2. 品質を選ぶ（迷ったら「標準」）
3. 「変換する」を押す → 同じフォルダに `〜.glb` ができます

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
```

- [ ] **Step 2: 実際の大きなSTEPファイルで検証（ユーザーと一緒に）**

ユーザーに実際のSTEPファイル（できれば100MB超）を用意してもらい:
- 変換が完了すること（所要時間をメモ）
- 出力GLBのサイズ（元の1/5以下が目安）
- three.js公式ビューア https://gltf-viewer.donmccurdy.com/ で開けること（ネット接続時）

大きすぎてメモリ不足になる場合は品質「粗い」で再試行し、結果を記録する。

- [ ] **Step 3: Commit**

```bash
git add converter/README.md
git commit -m "Add converter README with setup and usage guide"
```

---

## 完了条件

- `converter/` の全pytestがPASS
- GUIから小さなSTEPを変換してGLBが生成される
- 実データ（大型STEP）の変換が完了し、圧縮後サイズが確認できている
- ノード名（部品名）が圧縮後GLBにも保持されている（test_compressで自動検証）
