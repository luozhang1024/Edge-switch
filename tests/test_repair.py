"""Focused tests for settings preservation and download integrity decisions."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from jsonc_utils import jsonc_spans, patch_jsonc
import repair


class SettingsTests(unittest.TestCase):
    def test_comments_nested_strings_and_trailing_comma_survive(self):
        source = '''{
// user's comment
"remote.SSH.useFlock": false,
"nested": {"url": "https://example.com/a//b", "quote": "\\\"}"},
"items": [1, {"x": 2}], /* keep this */
}'''
        fixed = patch_jsonc(source, {'remote.SSH.useFlock': True, 'remote.SSH.localServerDownload': 'auto'})
        spans, _ = jsonc_spans(fixed)
        self.assertEqual(json.loads(fixed[slice(*spans['remote.SSH.useFlock'])]), True)
        self.assertEqual(json.loads(fixed[slice(*spans['remote.SSH.localServerDownload'])]), 'auto')
        for text in ["// user's comment", '/* keep this */', '"items": [1, {"x": 2}]']:
            self.assertIn(text, fixed)
        self.assertEqual(patch_jsonc(fixed, {'remote.SSH.useFlock': True,
                                          'remote.SSH.localServerDownload': 'auto'}), fixed)

    def test_empty_and_no_trailing_comma(self):
        for source in ['{}', '{/* hi */}', '{"nested":{"x":1}}', '{"x":1 /* hi */}']:
            fixed = patch_jsonc(source, {'hello': 'world'})
            spans, _ = jsonc_spans(fixed)
            self.assertEqual(json.loads(fixed[slice(*spans['hello'])]), 'world')

    def test_duplicate_keys_rejected(self):
        with self.assertRaises(ValueError):
            patch_jsonc('{"a":1,"a":2}', {'a': 3})

    def test_backup_exact_original(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / 'settings.json'
            old = b'\xef\xbb\xbf{\r\n  "x": 1\r\n}\r\n'
            p.write_bytes(old)
            repair.write_backup(p, '{"x":2}')
            backups = list(p.parent.glob('*.backup-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), old)


class DownloadTests(unittest.TestCase):
    def test_verified_cache_skips_transfer(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            archive = cache / ('a' * 40 + '-arm64.tar.gz')
            archive.write_bytes(b'verified test data')
            digest = repair.sha256(archive)
            with patch.object(repair, 'CACHE', cache), patch.object(repair, 'metadata', return_value=(
                    'https://example.com/server', archive.stat().st_size, digest)), patch.object(repair, 'run') as run:
                result, expected = repair.download('curl', 'a' * 40)
                self.assertEqual((result, expected), (archive, digest))
                run.assert_not_called()

    def test_bad_hash_never_promoted_to_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            cache = Path(temp)
            def fake_run(args, **kwargs):
                path = Path(args[args.index('-o') + 1])
                path.write_bytes(b'bad')
                return ''
            with patch.object(repair, 'CACHE', cache), patch.object(repair, 'metadata', return_value=(
                    'https://example.com/server', 3, '0' * 64)), patch.object(repair, 'run', side_effect=fake_run):
                with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
                    repair.download('curl', 'a' * 40)
                self.assertFalse((cache / ('a' * 40 + '-arm64.tar.gz')).exists())


if __name__ == '__main__':
    unittest.main()
