"""Multiple API records, credential boundaries, migration, and UI switching."""
import json
from pathlib import Path
import tempfile
import tkinter as tk
import unittest
import uuid
from unittest.mock import patch

from workbench import core, remote_agent
from workbench.app import App


class ApiServiceTests(unittest.TestCase):
    def test_verify_icon_confirms_inference_and_tooltips(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, core.Store(directory))
                eid = app.current.active_api
                app.vars['model'].set('test-model')
                app.key_var.set('test-key')
                app.save()
                pending = []
                app.run = lambda label, task, done=None: pending.append((task, done))
                buttons = app.api_card_widgets[eid]['buttons']
                self.assertEqual(buttons['verify'].tooltip.text, '验证')
                self.assertEqual(buttons['test'].tooltip.text, '测试')
                with patch('workbench.api_ui.messagebox.askyesno', return_value=False):
                    buttons['verify'].invoke()
                self.assertEqual(pending, [])
                with patch('workbench.api_ui.messagebox.askyesno', return_value=True):
                    app.api_card_widgets[eid]['buttons']['verify'].invoke()
                with patch.object(core.Board, 'call', return_value=dict(ok=True, message='推理通过')) as call:
                    result = pending[-1][0]()
                    self.assertTrue(call.call_args.kwargs['infer'])
                with patch('workbench.api_ui.messagebox.showinfo'):
                    pending[-1][1](result)
                self.assertEqual(app.overview_vars['model'].get(), '推理通过')
                app.test_api_entry(eid)
                with patch.object(core.Board, 'call', return_value=dict(ok=True, message='列表可读')) as call:
                    pending[-1][0]()
                    self.assertFalse(call.call_args.kwargs['infer'])
            finally:
                root.destroy()

    def test_auto_save_validates_and_invalidates_old_network_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, core.Store(directory))
                app.save()
                app.store.applied[app.current.id] = app.current.active_api
                app.vars['port'].set('invalid')
                app.auto_save()
                self.assertEqual(core.Store(directory).profiles[0].port, 22)
                self.assertIn('未保存', app.save_state.get())
                app.vars['port'].set('2222')
                app.auto_save()
                self.assertEqual(core.Store(directory).profiles[0].port, 2222)
                self.assertEqual(app.store.applied, {})
                self.assertEqual(app.save_state.get(), '已自动保存')
            finally:
                root.destroy()

    def test_using_last_api_can_be_deleted_and_added_again(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, core.Store(directory))
                entry_id = app.current.active_api
                app.store.applied[app.current.id] = entry_id
                app.render_api_cards()
                self.assertEqual(app.api_card_widgets[entry_id]['tools'].winfo_manager(), 'pack')
                with patch('workbench.app.messagebox.askyesno', return_value=True):
                    app.delete_api(entry_id)
                self.assertEqual(app.store.api_entries(app.current), [])
                self.assertEqual(app.current.active_api, '')
                self.assertEqual(app.store.applied, {})
                restored = core.Store(directory)
                self.assertEqual(restored.api_entries(restored.profiles[0]), [])
                app.save_api_entry(dict(id='b' * 32, name='New', base_url='https://example.com/v1',
                                        model='model-b', protocol='responses'), 'new-key', False)
                self.assertEqual(app.current.active_api, 'b' * 32)
                self.assertEqual(app.key_var.get(), 'new-key')
                self.assertEqual(app.store.applied, {})
            finally:
                root.destroy()

    def test_add_dialog_cancel_and_save_do_not_activate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, core.Store(directory))
                initial = app.current.active_api
                app.add_api()
                self.assertEqual(len(app.store.api_entries(app.current)), 1)
                self.assertTrue(app.api_dialog.editor_remember.get())
                app.api_dialog.destroy()
                app.add_api()
                dialog = app.api_dialog
                dialog.editor_values['name'].set('Second API')
                dialog.editor_values['model'].set('model-b')
                dialog.editor_values['key'].set('secret-b')
                dialog.editor_remember.set(True)
                dialog.commit()
                self.assertFalse(dialog.winfo_exists())
                self.assertEqual(len(app.store.api_entries(app.current)), 2)
                self.assertEqual(app.current.active_api, initial)
                self.assertEqual(app.store.applied, {})
            finally:
                root.destroy()

    def test_hover_and_enable_wait_for_remote_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, core.Store(directory))
                first = app.current.active_api
                second = 'b' * 32
                app.save_api_entry(dict(id=second, name='Second', base_url='https://example.com/v1',
                                        model='model-b', protocol='responses'), 'test-key', False)
                item = app.api_card_widgets[second]
                self.assertEqual(item['actions'].winfo_manager(), '')
                item['hover'](True)
                self.assertEqual(item['actions'].winfo_manager(), 'place')
                item['hover'](False)
                self.assertEqual(item['actions'].winfo_manager(), '')
                pending = []
                app.run = lambda label, task, done=None: pending.append((task, done))
                app.activate_api(second)
                self.assertEqual(app.current.active_api, first)
                self.assertEqual(app.store.applied, {})
                task, done = pending[-1]
                with patch.object(core.Board, 'call', side_effect=RuntimeError('SSH unavailable')):
                    with self.assertRaises(RuntimeError):
                        task()
                self.assertEqual(app.current.active_api, first)
                self.assertEqual(app.store.applied, {})
                with patch.object(core.Board, 'call', return_value=dict(auth='API Key')) as call:
                    done(task())
                    self.assertEqual(call.call_args.kwargs['service_id'], second)
                self.assertEqual(app.store.applied[app.current.id], second)
                self.assertEqual(app.current.active_api, second)
                self.assertEqual(app.api_card_widgets[second]['enable'].cget('text'), '使用中')
                self.assertEqual(app.api_card_widgets[second]['enable'].cget('state'), 'disabled')
                value = dict(app.api_entry(second), model='changed-model')
                app.save_api_entry(value, 'test-key', False)
                self.assertNotIn(app.current.id, app.store.applied)
            finally:
                root.destroy()

    def test_old_profile_keeps_its_key_and_board_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            store = core.Store(directory)
            profile = store.profiles[0]
            scope = store.scope(profile)
            value = dict(client_id=store.client_id, profiles=[dict(vars(profile))],
                         secrets={profile.id: core.protect('old-secret')})
            value['profiles'][0].pop('active_api')
            store.path.write_text(json.dumps(value), encoding='utf-8')
            restored = core.Store(directory)
            profile = restored.profiles[0]
            self.assertEqual(restored.key(profile), 'old-secret')
            self.assertEqual(restored.scope(profile), scope)
            self.assertEqual(restored.api_entries(profile)[0]['id'], profile.active_api)

    def test_reuse_rejects_other_service_even_at_same_url(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'launch.json').write_text(json.dumps(dict(key='other-key', service_id='first')))
            with patch.object(remote_agent, 'scope', return_value=root):
                with self.assertRaisesRegex(ValueError, '另一服务'):
                    remote_agent.configure_ide(dict(reuse=True, service_id='second', base_url='https://same.test/v1'))

    def test_gui_switch_roundtrip_keys_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, core.Store(directory))
                first = app.current.active_api
                app.api_name.set('Provider A')
                app.vars['base_url'].set('https://same.test/v1')
                app.vars['model'].set('model-a')
                app.key_var.set('key-a-private')
                app.remember.set(True)
                second = uuid.uuid4().hex
                app.save()
                app.save_api_entry(dict(id=second, name='New API', base_url='https://same.test/v1',
                                        model='', protocol='responses'), '', False)
                app.select_api(second)
                self.assertNotEqual(first, second)
                self.assertEqual(app.key_var.get(), '')
                app.api_name.set('Provider B')
                app.vars['base_url'].set('https://same.test/v1')
                app.vars['model'].set('model-b')
                app.key_var.set('key-b-private')
                app.remember.set(True)
                app.select_api(first)
                self.assertEqual(app.key_var.get(), 'key-a-private')
                self.assertEqual(app.vars['model'].get(), 'model-a')
                app.select_api(second)
                self.assertEqual(app.key_var.get(), 'key-b-private')
                app.save()
                restored = core.Store(directory)
                self.assertEqual(restored.key(restored.profiles[0]), 'key-b-private')
                self.assertNotIn('key-a-private', restored.path.read_text())
                self.assertNotIn('key-b-private', restored.path.read_text())
                with patch('workbench.app.messagebox.askyesno', return_value=True):
                    app.delete_api(second)
                self.assertEqual(app.current.active_api, first)
                self.assertEqual(app.key_var.get(), 'key-a-private')
                self.assertNotIn(second, app.store.secrets)
                self.assertEqual(len(app.store.api_entries(app.current)), 1)
            finally:
                root.destroy()


if __name__ == '__main__':
    unittest.main()
