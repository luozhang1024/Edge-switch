from dataclasses import replace
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from workbench.app import App
from workbench.core import Profile, PersistentHarness


class ReopenTests(unittest.TestCase):
    def controller(self, project='/project'):
        app = App.__new__(App)
        board = MagicMock()
        board.profile = Profile(project=project)
        app.board = lambda: board
        app.sessions, app.tunnels = {}, {}
        app.log = MagicMock()
        app.proxy_url = MagicMock(return_value='')
        app.run = lambda label, task, done=None: done(task())
        return app, board

    def test_reopen_browser_reuses_running_service_without_start(self):
        app, board = self.controller()
        old = MagicMock(alive=True, remote_pid=42, url='http://localhost/private')
        app.sessions[board.profile.id] = old
        board.call.return_value = dict(running=True, project='/project', proxy='', pid=42)
        with patch('workbench.app.webbrowser.open') as browser:
            app.harness()
            browser.assert_called_once_with(old.url)
        self.assertEqual([c.args[0] for c in board.call.call_args_list], ['harness_status'])
        old.detach.assert_not_called()

    def test_conflict_cancel_does_not_stop_or_start(self):
        app, board = self.controller('/new')
        board.call.return_value = dict(running=True, project='/old', proxy='', pid=42)
        with patch('workbench.app.messagebox.askyesnocancel', return_value=None), \
                patch('workbench.app.webbrowser.open') as browser:
            app.harness()
            browser.assert_not_called()
        self.assertEqual([c.args[0] for c in board.call.call_args_list], ['harness_status'])

    def test_conflict_can_attach_without_reconfiguring(self):
        app, board = self.controller('/new')
        info = dict(running=True, project='/old', proxy='', pid=42)
        board.call.return_value = info
        with patch('workbench.app.messagebox.askyesnocancel', return_value=True), \
                patch('workbench.app.PersistentHarness') as session, patch('workbench.app.webbrowser.open'):
            app.harness()
            self.assertEqual(session.call_args.kwargs['existing'], info)
        self.assertNotIn('harness_stop', [c.args[0] for c in board.call.call_args_list])

    def test_restart_only_after_explicit_choice(self):
        app, board = self.controller('/new')
        info = dict(running=True, project='/old', proxy='', pid=42)
        board.call.return_value = info
        with patch('workbench.app.messagebox.askyesnocancel', return_value=False), \
                patch('workbench.app.PersistentHarness') as session, patch('workbench.app.webbrowser.open'):
            app.harness()
            self.assertNotIn('existing', session.call_args.kwargs)
        self.assertIn('harness_stop', [c.args[0] for c in board.call.call_args_list])

    def test_existing_constructor_does_not_start_another_service(self):
        board = MagicMock(profile=Profile())
        info = dict(local_port=42001, port=42002, pid=42, token='hidden', background=True, proxy='')
        with patch('workbench.core.LocalForward'), patch.object(PersistentHarness, '_wait_ready'), \
                patch('workbench.core.threading.Thread'):
            session = PersistentHarness(board, existing=info)
        board.call.assert_not_called()
        self.assertEqual(session.remote_pid, 42)


if __name__ == '__main__':
    unittest.main()
