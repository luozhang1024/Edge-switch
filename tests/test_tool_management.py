import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from workbench.remote_agent import tool_inventory, uninstall_tool


class ToolManagementTests(unittest.TestCase):
    def test_inventory_and_uninstall_preserve_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'workspace'
            tool = root / 'tools/codex'
            binary = tool / '1.0.0/bin/codex'
            binary.parent.mkdir(parents=True)
            binary.write_text('binary')
            (tool / 'current.json').write_text(json.dumps(dict(binary=str(binary), version='1.0.0')))
            config = root / 'codex-home/AGENTS.md'
            config.parent.mkdir()
            config.write_text('Keep instructions')
            with patch('workbench.remote_agent.scope', return_value=root), patch('workbench.remote_agent.shutil.which', return_value=None):
                info = tool_inventory({})['tools'][0]
                self.assertTrue(info['installed'])
                self.assertEqual(info['version'], '1.0.0')
                uninstall_tool(dict(tool='codex'))
                self.assertFalse(tool.exists())
                self.assertEqual(config.read_text(), 'Keep instructions')
                with self.assertRaises(ValueError):
                    uninstall_tool(dict(tool='../codex-home'))

    def test_shared_binary_is_not_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'workspace'
            tool = root / 'tools/codex'
            tool.mkdir(parents=True)
            binary = tool / 'binary'
            binary.write_text('binary')
            record = json.dumps(dict(binary=str(binary), version='1.0.0'))
            (tool / 'current.json').write_text(record)
            other = Path(directory) / 'other/tools/codex/current.json'
            other.parent.mkdir(parents=True)
            other.write_text(record)
            with patch('workbench.remote_agent.scope', return_value=root):
                uninstall_tool(dict(tool='codex'))
            self.assertTrue(binary.exists())
            self.assertTrue(other.exists())
            self.assertFalse((tool / 'current.json').exists())


if __name__ == '__main__':
    unittest.main()
