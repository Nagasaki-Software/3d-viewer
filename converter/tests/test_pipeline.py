import numpy as np
import pytest

from src.glb_builder import build_glb
from src.models import Part, PartMesh
from src.pipeline import convert, _count_triangles
from tests.conftest import needs_gltfpack


def _make_glb(n_triangles: int) -> bytes:
    positions = np.array([(0, 0, 0), (1, 0, 0), (0, 1, 0)], dtype=np.float32)
    indices = np.tile(np.array([(0, 1, 2)], dtype=np.uint32), (n_triangles, 1))
    normals = np.tile(np.array([(0, 0, 1)], dtype=np.float32), (3, 1))
    part = Part(name="p", color=(1.0, 0.0, 0.0), shape=None, mesh=PartMesh(
        positions=positions, indices=indices,
        edge_positions=np.zeros((0, 3), dtype=np.float32), normals=normals,
    ))
    return build_glb([part])


def test_count_triangles_from_glb_bytes():
    assert _count_triangles(_make_glb(3)) == 3


@needs_gltfpack
def test_convert_end_to_end(fixture_step, tmp_path):
    out = tmp_path / "fixture.glb"
    stages = []

    stats = convert(fixture_step, out, quality="standard",
                     progress=lambda stage: stages.append(stage))

    assert out.exists()
    assert out.stat().st_size > 0
    assert stages == ["load", "tessellate", "build", "compress", "done"]
    # fixture_stepはbase_plate+pinの2部品なので、統計もそれに合った値になる
    assert stats["parts"] == 2
    assert stats["triangles"] > 0


def test_convert_reports_triangles_after_simplification(monkeypatch, fixture_step, tmp_path):
    # gltfpackの-siで圧縮後に三角形数が減るため、統計はテッセレーション直後ではなく
    # 圧縮後の実ファイルから数え直す必要がある
    import src.pipeline as pipeline

    def fake_compress(src, dst):
        dst.write_bytes(_make_glb(1))

    monkeypatch.setattr(pipeline, "compress_glb", fake_compress)
    stats = pipeline.convert(fixture_step, tmp_path / "o.glb", quality="standard",
                              progress=lambda s: None)
    assert stats["triangles"] == 1


def test_convert_generates_lod_file(monkeypatch, fixture_step, tmp_path):
    # 通常GLBに加え、操作中の軽量表示用 <name>_lod.glb も出力する。
    # 統計(triangles)は通常版のみを反映する
    import src.pipeline as pipeline

    def fake_compress(src, dst):
        dst.write_bytes(_make_glb(10))

    def fake_compress_lod(src, dst):
        dst.write_bytes(_make_glb(1))

    monkeypatch.setattr(pipeline, "compress_glb", fake_compress)
    monkeypatch.setattr(pipeline, "compress_glb_lod", fake_compress_lod)

    out = tmp_path / "model.glb"
    stats = pipeline.convert(fixture_step, out, quality="standard",
                              progress=lambda s: None)

    assert (tmp_path / "model_lod.glb").exists()
    assert stats["triangles"] == 10  # 通常版の三角形数（LOD版の1ではない）


def test_convert_survives_lod_failure(monkeypatch, fixture_step, tmp_path):
    # 軽量版(LOD)は任意の付加物。生成に失敗しても本体GLBは有効なので、
    # 変換全体は成功させLODだけスキップする
    import src.pipeline as pipeline

    def fake_compress(src, dst):
        dst.write_bytes(_make_glb(10))

    def boom_lod(src, dst):
        raise RuntimeError("lod boom")

    monkeypatch.setattr(pipeline, "compress_glb", fake_compress)
    monkeypatch.setattr(pipeline, "compress_glb_lod", boom_lod)

    out = tmp_path / "model.glb"
    stats = pipeline.convert(fixture_step, out, quality="standard",
                              progress=lambda s: None)

    assert out.exists()                     # 本体は生成される
    assert not (tmp_path / "model_lod.glb").exists()  # LODはスキップ
    assert stats["triangles"] == 10         # 統計は通常版どおり


def test_convert_generates_mid_file(monkeypatch, fixture_step, tmp_path):
    # 中間版 <name>_mid.glb も出力する。統計は通常版のみ
    import src.pipeline as pipeline

    def fake_compress(src, dst):
        dst.write_bytes(_make_glb(10))

    def fake_small(src, dst):
        dst.write_bytes(_make_glb(1))

    monkeypatch.setattr(pipeline, "compress_glb", fake_compress)
    monkeypatch.setattr(pipeline, "compress_glb_lod", fake_small)
    monkeypatch.setattr(pipeline, "compress_glb_mid", fake_small)

    out = tmp_path / "model.glb"
    stats = pipeline.convert(fixture_step, out, quality="standard",
                              progress=lambda s: None)

    assert (tmp_path / "model_mid.glb").exists()
    assert stats["triangles"] == 10


def test_convert_survives_mid_failure(monkeypatch, fixture_step, tmp_path):
    # 中間版も任意の付加物。失敗しても本体と軽量版は残り、変換は成功する
    import src.pipeline as pipeline

    def fake_compress(src, dst):
        dst.write_bytes(_make_glb(10))

    def fake_lod(src, dst):
        dst.write_bytes(_make_glb(1))

    def boom_mid(src, dst):
        raise RuntimeError("mid boom")

    monkeypatch.setattr(pipeline, "compress_glb", fake_compress)
    monkeypatch.setattr(pipeline, "compress_glb_lod", fake_lod)
    monkeypatch.setattr(pipeline, "compress_glb_mid", boom_mid)

    out = tmp_path / "model.glb"
    stats = pipeline.convert(fixture_step, out, quality="standard",
                              progress=lambda s: None)

    assert out.exists()
    assert (tmp_path / "model_lod.glb").exists()
    assert not (tmp_path / "model_mid.glb").exists()
    assert stats["triangles"] == 10


def test_convert_bad_input(tmp_path):
    with pytest.raises(FileNotFoundError):
        convert(tmp_path / "missing.step", tmp_path / "o.glb",
                quality="standard", progress=lambda s: None)


def test_convert_wraps_unexpected_tessellate_error(monkeypatch, fixture_step, tmp_path):
    import src.pipeline as pipeline

    def boom(parts, quality):
        raise KeyError("boom")

    monkeypatch.setattr(pipeline, "tessellate", boom)
    with pytest.raises(RuntimeError, match="変換処理中に予期しないエラーが発生しました"):
        pipeline.convert(fixture_step, tmp_path / "o.glb",
                          quality="standard", progress=lambda s: None)


def test_convert_does_not_rewrap_known_errors(monkeypatch, fixture_step, tmp_path):
    import src.pipeline as pipeline

    def boom(parts, quality):
        raise ValueError("known error")

    monkeypatch.setattr(pipeline, "tessellate", boom)
    with pytest.raises(ValueError, match="known error"):
        pipeline.convert(fixture_step, tmp_path / "o.glb",
                          quality="standard", progress=lambda s: None)
