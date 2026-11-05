from dataclasses import replace
import tempfile
import tkinter as tk
import unittest
from unittest.mock import MagicMock, patch
from workbench.app import App
from workbench.core import Profile, Store


class EnvironmentTests(unittest.TestCase):
    def test_switch_preserves_services_network_and_live_connections(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, Store(directory))
                first = app.current.id
                app.vars['harness_proxy'].set(True)
                app.api_name.set('First API')
                app.key_var.set('first-private-key')
                app.save()
                session = MagicMock()
                app.sessions[first] = session
                second = Profile(name='Second board', host='192.168.0.169', project='/home/FineHigh')
                app.save_environment(second)
                self.assertEqual(app.current.id, first)
                app.use_environment(second.id)
                self.assertEqual(app.vars['host'].get(), '192.168.0.169')
                self.assertEqual(app.key_var.get(), '')
                self.assertFalse(app.vars['harness_proxy'].get())
                app.use_environment(first)
                self.assertEqual(app.api_name.get(), 'First API')
                self.assertEqual(app.key_var.get(), 'first-private-key')
                self.assertTrue(app.vars['harness_proxy'].get())
                session.close.assert_not_called()
                self.assertEqual(Store(directory).selected_profile, first)
                with self.assertRaises(ValueError):
                    app.save_environment(replace(app.current, host='192.168.0.170'))
                app.sessions.clear()
                with patch('workbench.environment_ui.messagebox.askyesno', return_value=True):
                    app.delete_environment(second.id)
                self.assertEqual(len(app.store.profiles), 1)
            finally:
                root.destroy()

    def test_environment_modal_cancel_save_and_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = tk.Tk()
            root.withdraw()
            try:
                app = App(root, Store(directory))
                first = app.current.id
                app.new()
                app.environment_dialog.destroy()
                self.assertEqual(len(app.store.profiles), 1)
                app.new()
                dialog = app.environment_dialog
                dialog.editor_values['name'].set('New board')
                dialog.editor_values['host'].set('192.168.0.169')
                dialog.commit()
                self.assertEqual(len(app.store.profiles), 2)
                self.assertEqual(app.current.id, first)
                second = app.store.profiles[1].id
                app.open_environment_editor(second)
                dialog = app.environment_dialog
                dialog.editor_values['project'].set('/tmp')
                dialog.commit()
                app.use_environment(second)
                self.assertEqual(app.vars['project'].get(), '/tmp')
                restored = Store(directory)
                self.assertEqual(restored.selected_profile, second)
                self.assertEqual(restored.profiles[1].project, '/tmp')
            finally:
                root.destroy()


if __name__ == '__main__':
    unittest.main()
