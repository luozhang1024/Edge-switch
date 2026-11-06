import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from workbench.editor_runtime import editor_for, pin_editor


class EditorTests(unittest.TestCase):
    def test_existing_pin_ignores_changed_system_install(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            commit = 'a' * 40
            (directory / 'selected.json').write_text(json.dumps(dict(commit=commit)))
            expected = (directory / commit / 'Code.exe', 'cli.js', {}, commit)
            with patch('workbench.editor_runtime.inspect_editor', return_value=expected), \
                 patch('workbench.editor_runtime.seed_extensions'), patch('repair.find_code') as system:
                self.assertEqual(editor_for(directory), expected)
            system.assert_not_called()

    def test_snapshot_excludes_portable_credentials_and_uninstaller(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            source = base / 'installed'
            source.mkdir()
            (source / 'Code.exe').write_bytes(b'code')
            (source / 'unins000.exe').write_bytes(b'uninstaller')
            (source / '.env').write_text('secret')
            cli = source / 'version/resources/app/out/cli.js'
            cli.parent.mkdir(parents=True)
            cli.write_text('cli')
            (source / 'data').mkdir()
            (source / 'data/auth.json').write_text('credential')
            commit = 'a' * 40
            def inspect(executable):
                return Path(executable), Path(executable).parent / 'version/resources/app/out/cli.js', {}, commit
            with patch('repair.find_code', return_value=(source / 'Code.exe', cli, {}, commit)), \
                 patch('workbench.editor_runtime.inspect_editor', side_effect=inspect), \
                 patch('workbench.editor_runtime.seed_extensions'):
                pin_editor(base / 'managed')
            target = base / 'managed' / commit
            self.assertTrue((target / 'Code.exe').exists())
            self.assertTrue((target / 'version/resources/app/out/cli.js').exists())
            self.assertFalse((target / 'data').exists())
            self.assertFalse((target / 'unins000.exe').exists())
            self.assertFalse((target / '.env').exists())

    def test_failed_snapshot_keeps_previous_selection(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            old = json.dumps(dict(commit='a' * 40))
            (directory / 'selected.json').write_text(old)
            with patch('workbench.editor_runtime.inspect_editor', side_effect=RuntimeError('invalid')):
                with self.assertRaises(RuntimeError):
                    pin_editor(directory, executable=directory / 'bad/Code.exe')
            self.assertEqual((directory / 'selected.json').read_text(), old)


if __name__ == '__main__':
    unittest.main()
