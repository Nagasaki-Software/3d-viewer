import pytest
from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Builder
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt
from OCP.TopoDS import TopoDS_Compound

from src.models import Part
from src.step_loader import _dedupe_names, _leaf_shapes, load_step


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


def test_load_step_full_name_has_no_duplicated_prefix(fixture_step):
    parts = load_step(fixture_step)
    by_name = {p.name.split("/")[-1]: p for p in parts}
    assert by_name["base_plate"].name == "fixture_asm/base_plate"
    assert by_name["pin"].name == "fixture_asm/pin"


def test_load_step_preserves_placement(fixture_step):
    # "pin"は高さ8の円柱をz=9に配置したもの → 絶対座標でのz範囲は[5, 13]
    parts = load_step(fixture_step)
    by_name = {p.name.split("/")[-1]: p for p in parts}
    box = Bnd_Box()
    BRepBndLib.Add_s(by_name["pin"].shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    assert abs(zmin - 5) < 0.1
    assert abs(zmax - 13) < 0.1


def test_load_step_missing_file():
    with pytest.raises(FileNotFoundError):
        load_step("no_such_file.step")


def test_load_step_names_are_unique(fixture_step):
    # 同一部品が複数配置された場合でも、名前は一意でなければならない
    # （ビューアの部品タップ・注記機能が名前をキーにするため）
    parts = load_step(fixture_step)
    names = [p.name for p in parts]
    assert len(names) == len(set(names))


def test_load_step_splits_compound_into_separate_parts(rhino_like_step):
    # アセンブリ構造を持たないSTEP（Rhino等）では、複数の形状が1つのcompoundに
    # まとめて入る。まとめて1部品として扱うとビューアで個別に選択・非表示にできず、
    # 色も取得できないため、中の形状ごとに部品へ分ける
    parts = load_step(rhino_like_step)
    assert len(parts) == 2


def test_load_step_preserves_subshape_colors(rhino_like_step):
    # 色はcompound全体ではなく各ソリッド側に付いているため、そちらから取得する
    parts = load_step(rhino_like_step)
    assert all(p.color is not None for p in parts)
    reds = [p for p in parts if p.color[0] > 0.9 and p.color[2] < 0.1]
    blues = [p for p in parts if p.color[2] > 0.9 and p.color[0] < 0.1]
    assert len(reds) == 1
    assert len(blues) == 1


def test_leaf_shapes_flattens_nested_compounds():
    # CADによっては形状が何重ものcompoundで包まれる。直下だけを開く実装だと
    # 「中身1個」と判定して分割できず、1部品にまとまってしまう
    # （STEPに書き出すと入れ子は平坦化されるため、形状データを直接検証する）
    builder = BRep_Builder()
    inner = TopoDS_Compound()
    builder.MakeCompound(inner)
    builder.Add(inner, BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 1, 1, 1).Shape())
    builder.Add(inner, BRepPrimAPI_MakeBox(gp_Pnt(5, 0, 0), 1, 1, 1).Shape())
    outer = TopoDS_Compound()
    builder.MakeCompound(outer)
    builder.Add(outer, inner)

    assert len(_leaf_shapes(outer)) == 2


def test_leaf_shapes_returns_non_compound_as_single_shape():
    box = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 1, 1, 1).Shape()
    assert len(_leaf_shapes(box)) == 1


def test_load_step_compound_part_names_are_unique(rhino_like_step):
    parts = load_step(rhino_like_step)
    names = [p.name for p in parts]
    assert len(names) == len(set(names))


def test_dedupe_names_appends_suffix_for_repeats():
    parts = [
        Part(name="top/bolt", color=None, shape=None),
        Part(name="top/bolt", color=None, shape=None),
        Part(name="top/bolt", color=None, shape=None),
        Part(name="top/nut", color=None, shape=None),
    ]
    _dedupe_names(parts)
    assert [p.name for p in parts] == [
        "top/bolt", "top/bolt#2", "top/bolt#3", "top/nut",
    ]
