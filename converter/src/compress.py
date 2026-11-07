"""gltfpack(meshoptimizer)でGLBにmeshopt圧縮を適用する"""
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _bin_dir() -> Path:
    # EXE化(PyInstaller)時は、bin/はEXEと同じフォルダに配置される想定
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "bin"
    return Path(__file__).resolve().parent.parent / "bin"


_BIN_DIR = _bin_dir()

# 三角形数そのものを削減する比率(0〜1)。大規模アセンブリでの表示準備時間・
# 操作時の重さを軽くするために使う。gltfpackの誤差上限(既定1%)を超える簡略化は
# 行われないため、単純な形状は実質この比率まで削られない
_SIMPLIFY_RATIO = 0.5

# LOD(操作中の軽量表示)用の削減比率。静止時は精密版を表示するため、
# 多少の粗さより三角形数の大幅削減を優先する（-saで比率を強制）
_LOD_SIMPLIFY_RATIO = 0.05

# 中間版（操作中にまず表示する段階）の削減比率。軽量版(5%)より見た目を保ち、
# 内蔵グラフィックスでも操作できる三角形数を狙う。遅い機械ではビューアが軽量版へ下げる
_MID_SIMPLIFY_RATIO = 0.15


def find_gltfpack() -> Path | None:
    local = _BIN_DIR / "gltfpack.exe"
    if local.exists():
        return local
    on_path = shutil.which("gltfpack")
    return Path(on_path) if on_path else None


def _run_gltfpack(src: Path, dst: Path, extra_args: list[str]) -> None:
    exe = find_gltfpack()
    if exe is None:
        raise RuntimeError(
            "gltfpack.exe が見つかりません。converter/bin/ に配置してください"
        )
    # 一時ファイルへ出力し成功時のみdstへ置き換える（失敗時にdstを壊さない）。
    # gltfpackは出力拡張子が.gltf/.glbであることを要求するため拡張子は保持する
    tmp_dst = dst.with_name(dst.stem + ".tmp" + dst.suffix)
    result = subprocess.run(
        [str(exe), "-i", str(src), "-o", str(tmp_dst), *extra_args],
        capture_output=True, text=True, errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"圧縮に失敗しました: {result.stderr.strip()}")
    os.replace(tmp_dst, dst)


def compress_glb(src: Path, dst: Path) -> None:
    # -cc: meshopt高圧縮  -kn: ノード名を保持（部品選択に必須）
    # -si: 三角形数を比率で簡略化（誤差上限は既定値=形状の破綻を防ぐ）
    _run_gltfpack(src, dst, ["-cc", "-kn", "-si", str(_SIMPLIFY_RATIO)])


def compress_glb_lod(src: Path, dst: Path) -> None:
    # 操作中の軽量表示専用。部品選択はしないのでノード名保持(-kn)は不要。
    # -sa で目標比率を品質より優先して大幅に削減する
    # -sv: 簡略化時に頂点位置も整え直す（gltfpack 1.3以降）。見本モデルの比較で
    # 形のずれが平均で約1〜2割減り、サイズと三角形数は同じだった
    _run_gltfpack(src, dst, ["-cc", "-si", str(_LOD_SIMPLIFY_RATIO), "-sa", "-sv"])


def compress_glb_mid(src: Path, dst: Path) -> None:
    # 操作中の中間表示専用。軽量版と同じく部品選択はしないので -kn は付けない
    _run_gltfpack(src, dst, ["-cc", "-si", str(_MID_SIMPLIFY_RATIO), "-sa", "-sv"])
