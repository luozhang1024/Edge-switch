import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from workbench.extra_tools import kimi_inventory, manage_kimi, configure_extra, EXTRA_LAUNCHER, official_config
from workbench.remote_agent import private_write, clean_env, TOOL_PACKAGES


class ExtraToolsTests(unittest.TestCase):
    def test_extra_model_configuration_and_real_launcher_preserve_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for tool in ('kimi','grok','qwen'):
                private_write(root / ('tools/'+tool+'/current.json'),json.dumps({'binary':'fixture-'+tool}))
                configure_extra(dict(tool=tool,official=False,base_url='https://gateway.example/v1',model='fixture-model',key='fixture-key',protocol='anthropic'),root,private_write)
                if tool=='kimi':
                    private_write(root/'extra-kimi/AGENTS.md','Follow fixture instructions')
                if tool=='grok':
                    private_write(root/'extra-grok/.grok/GROK.md','Keep existing instructions')
                    private_write(root/'extra-grok/.grok/skills/sample/SKILL.md','Skill fixture content')
                with patch('sys.argv',['run-extra.py',tool,'http://127.0.0.1:7890']),patch('os.execvpe') as launch:
                    exec(compile(EXTRA_LAUNCHER,'run-extra.py','exec'),{'__file__':str(root/'run-extra.py')})
                binary,args,env=launch.call_args.args
                self.assertEqual(binary,'fixture-'+tool)
                self.assertEqual(env['HTTPS_PROXY'],'http://127.0.0.1:7890')
                if tool=='kimi':
                    self.assertIn('--config-file',args)
                    self.assertIn('--agent-file',args)
                    self.assertIn('Follow fixture instructions',(root/'extra-kimi/edge-agent.json').read_text())
                elif tool=='grok':
                    self.assertEqual(env['GROK_API_KEY'],'fixture-key')
                    self.assertIn('Keep existing instructions',(root/'extra-grok/.grok/GROK.md').read_text())
                    self.assertIn('Skill fixture content',(root/'extra-grok/.grok/GROK.md').read_text())
                else:
                    self.assertEqual(env['EDGE_QWEN_API_KEY'],'fixture-key')
                    settings=json.loads((root/'extra-qwen/.qwen/settings.json').read_text())
                    self.assertEqual(settings['modelProviders']['openai'][0]['baseUrl'],'https://gateway.example/v1')
                    configure_extra(dict(tool='qwen',official=True),root,private_write)
                    settings=json.loads((root/'extra-qwen/.qwen/settings.json').read_text())
                    self.assertEqual(settings['security']['auth']['selectedType'],'qwen-oauth')

    def test_official_config_detects_external_edits_and_keeps_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            request=dict(tool='claude',operation='read')
            read=official_config(request,root,private_write)
            official_config(dict(request,operation='write',expected=read['revision'],config='{"permissions":{}}'),root,private_write)
            with self.assertRaises(ValueError):
                official_config(dict(request,operation='write',expected=read['revision'],config='{}'),root,private_write)
            read=official_config(request,root,private_write)
            official_config(dict(request,operation='write',expected=read['revision'],config='{}'),root,private_write)
            self.assertTrue(list((root/'claude-official-home').glob('*.bak')))
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
