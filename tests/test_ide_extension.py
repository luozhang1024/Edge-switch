import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from workbench import remote_agent


class ExtensionTests(unittest.TestCase):
    def fixture(self, home):
        p = dict(scope='b' * 32, commit='a' * 40)
        root = home / '.local/share/edge-ssh-ai' / p['scope'] / '.vscode-server'
        server = root / 'bin' / p['commit'] / 'bin/code-server'
        server.parent.mkdir(parents=True)
        server.touch()
        return p, root

    def extension(self, root, arch='linux-aarch64'):
        package = root / 'openai.chatgpt-1.0.0'
        binary = package / 'bin' / arch / 'codex'
        binary.parent.mkdir(parents=True)
        binary.touch()
        binary.chmod(0o700)
        (package / 'package.json').write_text(json.dumps(dict(publisher='openai', name='chatgpt', version='1.0.0')))
        return package

    def test_existing_board_extension_is_copied_and_registered_in_private_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            p, root = self.fixture(home)
            source = self.extension(home / '.vscode-server/extensions')
            (home / '.vscode-server/data').mkdir()
            (home / '.vscode-server/data/auth.json').write_text('never-copy')
            def command(args, **kwargs):
                return 'openai.chatgpt' if '--list-extensions' in args else 'codex 1.0.0'
            with patch.object(Path, 'home', return_value=home), \
                 patch.object(remote_agent.platform, 'machine', return_value='aarch64'), \
                 patch.dict(sys.modules, fcntl=SimpleNamespace(flock=Mock(), LOCK_EX=1, LOCK_NB=2)), \
                 patch.object(remote_agent, 'command', side_effect=command) as run:
                result = remote_agent.prepare_ide(p)
            self.assertTrue(result['ready'] and result['reused'])
            self.assertTrue((root / 'extensions' / source.name / 'bin/linux-aarch64/codex').exists())
            self.assertFalse((root / 'data/auth.json').exists())
            self.assertFalse(any('--install-extension' in call.args[0] for call in run.call_args_list))
            self.assertTrue(any(str(root / 'extensions') in call.args[0] for call in run.call_args_list))

    def test_success_exit_without_remote_extension_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            p, root = self.fixture(home)
            with patch.object(Path, 'home', return_value=home), \
                 patch.object(remote_agent.platform, 'machine', return_value='aarch64'), \
                 patch.dict(sys.modules, fcntl=SimpleNamespace(flock=Mock(), LOCK_EX=1, LOCK_NB=2)), \
                 patch.object(remote_agent, 'command', return_value=''):
                with self.assertRaisesRegex(RuntimeError, '未声明安装成功'):
                    remote_agent.prepare_ide(p)

    def test_wrong_architecture_or_manifest_not_counted_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.extension(root, 'linux-x86_64')
            with patch.object(remote_agent.platform, 'machine', return_value='aarch64'):
                self.assertEqual(remote_agent.ide_candidates(root), [])
            package = self.extension(root / 'another')
            (package / 'package.json').write_text('{"publisher":"other","name":"chatgpt"}')
            with patch.object(remote_agent.platform, 'machine', return_value='aarch64'):
                self.assertEqual(remote_agent.ide_candidates(root / 'another'), [])


if __name__ == '__main__':
    unittest.main()
