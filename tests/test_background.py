import json
from pathlib import Path
import tempfile
import threading
import time
import tkinter as tk
import unittest
from unittest.mock import MagicMock, patch
from workbench import core, remote_agent
from workbench.app import App


class BackgroundTests(unittest.TestCase):
    def test_slow_versions_do_not_block_other_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            release = threading.Event()
            try:
                app = App(root, core.Store(directory))
                def fetch(*args):
                    release.wait(3)
                    return {t: dict(latest='1.0.0', versions=['1.0.0']) for t in ('codex', 'harness')}
                with patch('workbench.app.fetch_versions', side_effect=fetch):
                    app.versions()
                    self.assertFalse(app.busy)
                    other = MagicMock()
                    app.guard(other)
                    other.assert_called_once()
                    app.new()
                    self.assertTrue(app.environment_dialog.winfo_exists())
                    app.environment_dialog.destroy()
                    release.set()
                    deadline = time.monotonic() + 3
                    while app._versions_loading and time.monotonic() < deadline:
                        app.poll()
                        time.sleep(.01)
                self.assertFalse(app._versions_loading)
            finally:
                release.set()
                root.destroy()

    def test_close_hides_and_keeps_connections(self):
        app = App.__new__(App)
        app.root = MagicMock()
        app.events = MagicMock()
        app.sessions = {'one': MagicMock()}
        app.tunnels = {'one': MagicMock()}
        with patch('workbench.tray.Tray') as tray:
            app.close()
            app.close()
            tray.assert_called_once()
        app.root.withdraw.assert_called()
        app.sessions['one'].close.assert_not_called()
        app.tunnels['one'].close.assert_not_called()

    def test_board_reuse_test_never_returns_key_and_checks_service_and_url(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'codex-home').mkdir()
            (root / 'launch.json').write_text(json.dumps(dict(key='private-board-key', service_id='service-a')))
            (root / 'codex-home/config.toml').write_text('base_url = "https://example.com/v1"\nmodel = "test-model"\n')
            p = dict(reuse=True, service_id='service-a', base_url='https://example.com/v1', protocol='responses', infer=False)
            response = MagicMock()
            response.__enter__.return_value.status = 200
            response.__enter__.return_value.read.return_value = b'{"data":[{"id":"test-model"}]}'
            opener = MagicMock()
            opener.open.return_value = response
            with patch.object(remote_agent, 'scope', return_value=root), \
                    patch.object(remote_agent.urllib.request, 'build_opener', return_value=opener):
                result = remote_agent.api_test(p)
                self.assertTrue(result['ok'])
                self.assertNotIn('private-board-key', str(result))
                for change in (dict(service_id='service-b'), dict(base_url='https://other.test/v1')):
                    with self.assertRaises(ValueError):
                        remote_agent.api_test(dict(p, **change))
                self.assertEqual(opener.open.call_count, 1)


if __name__ == '__main__':
    unittest.main()
