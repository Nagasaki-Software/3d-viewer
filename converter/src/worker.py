"""変換を別プロセスで実行するエントリ。

OCPのSTEP読み込みはGILを離さないため、スレッドではGUIが固まる。
Windowsのspawn方式で子プロセスからimportできるよう、モジュールレベル関数にする。
"""
from src.pipeline import convert


def run_convert(step_path, out_path, quality, q):
    """queueへ ('stage', name) / ('ok', {path, parts, triangles, size_bytes}) / ('error', message) を送る"""
    try:
        stats = convert(step_path, out_path, quality,
                         progress=lambda s: q.put(("stage", s)))
        q.put(("ok", {"path": str(out_path), **stats}))
    except Exception as e:  # noqa: 例外はすべてGUIへ文字列で伝える
        q.put(("error", str(e)))
