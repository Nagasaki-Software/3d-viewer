"""STEP → meshopt圧縮GLB の変換パイプライン"""
import json
import struct
import sys
import tempfile
from pathlib import Path

from src.compress import compress_glb, compress_glb_lod, compress_glb_mid
from src.glb_builder import build_glb
from src.step_loader import load_step
from src.tessellate import tessellate


def _count_triangles(glb_bytes: bytes) -> int:
    """GLBバイナリの三角形数を数える。gltfpackの簡略化(-si)で圧縮後に
    三角形数が変わるため、統計はテッセレーション直後ではなく圧縮後のファイルから数える。
    meshopt圧縮下でもJSON側のaccessors[].countは論理要素数のまま保たれる"""
    json_len = struct.unpack_from("<I", glb_bytes, 12)[0]
    gltf = json.loads(glb_bytes[20:20 + json_len])
    accessors = gltf.get("accessors", [])
    total = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) != 4:  # TRIANGLES以外(稜線等)は数えない
                continue
            total += accessors[prim["indices"]]["count"] // 3
    return total


def convert(step_path, out_path, quality: str, progress) -> dict:
    """progress にはステージ名 'load'/'tessellate'/'build'/'compress'/'done' を通知する。
    戻り値は部品数・三角形数などの統計（GUI側の完了メッセージ表示に使う）"""
    step_path = Path(step_path)
    out_path = Path(out_path)

    progress("load")
    parts = load_step(step_path)

    try:
        progress("tessellate")
        tessellate(parts, quality=quality)

        progress("build")
        glb = build_glb(parts)

        progress("compress")
        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "raw.glb"
            raw.write_bytes(glb)
            compress_glb(raw, out_path)
            # 軽量表示(LOD)は任意の付加物。生成に失敗しても本体GLBは有効なので、
            # 変換全体は失敗させずLODだけスキップする（ビューアはLOD無しで通常動作にフォールバック）
            lod_path = out_path.with_name(out_path.stem + "_lod" + out_path.suffix)
            try:
                compress_glb_lod(raw, lod_path)
            except Exception as e:
                print(f"LOD生成をスキップしました: {e}", file=sys.stderr)
            mid_path = out_path.with_name(out_path.stem + "_mid" + out_path.suffix)
            try:
                compress_glb_mid(raw, mid_path)
            except Exception as e:
                print(f"中間版の生成をスキップしました: {e}", file=sys.stderr)
    except (FileNotFoundError, ValueError, RuntimeError):
        raise
    except Exception as e:
        # 想定外の例外はユーザー向けメッセージを持つRuntimeErrorに変換する
        raise RuntimeError(f"変換処理中に予期しないエラーが発生しました: {e}") from e

    progress("done")
    return {
        "parts": len(parts),
        "triangles": _count_triangles(out_path.read_bytes()),
        "size_bytes": out_path.stat().st_size,
    }
