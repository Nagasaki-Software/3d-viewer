import cadquery as cq
import pytest
from OCP.BRep import BRep_Builder
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt
from OCP.IFSelect import IFSelect_RetDone
from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs
from OCP.TCollection import TCollection_ExtendedString
from OCP.TDocStd import TDocStd_Document
from OCP.TopoDS import TopoDS_Compound
from OCP.XCAFDoc import XCAFDoc_ColorSurf, XCAFDoc_DocumentTool

from src.compress import find_gltfpack

needs_gltfpack = pytest.mark.skipif(
    find_gltfpack() is None, reason="gltfpack.exe が converter/bin に無い"
)


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


@pytest.fixture(scope="session")
def rhino_like_step(tmp_path_factory):
    """アセンブリ（製品構造）を持たないSTEPを生成して返す。
    1つの形状(compound)の中に複数ソリッドが入り、色は各ソリッド（サブシェイプ）側に
    付く。cadqueryのアセンブリ出力とは構造が異なる"""
    red_box = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), 10, 10, 10).Shape()
    blue_box = BRepPrimAPI_MakeBox(gp_Pnt(20, 0, 0), 5, 5, 5).Shape()

    builder = BRep_Builder()
    root = TopoDS_Compound()
    builder.MakeCompound(root)
    builder.Add(root, red_box)
    builder.Add(root, blue_box)

    doc = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main())
    label = shape_tool.AddShape(root, False)  # False = 製品構造を作らない
    for solid, rgb in ((red_box, (1.0, 0.0, 0.0)), (blue_box, (0.0, 0.0, 1.0))):
        sub = shape_tool.AddSubShape(label, solid)
        color_tool.SetColor(sub, Quantity_Color(*rgb, Quantity_TOC_RGB),
                            XCAFDoc_ColorSurf)

    path = tmp_path_factory.mktemp("fixtures") / "rhino_like.step"
    writer = STEPCAFControl_Writer()
    writer.Transfer(doc, STEPControl_AsIs)
    if writer.Write(str(path)) != IFSelect_RetDone:
        raise RuntimeError("テスト用STEPの書き出しに失敗しました")
    return path
