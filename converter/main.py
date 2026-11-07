import os
import sys

# --windowed でビルドしたEXEはコンソールが無くsys.stdout/stderrがNoneになるため、
# print()やライブラリの内部出力でクラッシュしないようdevnullへ差し替える
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
elif hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

import multiprocessing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from src.gui import run

if __name__ == "__main__":
    multiprocessing.freeze_support()  # EXE化(PyInstaller)対応
    run()
