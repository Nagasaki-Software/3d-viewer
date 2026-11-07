import json
import struct
from pathlib import Path

import pytest

from src.compress import compress_glb
from src.glb_builder import build_glb
from src.step_loader import load_step
from src.tessellate import tessellate
from tests.conftest import needs_gltfpack


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


def test_compress_passes_simplify_ratio(tmp_path, monkeypatch):
    # 三角形数そのものを減らし、表示準備時間・操作時の重さの両方を軽くするため、
    # gltfpackの簡略化(-si)を常に有効にする（品質劣化はgltfpack既定の誤差上限で抑えられる）
    import subprocess

    import src.compress as c

    captured = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        out_path = Path(args[args.index("-o") + 1])
        out_path.write_bytes(b"dummy")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(c, "find_gltfpack", lambda: Path("gltfpack.exe"))
    monkeypatch.setattr(c.subprocess, "run", fake_run)

    c.compress_glb(tmp_path / "a.glb", tmp_path / "b.glb")

    args = captured["args"]
    assert "-si" in args
    ratio = float(args[args.index("-si") + 1])
    assert 0 < ratio < 1


def test_compress_lod_passes_aggressive_flags(tmp_path, monkeypatch):
    # LOD(操作中の軽量表示)用は三角形数を大幅に削るため、目標比率5%を
    # 品質より優先する -sa と組み合わせる
    import subprocess

    import src.compress as c

    captured = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        out_path = Path(args[args.index("-o") + 1])
        out_path.write_bytes(b"dummy")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(c, "find_gltfpack", lambda: Path("gltfpack.exe"))
    monkeypatch.setattr(c.subprocess, "run", fake_run)

    c.compress_glb_lod(tmp_path / "a.glb", tmp_path / "b_lod.glb")

    args = captured["args"]
    assert "-sa" in args
    ratio = float(args[args.index("-si") + 1])
    assert 0 < ratio <= 0.1  # 大幅削減
    assert "-kn" not in args
    assert "-sv" in args  # 簡略化時に頂点位置を整え直す（gltfpack 1.3以降）


def test_compress_mid_passes_middle_ratio(tmp_path, monkeypatch):
    # 中間版は軽量版(5%)と精密版の間。比率を品質より優先する -sa を付け、
    # 部品選択はしないので -kn は付けない
    import subprocess

    import src.compress as c

    captured = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        out_path = Path(args[args.index("-o") + 1])
        out_path.write_bytes(b"dummy")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(c, "find_gltfpack", lambda: Path("gltfpack.exe"))
    monkeypatch.setattr(c.subprocess, "run", fake_run)

    c.compress_glb_mid(tmp_path / "a.glb", tmp_path / "b_mid.glb")

    args = captured["args"]
    assert "-sa" in args
    assert float(args[args.index("-si") + 1]) == pytest.approx(0.15)
    assert "-kn" not in args
    assert "-sv" in args
