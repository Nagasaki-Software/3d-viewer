import multiprocessing as mp
import queue as queue_mod

from tests.conftest import needs_gltfpack


def _drain(q):
    msgs = []
    while True:
        try:
            msgs.append(q.get(timeout=1))
        except queue_mod.Empty:
            return msgs


@needs_gltfpack
def test_run_convert_in_subprocess(fixture_step, tmp_path):
    from src.worker import run_convert
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    out = tmp_path / "out.glb"
    p = ctx.Process(target=run_convert,
                    args=(str(fixture_step), str(out), "standard", q))
    p.start()
    p.join(timeout=300)
    assert p.exitcode == 0
    msgs = _drain(q)
    stages = [v for k, v in msgs if k == "stage"]
    assert stages == ["load", "tessellate", "build", "compress", "done"]
    assert msgs[-1][0] == "ok"
    assert msgs[-1][1]["path"] == str(out)
    assert msgs[-1][1]["parts"] == 2
    assert msgs[-1][1]["triangles"] > 0
    assert out.exists()


def test_run_convert_reports_error(tmp_path):
    from src.worker import run_convert
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    p = ctx.Process(target=run_convert,
                    args=(str(tmp_path / "missing.step"), str(tmp_path / "o.glb"), "standard", q))
    p.start()
    p.join(timeout=120)
    msgs = _drain(q)
    assert msgs[-1][0] == "error"
    assert "STEP" in msgs[-1][1]  # 日本語エラーメッセージが伝わる
