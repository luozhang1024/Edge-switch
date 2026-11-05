"""Windows notification area integration; Tk is touched only by its event queue."""
import threading
from PIL import Image
import pystray
from workbench.core import ROOT


class Tray:
    def __init__(self, events):
        with Image.open(ROOT / 'image/EdgeAI.ico') as source:
            bitmap = source.convert('RGBA')
        self.ready = threading.Event()
        self.icon = pystray.Icon('EdgeSwitch', bitmap, 'Edge Switch · 后台运行', menu=pystray.Menu(
            pystray.MenuItem('打开工作台', lambda *args: events.put(('tray', 'show')), default=True),
            pystray.MenuItem('退出程序', lambda *args: events.put(('tray', 'quit')))))
        def setup(icon):
            icon.visible = True
            self.ready.set()
        self.thread = threading.Thread(target=lambda: self.icon.run(setup=setup), daemon=True)
        self.thread.start()
        if not self.ready.wait(3):
            self.icon.stop()
            raise RuntimeError('无法建立系统托盘图标')

    def close(self):
        self.icon.stop()
