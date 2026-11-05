"""Native pointer hover and modal screenshots, disposable local data only."""
import tempfile
import time
import tkinter as tk
import win32api
from PIL import ImageGrab
from workbench.app import App
from workbench.core import Store


def main():
    pointer = win32api.GetCursorPos()
    with tempfile.TemporaryDirectory() as directory:
        root = tk.Tk()
        app = App(root, Store(directory))
        errors = []
        root.report_callback_exception = lambda *args: errors.append(str(args))
        def pump():
            deadline = time.monotonic() + .25
            while time.monotonic() < deadline:
                root.update()
                time.sleep(.01)
        def capture(window, path):
            ImageGrab.grab(bbox=(window.winfo_rootx(), window.winfo_rooty(),
                                window.winfo_rootx() + window.winfo_width(),
                                window.winfo_rooty() + window.winfo_height())).save(path)
        try:
            app.api_name.set('CodeLink')
            app.vars['base_url'].set('https://aicodelink.top/v1')
            app.vars['model'].set('gpt-6.1-sol')
            app.vars['protocol'].set('responses')
            app.save()
            first = app.current.active_api
            second = 'b' * 32
            app.save_api_entry(dict(id=second, name='OpenAI Official', base_url='https://api.openai.com/v1',
                                    model='gpt-6.1-sol', protocol='responses'), '', False)
            # Display fixture; no API or SSH requests are made by this visual check.
            app.store.applied[app.current.id] = first
            app.render_api_cards()
            app.notebook.select(2)
            root.attributes('-topmost', True)
            pump()
            frame = app.api_card_widgets[second]['frame']
            win32api.SetCursorPos((root.winfo_rootx() + 80, root.winfo_rooty() + 80))
            pump()
            assert app.api_card_widgets[second]['actions'].winfo_manager() == ''
            win32api.SetCursorPos((frame.winfo_rootx() + 110, frame.winfo_rooty() + 35))
            pump()
            assert app.api_card_widgets[second]['actions'].winfo_manager() == 'place'
            button = app.api_card_widgets[second]['enable']
            win32api.SetCursorPos((button.winfo_rootx() + 20, button.winfo_rooty() + 12))
            pump()
            assert app.api_card_widgets[second]['actions'].winfo_manager() == 'place'
            capture(root, 'docs/workbench-0.7-api.png')
            win32api.SetCursorPos((root.winfo_rootx() + 80, root.winfo_rooty() + 80))
            pump()
            assert app.api_card_widgets[second]['actions'].winfo_manager() == ''
            app.add_api_button.invoke()
            pump()
            assert len(app.store.api_entries(app.current)) == 2
            capture(app.api_dialog, 'docs/workbench-0.7-dialog.png')
            assert not errors, errors
            print('Native hover, button crossing, leave, plus dialog and callbacks: PASS')
        finally:
            root.destroy()
            win32api.SetCursorPos(pointer)


if __name__ == '__main__':
    main()
