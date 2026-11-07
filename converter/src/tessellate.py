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

# 品質 → (線形偏差の係数, 角度偏差 rad)。線形偏差は部品ごとの対角長に掛ける
_QUALITY = {
    "coarse":   (0.004,  0.6),
    "standard": (0.0012, 0.35),
    "fine":     (0.0004, 0.2),
}

# 線形偏差の下限（mm）。極小部品での異常な高精度化（メッシュ生成の遅延・肥大化）を防ぐための
# 固定値。モデル全体のスケールに依存させると、巨大なアセンブリで小さな丸部品が
# 品質設定に関わらず粗くなってしまう（例: 全体対角長の1%を下限にすると、
# 660MB級の巨大モデルではこの下限自体が大きくなりすぎる）
_MIN_DEFLECTION = 0.01


def _linear_deflection(part_diag: float, global_diag: float, lin_factor: float) -> float:
    """部品ごとの線形偏差を返す。part_diagに対する相対偏差を基本とし、
    極小部品向けに固定の絶対下限（_MIN_DEFLECTION）のみを適用する
    （global_diagは将来の調整用に受け取るが、下限計算には使わない）"""
    del global_diag  # 現状は下限に使わないが、呼び出し側との互換のため引数は残す
    return max(part_diag * lin_factor, _MIN_DEFLECTION)


def _compute_normals(positions: np.ndarray, indices: np.ndarray) -> np.ndarray:
    """三角形の面法線を頂点ごとに合成して正規化する（面積加重平均になる）。
    ビューア(three.js)のcomputeVertexNormalsと同じ結果になるようにし、
    変換時に1回だけ計算して焼き込むことで閲覧のたびの再計算を不要にする"""
    normals = np.zeros_like(positions, dtype=np.float32)
    if len(indices) == 0:
        return normals
    tri = positions[indices]
    face_normals = np.cross(tri[:, 2] - tri[:, 1], tri[:, 0] - tri[:, 1])
    for col in range(3):
        np.add.at(normals, indices[:, col], face_normals)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    lengths[lengths == 0] = 1
    return (normals / lengths).astype(np.float32)


def tessellate(parts: list[Part], quality: str = "standard") -> list[Part]:
    if quality not in _QUALITY:
        raise ValueError(f"品質は coarse/standard/fine のいずれか: {quality}")
    lin_factor, ang = _QUALITY[quality]

    # 全体アセンブリの対角長。小部品の偏差下限（下記lin参照）にのみ使う
    global_box = Bnd_Box()
    for p in parts:
        BRepBndLib.Add_s(p.shape, global_box)
    xmin, ymin, zmin, xmax, ymax, zmax = global_box.Get()
    global_diag = ((xmax - xmin) ** 2 + (ymax - ymin) ** 2 + (zmax - zmin) ** 2) ** 0.5

    for p in parts:
        # 線形偏差は部品ごとの対角長に対して計算する（部品ごとの相対偏差）。
        # 全体アセンブリ基準の絶対偏差だと、大きな部品と同居する小さな部品が
        # 極端に粗くテッセレーションされてしまうため
        part_box = Bnd_Box()
        BRepBndLib.Add_s(p.shape, part_box)
        pxmin, pymin, pzmin, pxmax, pymax, pzmax = part_box.Get()
        part_diag = ((pxmax - pxmin) ** 2 + (pymax - pymin) ** 2
                     + (pzmax - pzmin) ** 2) ** 0.5
        lin = _linear_deflection(part_diag, global_diag, lin_factor)
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
                # REVERSED面は頂点順を反転し、法線が外向きになるよう揃える
                if reversed_:
                    a, c = c, a
                # OCCTの節点番号は1始まりのため-1。baseはこの部品で
                # ここまでに積んだ頂点数のオフセット
                tris.append((base + a - 1, base + b - 1, base + c - 1))

            # --- エッジ折れ線の抽出 ---
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

    pos_arr = np.array(positions, dtype=np.float32).reshape(-1, 3)
    idx_arr = np.array(tris, dtype=np.uint32).reshape(-1, 3)
    return PartMesh(
        positions=pos_arr,
        indices=idx_arr,
        edge_positions=np.array(edge_pts, dtype=np.float32).reshape(-1, 3),
        normals=_compute_normals(pos_arr, idx_arr),
    )
