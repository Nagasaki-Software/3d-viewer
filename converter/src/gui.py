"""STEP→GLB変換ツールのtkinter GUI"""
import multiprocessing
import queue
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk

from src.worker import run_convert

_STAGE_TEXT = {
    "boot": "変換プログラムを準備中…",
    "load": "STEPファイルを読み込み中…（大きいファイルは数分かかります）",
    "tessellate": "形状をメッシュ化中…",
    "build": "GLBファイルを組み立て中…",
    "compress": "圧縮中…",
    "done": "完了",
}

_QUALITY_LABELS = [("粗い", "coarse"), ("標準", "standard"), ("細かい", "fine")]


class ConverterApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("3Dモデル変換ツール（STEP → GLB）")
        root.geometry("560x260")
        font = ("Meiryo UI", 11)

        self.step_path: Path | None = None

        frame = ttk.Frame(root, padding=16)
        frame.pack(fill="both", expand=True)

        self.file_label = tk.Label(frame, text="① STEPファイルを選んでください",
                                   font=font, anchor="w")
        self.file_label.pack(fill="x")
        self.pick_btn = tk.Button(frame, text="ファイルを選ぶ", font=font,
                                  command=self.pick_file)
        self.pick_btn.pack(anchor="w", pady=(4, 12))

        tk.Label(frame, text="② 品質（細かいほど滑らか・ファイル大）",
                 font=font, anchor="w").pack(fill="x")
        self.quality = tk.StringVar(value="standard")
        row = ttk.Frame(frame)
        row.pack(anchor="w", pady=(4, 12))
        for label, value in _QUALITY_LABELS:
            tk.Radiobutton(row, text=label, value=value, font=font,
                           variable=self.quality).pack(side="left", padx=(0, 12))

        self.convert_btn = tk.Button(frame, text="③ 変換する", font=font,
                                     state="disabled", command=self.start)
        self.convert_btn.pack(anchor="w")

        self.status = tk.Label(frame, text="", font=font, anchor="w", fg="#333")
        self.status.pack(fill="x", pady=(12, 0))

    def pick_file(self):
        path = filedialog.askopenfilename(
            filetypes=[("STEPファイル", "*.step *.stp"), ("すべて", "*.*")])
        if path:
            self.step_path = Path(path)
            self.file_label.config(text=f"① {self.step_path.name}")
            self.convert_btn.config(state="normal")

    def start(self):
        # step_pathと品質は子プロセス起動前にローカル変数へ確定させる。
        # 変換中にself.step_pathが（ファイル再選択などで）変わっても
        # 実行中の変換に影響しないようにするため
        step_path = self.step_path
        out = step_path.with_suffix(".glb")
        # tk.StringVar.get() はメインスレッドでのみ呼び出せるため、
        # 子プロセスに渡す前にここで値を確定させる
        quality = self.quality.get()
        self.convert_btn.config(state="disabled")
        self.pick_btn.config(state="disabled")
        ctx = multiprocessing.get_context("spawn")
        self.queue = ctx.Queue()
        self.status.config(text=_STAGE_TEXT["boot"], fg="#333")
        self.proc = ctx.Process(
            target=run_convert,
            args=(str(step_path), str(out), quality, self.queue),
            daemon=True,
        )
        self.proc.start()
        self._dead_check_pending = False
        self.root.after(100, self._poll)

    def _poll(self):
        try:
            while True:
                kind, value = self.queue.get_nowait()
                if kind == "stage":
                    self.status.config(text=_STAGE_TEXT.get(value, value), fg="#333")
                elif kind == "ok":
                    size_mb = value["size_bytes"] / (1024 * 1024)
                    self.status.config(
                        text=(f"完了: {value['path']} に保存しました\n"
                              f"（部品数 {value['parts']:,}　三角形数 {value['triangles']:,}　{size_mb:.1f}MB）"),
                        fg="#060")
                    self.convert_btn.config(state="normal")
                    self.pick_btn.config(state="normal")
                    return
                elif kind == "error":
                    self.status.config(text=f"エラー: {value}", fg="#a00")
                    self.convert_btn.config(state="normal")
                    self.pick_btn.config(state="normal")
                    return
        except queue.Empty:
            pass
        if not self.proc.is_alive() and self.queue.empty():
            # プロセス終了直後はキューの転送が一瞬遅れることがあるため、
            # 500ms後にもう一度だけ確認してから異常終了と判断する
            if self._dead_check_pending:
                self.status.config(text="エラー: 変換プログラムが異常終了しました", fg="#a00")
                self.convert_btn.config(state="normal")
                self.pick_btn.config(state="normal")
                return
            self._dead_check_pending = True
            self.root.after(500, self._poll)
            return
        self._dead_check_pending = False
        self.root.after(100, self._poll)


def run():
    root = tk.Tk()
    ConverterApp(root)
    root.mainloop()
