import json
import tempfile
import unittest
from pathlib import Path
from workbench.extra_tools import kimi_inventory, manage_kimi
from workbench.remote_agent import private_write, clean_env, TOOL_PACKAGES


class ExtraToolsTests(unittest.TestCase):
    def test_kimi_uses_private_uv_environment_and_preserves_other_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'uv').mkdir()
            (root / 'uv/uv').touch()
            (root / 'bin').mkdir()
            (root / 'bin/kimi').touch()
            calls = []

            def command(args, env=None, timeout=0):
                calls.append((args, env))
                return 'kimi 1.52.0'

            manage_kimi(dict(operation='install', proxy='http://127.0.0.1:7890'), root,
                        command, clean_env, private_write)
            info = kimi_inventory(root)
            self.assertTrue(info['installed'])
            self.assertTrue(info['managed'])
            self.assertEqual(calls[0][1]['UV_TOOL_DIR'], str(root / 'uv-tools'))
            self.assertEqual(calls[0][1]['HTTPS_PROXY'], 'http://127.0.0.1:7890')
            self.assertIn('--python', calls[0][0])
            manage_kimi(dict(operation='uninstall'), root, command, clean_env, private_write)
            self.assertFalse((root / 'tools/kimi/current.json').exists())
            self.assertTrue((root / 'uv/uv').exists())

    def test_extra_npm_agents_have_distinct_packages_and_reject_unowned_uninstall(self):
        self.assertEqual(TOOL_PACKAGES['grok'][0], '@vibe-kit/grok-cli')
        self.assertEqual(TOOL_PACKAGES['copilot'][0], '@github/copilot')
        self.assertEqual(TOOL_PACKAGES['qwen'][0], '@qwen-code/qwen-code')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                manage_kimi(dict(operation='uninstall'), Path(directory), lambda *args, **kwargs: None,
                            clean_env, private_write)
