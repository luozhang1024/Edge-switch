import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from workbench.remote_agent import prompt_file


class PromptTests(unittest.TestCase):
    def test_managed_targets_and_native_files_stay_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch('workbench.remote_agent.scope', return_value=root):
                expected = {
                    'codex': 'codex-home/AGENTS.md',
                    'claude': 'claude-home/CLAUDE.md',
                    'gemini': 'gemini-home/.gemini/GEMINI.md',
                    'harness': 'harness-home/AGENTS.md',
                    'opencode': 'opencode-home/config/opencode/AGENTS.md',
                }
                for tool, relative in expected.items():
                    result = prompt_file(dict(tool=tool, official=False))
                    self.assertEqual(Path(result['path']), root / relative)
                    self.assertEqual(result['revision'], 'missing')
                    changed = prompt_file(dict(tool=tool, official=False, expected='missing', content='Instructions'))
                    self.assertEqual(changed['content'], 'Instructions')
                official = prompt_file(dict(tool='codex', official=True))
                self.assertEqual(official['revision'], 'missing')
                self.assertEqual(Path(official['path']), root / 'codex-chatgpt-home/AGENTS.md')
                with self.assertRaises(ValueError):
                    prompt_file(dict(tool='../auth.json'))

    def test_external_edits_are_not_overwritten_and_backups_survive_disable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'codex-home/AGENTS.md'
            target.parent.mkdir()
            target.write_text('Original', encoding='utf-8')
            with patch('workbench.remote_agent.scope', return_value=root):
                current = prompt_file(dict(tool='codex'))
                target.write_text('External', encoding='utf-8')
                with self.assertRaises(ValueError):
                    prompt_file(dict(tool='codex', expected=current['revision'], content='Replacement'))
                self.assertEqual(target.read_text(encoding='utf-8'), 'External')
                current = prompt_file(dict(tool='codex'))
                prompt_file(dict(tool='codex', expected=current['revision'], content=''))
                self.assertEqual(target.read_text(encoding='utf-8'), '')
                self.assertEqual(next(target.parent.glob('*.bak')).read_text(encoding='utf-8'), 'External')


if __name__ == '__main__':
    unittest.main()
