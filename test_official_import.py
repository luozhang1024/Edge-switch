"""OAuth imports, refresh preservation, explicit inference, and credential redaction."""
import json
import io
import urllib.error
from pathlib import Path
import tempfile
import tkinter as tk
import unittest
from unittest.mock import patch
from workbench.app import App
from workbench.core import Store, Board
from workbench.remote_agent import parse_official_auth, import_official_auth, official_test

AUTH = dict(auth_mode='chatgpt', OPENAI_API_KEY=None, tokens=dict(access_token='private-access', refresh_token='private-refresh', id_token='private-id', account_id='account'))

class OfficialImportTests(unittest.TestCase):
    def test_empty_auth_preserves_and_api_only_rejected(self):
        self.assertIsNone(parse_official_auth('{}'))
        for value in ('[]', '{bad-private-token', json.dumps(dict(OPENAI_API_KEY='private-api')), json.dumps(dict(tokens=dict(access_token='private', refresh_token=3)))):
            with self.assertRaises(ValueError) as error:
                parse_official_auth(value)
            self.assertNotIn('private', str(error.exception))
    def test_import_never_overwrites_rotated_tokens_with_same_snapshot(self):
        with tempfile.TemporaryDirectory() as directory, patch('workbench.remote_agent.scope', return_value=Path(directory)):
            payload = dict(auth_json=json.dumps(AUTH))
            result = import_official_auth(payload)
            path = Path(directory) / 'codex-chatgpt-home/auth.json'
            self.assertNotIn('private-access', str(result))
            refreshed = dict(AUTH, tokens=dict(AUTH['tokens'], access_token='rotated-access'))
            path.write_text(json.dumps(refreshed))
            import_official_auth(payload)
            self.assertEqual(json.loads(path.read_text())['tokens']['access_token'], 'rotated-access')
            import_official_auth(dict(auth_json='{}'))
            self.assertEqual(json.loads(path.read_text())['tokens']['access_token'], 'rotated-access')
            import_official_auth(dict(auth_json=json.dumps(dict(AUTH, tokens=dict(AUTH['tokens'], access_token='new-account-access')))))
            self.assertEqual(json.loads(path.read_text())['tokens']['access_token'], 'new-account-access')
    def test_network_region_error_is_distinct_from_credentials(self):
        error = urllib.error.HTTPError('https://chatgpt.com/codex', 403, 'Forbidden', {},
                    io.BytesIO(b'{"error":{"code":"unsupported_country_region_territory"}}'))
        with patch('workbench.remote_agent.scope', return_value=Path('.')), \
             patch('workbench.remote_agent.codex_auth_status', return_value=dict(authenticated=True)), \
             patch('workbench.remote_agent.urllib.request.OpenerDirector.open', side_effect=error):
            result = official_test(dict(infer=False))
        self.assertFalse(result['ok'])
        self.assertTrue(result['authenticated'])
        self.assertIn('地区限制', result['message'])

    def test_inference_only_accepts_complete_reply_and_hides_raw_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tools/codex').mkdir(parents=True)
            (root / 'tools/codex/current.json').write_text(json.dumps(dict(binary='/managed/codex')))
            with patch('workbench.remote_agent.scope', return_value=root), patch('workbench.remote_agent.codex_auth_status', return_value=dict(authenticated=True)):
                events = '\n'.join(json.dumps(e) for e in [dict(type='item.completed', item=dict(type='agent_message', text='OK')), dict(type='turn.completed')])
                def command(args, env, timeout):
                    self.assertEqual(env['CODEX_HOME'], str(root / 'codex-chatgpt-home'))
                    self.assertIn('--ephemeral', args)
                    self.assertIn('--ignore-user-config', args)
                    project = Path(args[args.index('-C') + 1])
                    self.assertEqual(list(project.iterdir()), [])
                    self.assertNotIn('private-access', str(args))
                    return events
                with patch('workbench.remote_agent.command', side_effect=command):
                    self.assertTrue(official_test(dict(infer=True))['ok'])
                with patch('workbench.remote_agent.command', return_value='{}'):
                    self.assertFalse(official_test(dict(infer=True))['ok'])
                with patch('workbench.remote_agent.command', side_effect=RuntimeError('401 private-access private-refresh')):
                    result = official_test(dict(infer=True))
                    self.assertFalse(result['ok'])
                    self.assertNotIn('private', str(result))

class OfficialEditorTests(unittest.TestCase):
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
    def test_save_encrypts_import_and_applies_only_on_enable(self):
        app = self.app
        app.open_official_editor()
        dialog = app.official_dialog
        dialog.editor_values['name'].set('OpenAI Official Work')
        dialog.editor_values['note'].set('My account')
        dialog.auth_editor.delete('1.0','end')
        dialog.auth_editor.insert('1.0',json.dumps(AUTH))
        dialog.commit()
        self.assertFalse(dialog.winfo_exists())
        self.assertEqual(self.pending, [])
        self.assertEqual(app.current.codex_auth, 'api')
        self.assertNotIn('private-access', app.store.path.read_text(encoding='utf-8'))
        self.assertNotIn('private-refresh', app.store.path.read_text(encoding='utf-8'))
        self.assertEqual(json.loads(app.official_auth_payload(app.current.id)), AUTH)
        app.activate_official()
        task, done = self.pending.pop()
        with patch.object(Board,'call',side_effect=[{}, {}, dict(authenticated=True)]) as call:
            done(task())
        self.assertEqual([c.args[0] for c in call.call_args_list], ['import_official_auth','configure','codex_auth_status'])
        self.assertEqual(app.current.codex_auth, 'chatgpt')
        self.assertFalse(app.official_settings()['pending'])
        app.open_official_editor()
        self.assertEqual(app.official_dialog.auth_editor.get('1.0','end').strip(),'{}')
        app.official_dialog.commit()
        self.assertEqual(json.loads(app.official_auth_payload(app.current.id)), AUTH)
        self.assertEqual(Store(self.folder.name).official[app.current.id]['name'],'OpenAI Official Work')
    def test_verify_requires_confirmation_and_test_never_requests_inference(self):
        app = self.app
        with patch('workbench.official_ui.messagebox.askyesno',return_value=False):
            app.test_official(infer=True)
        self.assertEqual(self.pending,[])
        app.test_official()
        task, done = self.pending.pop()
        with patch.object(Board,'call',return_value=dict(ok=True,message='ok')) as call:
            task()
        self.assertFalse(call.call_args.kwargs['infer'])
        with patch('workbench.official_ui.messagebox.askyesno',return_value=True):
            app.test_official(infer=True)
        task, done = self.pending.pop()
        with patch.object(Board,'call',return_value=dict(ok=True,message='ok')) as call:
            task()
        self.assertTrue(call.call_args.kwargs['infer'])
    def test_editing_active_auth_requires_reactivation(self):
        app = self.app
        app.vars['codex_auth'].set('chatgpt')
        app.save()
        app.save_official_settings(dict(name='Official',note='',website='https://chatgpt.com/codex'),json.dumps(AUTH))
        card = app.api_card_widgets['openai-official']
        self.assertEqual(card['enable'].cget('state'),'normal')
        self.assertEqual(card['buttons']['delete'].cget('state'),'disabled')

if __name__ == '__main__':
    unittest.main()
