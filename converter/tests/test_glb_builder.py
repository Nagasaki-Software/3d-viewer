import json
import struct

import numpy as np

from src.glb_builder import build_glb
from src.models import Part, PartMesh
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


def test_build_glb_skips_empty_part_mesh():
    normal = Part(
        name="normal_part",
        color=(1.0, 0.0, 0.0),
        shape=None,
        mesh=PartMesh(
            positions=np.array(
                [(0, 0, 0), (1, 0, 0), (0, 1, 0)], dtype=np.float32
            ),
            indices=np.array([(0, 1, 2)], dtype=np.uint32),
            edge_positions=np.zeros((0, 3), dtype=np.float32),
            normals=np.array(
                [(0, 0, 1), (0, 0, 1), (0, 0, 1)], dtype=np.float32
            ),
        ),
    )
    empty = Part(
        name="empty_part",
        color=(0.0, 1.0, 0.0),
        shape=None,
        mesh=PartMesh(
            positions=np.zeros((0, 3), dtype=np.float32),
            indices=np.zeros((0, 3), dtype=np.uint32),
            edge_positions=np.zeros((0, 3), dtype=np.float32),
            normals=np.zeros((0, 3), dtype=np.float32),
        ),
    )

    gltf = _parse_glb(build_glb([normal, empty]))

    assert len(gltf["nodes"]) == 1
    names = [n["name"] for n in gltf["nodes"]]
    assert names == ["normal_part"]
    assert len(gltf["meshes"]) == 1


def test_build_glb_includes_normals(fixture_step):
    # ビューア側での毎回の法線計算を不要にするため、変換時にNORMAL属性を焼き込む
    parts = tessellate(load_step(fixture_step), quality="standard")
    gltf = _parse_glb(build_glb(parts))
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            if prim.get("mode", 4) == 4:  # 三角形（稜線側にはNORMAL不要）
                assert "NORMAL" in prim["attributes"]
