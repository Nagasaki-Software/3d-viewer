from dataclasses import dataclass

import numpy as np


@dataclass
class PartMesh:
    positions: np.ndarray       # (N, 3) float32 絶対座標の頂点
    indices: np.ndarray         # (M, 3) uint32 三角形
    edge_positions: np.ndarray  # (K*2, 3) float32 稜線の線分ペア
    normals: np.ndarray         # (N, 3) float32 頂点法線（単位ベクトル）


@dataclass
class Part:
    name: str                          # "親アセンブリ/部品名" 形式のパス
    color: tuple[float, float, float] | None
    shape: object                      # TopoDS_Shape（絶対位置に配置済み）
    mesh: PartMesh | None = None
