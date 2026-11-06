import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from workbench.core import Board, Profile, Store, open_vscode
from workbench import remote_agent


class AuthTests(unittest.TestCase):
    def test_enrollment_creates_distinct_local_key_and_append_only_command(self):
        with tempfile.TemporaryDirectory() as folder:
            board = Board(Profile(), 'b' * 32)
            process = MagicMock()
            process.wait.return_value = 0
            with patch.object(Board, 'console', return_value=process) as console, patch.object(Board, 'call', return_value={}):
                key = board.enroll_ssh(folder)
            self.assertTrue(Path(key).exists())
            script = console.call_args.args[0]
            self.assertIn('>> ~/.ssh/authorized_keys', script)
            self.assertIn("printf '\\n%s\\n'", script)
            self.assertNotIn('88888888', script)

    def test_official_ide_ignores_api_protocol_and_key(self):
        with tempfile.TemporaryDirectory() as folder:
            board = MagicMock(profile=Profile(codex_auth='chatgpt', protocol='chat'))
            board.scope = 'b' * 32
            board.ssh.return_value = ['ssh']
            board.call.side_effect = [dict(flock=True, codex_extension=True), dict(cli='/private/launcher', message='等待账号授权')]
            with patch('workbench.vscode_server.prepare_server', return_value=dict(path='/private/server', ready=True, codex_extension=True)), patch('workbench.editor_runtime.editor_for', return_value=('Code.exe', 'cli.js', {}, 'a' * 40)), patch('workbench.core.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'ms-vscode-remote.remote-ssh\n', b'')):
                result = open_vscode(board, folder, api=dict(key='must-not-forward'))
            payload = board.call.call_args.kwargs
            self.assertEqual(payload['auth_mode'], 'chatgpt')
            self.assertNotIn('key', payload)
            self.assertNotIn('确认 API 登录', result)

    def test_official_launcher_removes_inherited_api_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'launch.json').write_text(json.dumps(dict(auth_mode='chatgpt', proxy='', key='do-not-use')))
            (root / 'ide-runtime.json').write_text(json.dumps(dict(binary=__file__)))
            captured = {}
            def execve(binary, args, env):
                captured.update(env)
            with patch.dict(os.environ, dict(OPENAI_API_KEY='inherited', OPENAI_BASE_URL='https://example.com', CODEX_ACCESS_TOKEN='inherited')):
                with patch('os.execve', side_effect=execve):
                    exec(compile(remote_agent.IDE_LAUNCHER, 'launcher', 'exec'), {'__file__': str(root / 'run-ide-codex')})
            self.assertNotIn('OPENAI_API_KEY', captured)
            self.assertNotIn('OPENAI_BASE_URL', captured)
            self.assertNotIn('CODEX_ACCESS_TOKEN', captured)
            self.assertEqual(captured['CODEX_HOME'], str(root.resolve() / 'codex-chatgpt-home'))

    def test_mode_survives_store_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(folder)
            store.profiles[0].codex_auth = 'chatgpt'
            store.save()
            self.assertEqual(Store(folder).profiles[0].codex_auth, 'chatgpt')

if __name__ == '__main__':
    unittest.main()
