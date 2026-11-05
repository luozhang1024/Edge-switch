import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from workbench.remote_agent import discover_tools, reuse_tools
from workbench.core import vscode_connection_report


class SharedToolTests(unittest.TestCase):
    def fixture(self, directory):
        shared = Path(directory)
        owner, colleague = shared / 'owner', shared / 'colleague'
        (owner / 'runtime/bin').mkdir(parents=True)
        (owner / 'runtime/bin/node').touch()
        binary = owner / 'tools/codex/1.2.3/codex'
        binary.parent.mkdir(parents=True)
        binary.touch()
        binary.chmod(0o700)
        (owner / 'tools/codex/current.json').write_text(json.dumps(dict(version='1.2.3', binary=str(binary))))
        return owner, colleague, binary

    def test_new_computer_discovers_other_environment_without_reading_auth(self):
        with tempfile.TemporaryDirectory() as folder:
            owner, colleague, binary = self.fixture(folder)
            (owner / 'auth.json').write_text('do-not-read')
            with patch('workbench.remote_agent.shutil.which', return_value=None):
                result = discover_tools(colleague)
            self.assertEqual(result['tools']['codex']['source'], 'other_environment')
            self.assertEqual(result['tools']['codex']['version'], '1.2.3')
            self.assertFalse(colleague.exists())
            self.assertNotIn('do-not-read', str(result))

    def test_stale_marker_not_reported_installed(self):
        with tempfile.TemporaryDirectory() as folder:
            owner, colleague, binary = self.fixture(folder)
            binary.unlink()
            with patch('workbench.remote_agent.shutil.which', return_value=None):
                self.assertIsNone(discover_tools(colleague)['tools']['codex'])

    def test_reuse_writes_only_local_metadata_and_isolated_env(self):
        with tempfile.TemporaryDirectory() as folder:
            owner, colleague, binary = self.fixture(folder)
            (colleague / 'runtime/bin').mkdir(parents=True)
            (colleague / 'runtime/bin/node').touch()
            original = (owner / 'tools/codex/current.json').read_bytes()
            with patch('workbench.remote_agent.scope', return_value=colleague), \
                 patch('workbench.remote_agent.command', return_value='codex-cli 1.2.3') as command:
                reuse_tools(dict(tools=['codex']))
            self.assertEqual(command.call_args.kwargs['env']['CODEX_HOME'], str(colleague / 'codex-home'))
            self.assertTrue((colleague / 'tools/codex/current.json').exists())
            self.assertFalse((colleague / 'auth.json').exists())
            self.assertEqual((owner / 'tools/codex/current.json').read_bytes(), original)

    def test_version_validation_failure_does_not_mark_tool_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            owner, colleague, binary = self.fixture(folder)
            (colleague / 'runtime/bin').mkdir(parents=True)
            (colleague / 'runtime/bin/node').touch()
            with patch('workbench.remote_agent.scope', return_value=colleague), \
                 patch('workbench.remote_agent.command', side_effect=RuntimeError('incompatible')):
                with self.assertRaises(RuntimeError):
                    reuse_tools(dict(tools=['codex']))
            self.assertFalse((colleague / 'tools/codex/current.json').exists())


class VscodeReportTests(unittest.TestCase):
    def test_no_logs_is_actionable(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIn('尚未找到', vscode_connection_report(folder)['message'])

    def test_reports_phase_without_exposing_raw_tokens(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'logs/now/window1/exthost/output_logging_1/Remote - SSH.log'
            log.parent.mkdir(parents=True)
            log.write_text('secret-token\nPermission denied (publickey,password)', encoding='utf-8')
            result = vscode_connection_report(folder)
            self.assertIn('身份验证', result['message'])
            self.assertNotIn('secret-token', str(result))


if __name__ == '__main__':
    unittest.main()
