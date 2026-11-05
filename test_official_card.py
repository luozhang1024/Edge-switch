"""Official service card switching without API credential or inference calls."""
import tempfile
import tkinter as tk
import unittest
from unittest.mock import patch
from workbench.app import App
from workbench.core import Store, Board
from workbench.api_ui import OFFICIAL_ID

class OfficialCardTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = tk.Tk()
        self.root.withdraw()
        self.app = App(self.root, Store(self.folder.name))
        self.pending = []
        self.app.run = lambda label, task, done=None: self.pending.append((task, done))
    def tearDown(self):
        self.root.destroy()
        self.folder.cleanup()
    def test_builtin_and_no_auth_controls_on_tools_page(self):
        card = self.app.api_card_widgets[OFFICIAL_ID]
        self.assertEqual(card['enable'].cget('text'), '启用')
        self.assertEqual(card['actions'].winfo_manager(), '')
        card['hover'](True)
        self.assertEqual(card['actions'].winfo_manager(), 'place')
        self.assertEqual(card['buttons']['edit'].tooltip.text, '编辑')
        self.assertEqual(card['buttons']['test'].tooltip.text, '测试')
        self.assertEqual(set(card['buttons']), {'edit','test','verify','delete'})
        self.assertEqual(card['buttons']['delete'].cget('state'), 'disabled')
        self.assertFalse(any(b.cget('text') == '登录 ChatGPT' for b in self.app.buttons))
    def test_switch_preserves_api_key_and_returns_to_api(self):
        app = self.app
        api_id = app.current.active_api
        app.vars['protocol'].set('responses')
        app.vars['model'].set('test-model')
        app.key_var.set('private-api-key')
        app.remember.set(True)
        app.save()
        app.activate_api(OFFICIAL_ID)
        task, done = self.pending.pop()
        self.assertEqual(app.current.codex_auth, 'api')
        with patch.object(Board, 'call', side_effect=[{}, dict(authenticated=True)]):
            done(task())
        self.assertEqual(app.current.codex_auth, 'chatgpt')
        self.assertEqual(app.key_var.get(), 'private-api-key')
        self.assertEqual(app.api_card_widgets[OFFICIAL_ID]['enable'].cget('text'), '使用中')
        self.assertEqual(Store(self.folder.name).profiles[0].codex_auth, 'chatgpt')
        app.activate_api(api_id)
        task, done = self.pending.pop()
        with patch.object(Board, 'call', return_value={}):
            done(task())
        self.assertEqual(app.current.codex_auth, 'api')
        self.assertEqual(app.api_card_widgets[api_id]['enable'].cget('text'), '使用中')
        self.assertEqual(app.key_var.get(), 'private-api-key')
    def test_missing_auth_waits_for_login_before_switch(self):
        app = self.app
        app.activate_api(OFFICIAL_ID)
        task, done = self.pending.pop()
        with patch.object(Board, 'call', side_effect=[{}, dict(authenticated=False)]), patch.object(app, 'open_official_editor') as editor:
            done(task())
            editor.assert_called_once()
            self.assertEqual(app.current.codex_auth, 'api')
    def test_status_does_not_change_service_or_send_inference(self):
        app = self.app
        app.check_official()
        task, done = self.pending.pop()
        with patch.object(Board, 'call', return_value=dict(authenticated=True)) as call, patch('workbench.api_ui.messagebox.showinfo'):
            done(task())
        call.assert_called_once_with('codex_auth_status')
        self.assertEqual(app.current.codex_auth, 'api')

if __name__ == '__main__':
    unittest.main()
