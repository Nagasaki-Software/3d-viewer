import cadquery as cq
import numpy as np
import pytest

from src.step_loader import load_step
from src.tessellate import tessellate, _linear_deflection, _compute_normals


@pytest.fixture(scope="session")
def fixture_step_mixed_scale(tmp_path_factory):
    """巨大な部品と極小の部品が同居するアセンブリSTEP
    （部品ごとの相対偏差でテッセレーションされることを確認するため）"""
    asm = cq.Assembly(name="mixed_asm")
    asm.add(cq.Workplane().box(500, 500, 500), name="big_box")
    asm.add(
        cq.Workplane().cylinder(8, 2),
        name="small_pin",
        loc=cq.Location((20000, 20000, 20000)),
    )
    path = tmp_path_factory.mktemp("fixtures_mixed") / "mixed.step"
    asm.save(str(path))
    return path


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
    # 10x10x10の直方体は直線エッジがちょうど12本 → 12線分×2点=24点以上
    assert len(box.mesh.edge_positions) >= 24
    assert len(box.mesh.edge_positions) % 2 == 0  # 2点で1線分


def test_small_part_in_large_assembly_keeps_detail(fixture_step_mixed_scale):
    # 全体アセンブリ基準の絶対偏差だと、巨大なbig_boxに対して
    # 極小のsmall_pinが過度に粗くテッシェレーションされてしまう（旧: 約12三角形）。
    # 部品ごとの相対偏差を使えば、その部品自身のスケールで滑らかにメッシュ化される
    parts = tessellate(load_step(fixture_step_mixed_scale), quality="standard")
    pin = next(p for p in parts if p.name.endswith("small_pin"))
    assert len(pin.mesh.indices) >= 100


def test_deflection_floor_does_not_scale_with_huge_assemblies():
    # 660MB級の巨大アセンブリのように全体対角長が非常に大きい場合、
    # 「全体の1%」という下限だと小部品（丸ピン等）が品質設定に関わらず
    # 粗くなってしまう。下限は全体スケールに依存しない固定値であるべき
    small_part_deflection = _linear_deflection(part_diag=5.0, global_diag=500_000.0, lin_factor=0.0004)
    assert small_part_deflection < 0.05  # 直径5mmの部品にとって滑らかな精度


def test_deflection_uses_part_relative_value_when_larger_than_floor():
    # 通常サイズの部品では、下限ではなく部品自身の相対偏差が使われる
    d = _linear_deflection(part_diag=1000.0, global_diag=2000.0, lin_factor=0.0012)
    assert d == pytest.approx(1000.0 * 0.0012)


def test_compute_normals_flat_triangle():
    # XY平面上の三角形(反時計回り)の法線は+Z向き・単位長になるはず
    positions = np.array([(0, 0, 0), (1, 0, 0), (0, 1, 0)], dtype=np.float32)
    indices = np.array([(0, 1, 2)], dtype=np.uint32)

    normals = _compute_normals(positions, indices)

    assert normals.shape == (3, 3)
    for n in normals:
        assert n == pytest.approx((0.0, 0.0, 1.0))


def test_tessellate_populates_normals(fixture_step):
    # ビューア側での毎回の法線計算(computeVertexNormals)を不要にするため、
    # 変換時に単位法線を焼き込む
    parts = tessellate(load_step(fixture_step), quality="standard")
    for p in parts:
        assert p.mesh.normals.shape == p.mesh.positions.shape
        lengths = np.linalg.norm(p.mesh.normals, axis=1)
        assert np.all(lengths > 0.99) and np.all(lengths < 1.01)
