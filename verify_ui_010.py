"""Workflow visual check using disposable configuration and real npm metadata."""
import json
from pathlib import Path
import tempfile
import time
import tkinter as tk
from PIL import ImageGrab
from workbench.app import App
from workbench.core import Store


def main():
    with tempfile.TemporaryDirectory() as directory:
        root = tk.Tk()
        app = App(root, Store(directory))
        root.geometry('1040x700+130+70')
        root.attributes('-topmost', True)
        def pump(seconds=.5):
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                root.update()
                time.sleep(.02)
        def capture(window, filename):
            ImageGrab.grab(bbox=(window.winfo_rootx(), window.winfo_rooty(),
                                window.winfo_rootx() + window.winfo_width(),
                                window.winfo_rooty() + window.winfo_height())).save('docs/' + filename)
        try:
            pump()
            app.new()
            pump()
            dialog = app.environment_dialog
            dx = abs((dialog.winfo_rootx() + dialog.winfo_width()/2) - (root.winfo_rootx() + root.winfo_width()/2))
            dy = abs((dialog.winfo_rooty() + dialog.winfo_height()/2) - (root.winfo_rooty() + root.winfo_height()/2))
            assert dx < 3 and dy < 3, (dx, dy)
            capture(root, 'workbench-0.10-dialog-centered.png')
            dialog.destroy()
            pump()
            capture(root, 'workbench-0.10-environments.png')
            app.notebook.select(2)
            deadline = time.monotonic() + 65
            while (app.busy or not getattr(app, '_version_catalog', None)) and time.monotonic() < deadline:
                pump(.2)
            assert getattr(app, '_version_catalog', None), app.version_status.get()
            pump()
            capture(root, 'workbench-0.10-tools.png')
            report = dict(centered=True, center_offset=[dx, dy], automatic_npm=True,
                          versions={t: len(v['versions']) for t, v in app._version_catalog.items()},
                          order=[b.cget('text').strip() for b in app.notebook.buttons])
            Path('docs/workflow-0.10-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False))
        finally:
            root.destroy()


if __name__ == '__main__':
    main()
