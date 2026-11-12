import tempfile
import unittest
from pathlib import Path
from workbench.sessions import session_files


class SessionTests(unittest.TestCase):
    def test_scope_boundaries_and_bounded_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sessions = root / 'codex-home/sessions'
            sessions.mkdir(parents=True)
            (sessions / 'test.jsonl').write_text('x' * 8192)
            (root / 'auth.json').write_text('secret')
            listing = session_files(root, {})
            self.assertEqual(len(listing['files']), 1)
            self.assertTrue(listing['files'][0]['truncated'])
            key = listing['files'][0]['key']
            detail = session_files(root, {'key': key})
            self.assertEqual(len(detail['files'][0]['text']), 8192)
            self.assertFalse(detail['files'][0]['truncated'])
            with self.assertRaises(ValueError):
                session_files(root, {'key': '0/../auth.json'})

    def test_other_managed_environments_are_not_scanned(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for name in ('one', 'two'):
                sessions = base / name / 'claude-home/projects/project'
                sessions.mkdir(parents=True)
                (sessions / (name + '.jsonl')).write_text('{}')
            result = session_files(base / 'one', {})
            self.assertEqual(len(result['files']), 1)
            self.assertIn('one.jsonl', result['files'][0]['key'])


if __name__ == '__main__':
    unittest.main()
