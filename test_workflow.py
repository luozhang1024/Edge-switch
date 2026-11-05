import tempfile
import tkinter as tk
import unittest
import json
import time
from unittest.mock import patch
from workbench.app import App
from workbench.core import Store
from workbench.versions import published_versions


class WorkflowTests(unittest.TestCase):
    def test_published_versions_puts_latest_first_and_excludes_deprecated(self):
        value = published_versions(dict(versions={'1.9.0': {}, '1.10.0': {}, '2.0.0-rc.1': {},
                                                   'bad': {}, '3.0.0': {'deprecated': 'removed'}},
                                        **{'dist-tags': {'latest': '1.10.0'}}))
        self.assertEqual(value['versions'], ['1.10.0', '2.0.0-rc.1', '1.9.0'])
        self.assertEqual(value['latest'], '1.10.0')
        with self.assertRaises(ValueError):
            published_versions({})

    def test_page_order_automatic_versions_and_preserved_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, Store(directory))
                self.assertFalse(hasattr(app, 'picker'))
                self.assertEqual([b.cget('text').strip() for b in app.notebook.buttons],
                                 ['工作环境', '代理网络', 'AI 工具', '模型服务', '设备总览'])
                self.assertEqual(app.notebook.active, 0)
                app.vars['codex_version'].set('0.100.0')
                result = {t: dict(latest='1.2.0', versions=['1.2.0', '1.1.0']) for t in ('codex', 'harness')}
                with patch('workbench.app.fetch_versions', return_value=result) as fetch:
                    app.versions()
                    deadline = time.monotonic() + 3
                    while app._versions_loading and time.monotonic() < deadline:
                        app.poll()
                        time.sleep(.01)
                    fetch.assert_called_once_with(False, 7890)
                self.assertFalse(app.busy)
                self.assertTrue(all(str(b.cget('state')) == 'normal' for b in app.buttons))
                self.assertEqual(app.vars['codex_version'].get(), '0.100.0')
                self.assertIn('0.100.0', app.version_pickers['codex']['values'])
                self.assertEqual(app.vars['harness_version'].get(), '1.2.0')
                self.assertEqual(str(app.version_pickers['harness'].cget('state')), 'readonly')
                with patch('workbench.app.fetch_versions', side_effect=OSError('offline')):
                    app.versions()
                    deadline = time.monotonic() + 3
                    while app._versions_loading and time.monotonic() < deadline:
                        app.poll()
                        time.sleep(.01)
                self.assertEqual(app.vars['codex_version'].get(), '0.100.0')
                self.assertIn('失败', app.version_status.get())
                app._cache_loaded = False
                app._version_stamp = 0
                app.notebook.active = 2
                with patch('workbench.app.fetch_versions') as fetch:
                    app.ensure_versions()
                    fetch.assert_not_called()
                self.assertEqual(app._version_catalog, result)
                self.assertTrue((app.store.directory / 'versions-cache.json').exists())
            finally:
                root.destroy()


if __name__ == '__main__':
    unittest.main()
