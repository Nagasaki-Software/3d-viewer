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

    def add_vec3(arr: np.ndarray) -> int:
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        view = add_view(arr.tobytes(), 34962)  # ARRAY_BUFFER
        accessors.append({
            "bufferView": view, "componentType": 5126, "count": len(arr),
            "type": "VEC3",
            "min": arr.min(axis=0).tolist(), "max": arr.max(axis=0).tolist(),
        })
        return len(accessors) - 1

    def add_indices(arr: np.ndarray) -> int:
        flat = np.ascontiguousarray(arr, dtype=np.uint32).reshape(-1)
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
        # 参照・退化形状は三角形0枚にテッセレーションされることがあるため、
        # そのような部品はノード/メッシュを作らずスキップする
        if len(mesh.positions) == 0 or len(mesh.indices) == 0:
            continue
        primitives = [{
            "attributes": {
                "POSITION": add_vec3(mesh.positions),
                "NORMAL": add_vec3(mesh.normals),
            },
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
                "attributes": {"POSITION": add_vec3(mesh.edge_positions)},
                "material": edge_material,
                "mode": 1,
            })
        meshes.append({"name": part.name, "primitives": primitives})
        nodes.append({"name": part.name, "mesh": len(meshes) - 1})

    # BINチャンクは4バイト境界にパディングしてからbyteLengthを確定する
    # （JSON側のbuffers[0].byteLengthは最終チャンク長と一致させる必要がある）
    while len(buf) % 4:
        buf.append(0)

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

    total = 12 + 8 + len(json_bytes) + 8 + len(buf)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    out += struct.pack("<II", len(buf), 0x004E4942) + buf
    return bytes(out)
