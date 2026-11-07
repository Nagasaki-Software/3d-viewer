"""STEPファイルをXDE経由で読み込み、部品名・色を保持したPart一覧を返す"""
from pathlib import Path

from OCP.IFSelect import IFSelect_RetDone
from OCP.Quantity import Quantity_ColorRGBA
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_COMPOUND
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS_Iterator
from OCP.XCAFDoc import XCAFDoc_ColorGen, XCAFDoc_ColorSurf, XCAFDoc_DocumentTool

from src.models import Part


def load_step(path, report: list[str] | None = None) -> list[Part]:
    """STEPを読み込んでPart一覧を返す。
    report にリストを渡すと、CADごとの構造差を切り分けるための診断行を追記する
    （変換結果がおかしいときに、STEPファイル自体を共有せず状況を伝えるため）"""
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
    _dedupe_names(parts)
    if report is not None:
        _describe(shape_tool, color_tool, free, parts, report)
    return parts


def _type_name(shape) -> str:
    return str(shape.ShapeType()).split(".")[-1].replace("TopAbs_", "")


def _describe(shape_tool, color_tool, free, parts, report) -> None:
    """STEPの構造を人が読める形で report に追記する（診断用）"""
    report.append(f"最上位の形状数: {free.Length()}")
    for i in range(1, min(free.Length(), 5) + 1):
        label = free.Value(i)
        shape = shape_tool.GetShape_s(label)
        comps = TDF_LabelSequence()
        is_asm = shape_tool.IsAssembly_s(label)
        if is_asm:
            shape_tool.GetComponents_s(label, comps)
        subs = TDF_LabelSequence()
        shape_tool.GetSubShapes_s(label, subs)

        children = []
        it = TopoDS_Iterator(shape)
        while it.More():
            children.append(_type_name(it.Value()))
            it.Next()

        report.append(f"[{i}] 名前={_label_name(label)!r} アセンブリ={is_asm} "
                      f"種類={_type_name(shape)}")
        report.append(f"     部品数(components)={comps.Length()} "
                      f"サブ形状ラベル数={subs.Length()} "
                      f"色={_label_color(shape_tool, color_tool, label, shape)}")
        report.append(f"     直下の中身={len(children)}個 {sorted(set(children))}")
        report.append(f"     再帰的に開いた形状数={len(_leaf_shapes(shape))}")

    report.append(f"生成された部品数: {len(parts)}")
    colored = sum(1 for p in parts if p.color is not None)
    report.append(f"うち色が取得できた部品: {colored}")
    for p in parts[:10]:
        report.append(f"  - {p.name} color={p.color}")


def _dedupe_names(parts: list[Part]) -> None:
    # 同一部品（同じ形状）が複数箇所に配置されるアセンブリでは、
    # フルパス名が完全に一致する部品が複数生成されうる。
    # ビューアの部品タップ・注記機能は名前をキーにするため、
    # 2件目以降には "#2", "#3", ... を付けて名前を一意化する
    seen: dict[str, int] = {}
    for part in parts:
        count = seen.get(part.name, 0) + 1
        seen[part.name] = count
        if count > 1:
            part.name = f"{part.name}#{count}"


def _walk(shape_tool, color_tool, label, loc, path, out, inst_name=None):
    # 部品名はラベル自身の名前を優先する（インスタンス名は数値の自動採番のみのことが多い）
    name = _label_name(label) or inst_name or f"part_{len(out) + 1}"

    if shape_tool.IsAssembly_s(label):
        comps = TDF_LabelSequence()
        shape_tool.GetComponents_s(label, comps)

        # CADカーネルは「名前・色を持つ単一部品」を
        # 「1個の子コンポーネントだけを持つアセンブリ」として表現することが多い
        # （例: "base_plate"アセンブリ → 子コンポーネント → 実体形状"base_plate_part"）。
        # この場合は子まで降りずに現ラベルを1部品として扱う（名前は現ラベル、
        # 色はまず現ラベルを調べ、無ければ実体形状を持つ子ラベルから取得する）。
        # 注意: 本物の「1部品だけのサブアセンブリ」もこの形と区別できないため、
        # その場合はサブアセンブリ名を引き継いだ1部品に平坦化される（既知の限界）。
        if comps.Length() == 1:
            comp = comps.Value(1)
            leaf = TDF_Label()
            if shape_tool.GetReferredShape_s(comp, leaf):
                if not shape_tool.IsAssembly_s(leaf):
                    color = (_label_color(shape_tool, color_tool, label)
                             or _label_color(shape_tool, color_tool, leaf))
                    _emit_parts(shape_tool, color_tool, label,
                                shape_tool.GetShape_s(label), loc, path, name,
                                color, out)
                    return
                # cadqueryのSTEP出力はトップアセンブリを「同名の単一子アセンブリ」で
                # 二重に包むため、同名の素通しレベルは名前を重ねずにスキップする
                if _label_name(leaf) == name:
                    comp_loc = loc.Multiplied(shape_tool.GetLocation_s(comp))
                    _walk(shape_tool, color_tool, leaf, comp_loc,
                          path, out, inst_name)
                    return

        for i in range(1, comps.Length() + 1):
            comp = comps.Value(i)
            comp_loc = loc.Multiplied(shape_tool.GetLocation_s(comp))
            ref = TDF_Label()
            if shape_tool.GetReferredShape_s(comp, ref):
                _walk(shape_tool, color_tool, ref, comp_loc,
                      path + [name], out, _label_name(comp))
        return

    base_shape = shape_tool.GetShape_s(label)
    _emit_parts(shape_tool, color_tool, label, base_shape, loc, path, name,
                _label_color(shape_tool, color_tool, label, base_shape), out)


def _emit_parts(shape_tool, color_tool, label, base_shape, loc, path, name,
                own_color, out):
    """形状を部品としてoutに追加する。中身が複数形状のcompoundなら個別の部品に分ける。

    アセンブリ（製品構造）を持たないSTEP（Rhino等の出力）は、複数の形状を1つの
    compoundにまとめて書き出す。まとめて1部品として扱うと、ビューアで個別に
    選択・非表示にできず、色もcompound自体には付いていないため取得できず
    全てグレーになる。
    """
    children = _leaf_shapes(base_shape)
    if len(children) <= 1:
        out.append(Part(name="/".join(path + [name]),
                        color=own_color,
                        shape=base_shape.Moved(loc)))
        return

    for i, child in enumerate(children, start=1):
        child_name = _sub_shape_name(shape_tool, label, child) or f"{name}_{i}"
        out.append(Part(
            name="/".join(path + [child_name]),
            # 色は各形状（サブシェイプ）側に付く。無ければcompound全体の色を使う
            color=(_label_color(shape_tool, color_tool, label, child)
                   or own_color),
            shape=child.Moved(loc)))


def _leaf_shapes(shape) -> list:
    """compoundを再帰的に開き、中身の形状（compound以外）を列挙する。
    compound以外の形状はそれ自身を1件返す。
    CADによっては形状が何重ものcompoundで包まれるため、直下だけを見ると
    「中身1個」と判定して分割できない"""
    if shape.ShapeType() != TopAbs_COMPOUND:
        return [shape]
    leaves = []
    it = TopoDS_Iterator(shape)
    while it.More():
        leaves.extend(_leaf_shapes(it.Value()))
        it.Next()
    return leaves


def _sub_shape_name(shape_tool, label, sub) -> str | None:
    """compound内の形状に対応するサブシェイプ・ラベルの名前を返す（無ければNone）"""
    sub_label = TDF_Label()
    if shape_tool.FindSubShape(label, sub, sub_label):
        return _label_name(sub_label)
    return None


def _label_name(label) -> str | None:
    # 名前属性を持たないラベル（compound内のサブシェイプ等）に対していきなり
    # FindAttributeを呼ぶとアクセス違反でプロセスごと落ちるため、先に有無を確認する
    if not label.IsAttribute(TDataStd_Name.GetID_s()):
        return None
    attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
        return TCollection_AsciiString(attr.Get()).ToCString()
    return None


def _label_color(shape_tool, color_tool, label, shape=None):
    # このOCPバインディングのGetColorはTopoDS_Shapeでの検索のみをサポートするため、
    # ラベルからいったん形状を取り出して問い合わせる
    if shape is None:
        shape = shape_tool.GetShape_s(label)
    rgba = Quantity_ColorRGBA()
    for ctype in (XCAFDoc_ColorSurf, XCAFDoc_ColorGen):
        if color_tool.GetColor(shape, ctype, rgba):
            rgb = rgba.GetRGB()
            return (rgb.Red(), rgb.Green(), rgb.Blue())
    return None
