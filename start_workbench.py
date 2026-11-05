from workbench.app import main

if __name__ == '__main__':
    import sys
    if sys.argv[1:] == ['--self-check']:
        import json
        import shutil
        import tkinter as tk
        from workbench.core import DATA, ROOT, protect
        root = tk.Tk()
        root.withdraw()
        report = dict(license=(ROOT / 'LICENSE').is_file(), tk=True, remote_agent=(ROOT / 'workbench/remote_agent.py').is_file(),
                      harness_service=(ROOT / 'workbench/harness_service.py').is_file(),
                      ssh=bool(shutil.which('ssh.exe')),
                      credentials=protect(protect('self-check'), decrypt=True) == 'self-check')
        from tempfile import TemporaryDirectory
        from workbench.app import App
        from workbench.core import Store
        with TemporaryDirectory() as directory:
            app = App(root, Store(directory))
            root.update_idletasks()
            report.update(ui=len(app.notebook.tabs()) == 5,
                          native_icons=len(getattr(root, 'native_icons', [])) == 2,
                          api_cards=bool(app.api_cards.winfo_children()),
                          environment_cards=bool(app.environment_card_widgets),
                          action_images=all(app.action_images.values()),
                          images=all(app.images.values()), icon=(ROOT / 'image/EdgeAI.ico').exists(),
                          navigation_icons=all(image.cget('size') == (22, 22) for image in app.nav_icons.values()))
        root.destroy()
        from workbench.tray import Tray
        import queue
        tray = Tray(queue.Queue())
        report['tray'] = tray.icon.visible
        tray.close()
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / 'self-check.json').write_text(json.dumps(report), encoding='utf-8')
        sys.exit(0 if all(report.values()) else 1)
    else:
        main()
