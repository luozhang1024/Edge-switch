"""Tool API adapters: no paid model calls, no board or user configuration access."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from workbench import remote_agent as agent


class ProviderToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.payload = dict(scope='a' * 32, project=str(self.root), service_id='b' * 32,
                            base_url='https://api.example.com/v1', model='test-model',
                            protocol='responses', key='private-test-key', proxy='')
        self.scope = patch.object(agent, 'scope', return_value=self.root)
        self.scope.start()
        self.addCleanup(self.scope.stop)
        for tool in ('claude', 'gemini', 'opencode', 'harness'):
            agent.private_write(self.root / 'tools' / tool / 'current.json', json.dumps(dict(binary='/fake/' + tool, version='0.2.2')))

    def configure(self, tool, protocol):
        p = dict(self.payload, tool=tool, protocol=protocol)
        with patch.object(agent, 'service_module') as module, patch.object(agent, 'command', return_value='llm-pi-ai'):
            module.return_value.status.return_value = dict(running=False)
            result = agent.configure_tool(p)
        return p, result

    def test_harness_openai_patch_and_credentials_are_separate_from_codex(self):
        agent.private_write(self.root / 'launch.json', '{"key":"codex-key"}')
        original = (self.root / 'launch.json').read_bytes()
        p, result = self.configure('harness', 'responses')
        patch_data = json.loads((self.root / 'harness-provider.patch.yml').read_text())
        route = patch_data[0]['config']['providers']['edge-workbench']
        self.assertEqual(route['api'], 'openai-responses')
        self.assertEqual(route['apiKeyEnv'], 'EDGE_MODEL_API_KEY')
        self.assertEqual(patch_data[1]['config']['provider'], 'edge-workbench')
        self.assertNotIn(p['key'], json.dumps(patch_data))
        self.assertEqual((self.root / 'launch.json').read_bytes(), original)
        self.assertNotIn(p['key'], json.dumps(result))
        self.assertEqual(json.loads((self.root / 'harness-api.json').read_text())['key'], p['key'])

    def test_harness_deepseek_uses_chat_completions(self):
        self.configure('harness', 'chat')
        doc = json.loads((self.root / 'harness-provider.patch.yml').read_text())
        self.assertEqual(doc[0]['config']['providers']['edge-workbench']['api'], 'openai-completions')

    def test_harness_running_rejects_changes_but_allows_reattach(self):
        p, _ = self.configure('harness', 'responses')
        with patch.object(agent, 'service_module') as module:
            module.return_value.status.return_value = dict(running=True)
            self.assertIn('保留', agent.configure_tool(p)['message'])
            with self.assertRaisesRegex(ValueError, '先停止'):
                agent.configure_tool(dict(p, model='different-model'))
        self.assertEqual(json.loads((self.root / 'harness-api.json').read_text())['model'], 'test-model')

    def test_harness_old_version_keeps_previous_files(self):
        agent.private_write(self.root / 'tools/harness/current.json', json.dumps(dict(binary='/fake/dsh', version='0.2.1')))
        with patch.object(agent, 'service_module') as module:
            module.return_value.status.return_value = dict(running=False)
            with self.assertRaisesRegex(ValueError, '0.2.2'):
                agent.configure_tool(dict(self.payload, tool='harness'))
        self.assertFalse((self.root / 'harness-api.json').exists())

    def test_cross_tool_and_cross_service_credential_reuse_is_rejected(self):
        p, _ = self.configure('opencode', 'responses')
        with self.assertRaisesRegex(ValueError, '不能复用'):
            agent.tool_credentials(dict(p, service_id='c' * 32, reuse=True))
        with self.assertRaisesRegex(ValueError, 'API Key'):
            agent.tool_credentials(dict(p, tool='claude', reuse=True))
        recovered = agent.tool_credentials(dict(p, key='', reuse=True))
        self.assertEqual(recovered['key'], self.payload['key'])

    def test_claude_rejects_openai_protocol_before_writing(self):
        with self.assertRaisesRegex(ValueError, '协议'):
            agent.configure_tool(dict(self.payload, tool='claude'))
        self.assertFalse((self.root / 'claude-api.json').exists())

    def test_opencode_protocol_specific_sdk_and_no_embedded_key(self):
        for protocol, sdk in [('chat', 'openai-compatible'), ('responses', 'openai'), ('anthropic', 'anthropic'), ('gemini', 'google')]:
            self.configure('opencode', protocol)
            config = json.loads((self.root / 'opencode-config.json').read_text())
            self.assertEqual(config['provider']['edge-workbench']['npm'], '@ai-sdk/' + sdk)
            self.assertNotIn(self.payload['key'], json.dumps(config))

    def test_tool_launchers_use_private_homes_and_selected_model(self):
        for tool, protocol, expected in [('claude', 'anthropic', 'CLAUDE_CONFIG_DIR'), ('gemini', 'gemini', 'GEMINI_CLI_HOME'), ('opencode', 'chat', 'XDG_CONFIG_HOME')]:
            self.configure(tool, protocol)
            script = self.root / ('run-' + tool + '.py')
            inherited = dict(os.environ, OPENAI_API_KEY='foreign-key', ANTHROPIC_AUTH_TOKEN='foreign-token')
            with patch.dict(os.environ, inherited, clear=True), patch('os.execvpe') as execute, patch('os.chdir'):
                exec(compile(script.read_text(), str(script), 'exec'), {'__file__': str(script)})
            binary, args, env = execute.call_args.args
            self.assertIn(expected, env)
            self.assertNotIn('OPENAI_API_KEY', env)
            self.assertNotIn('ANTHROPIC_AUTH_TOKEN', env)
            self.assertIn('test-model', ' '.join(args))
            self.assertEqual(Path(env[expected]).resolve().relative_to(self.root.resolve()).parts[0], {"claude": "claude-home", "gemini": "gemini-home", "opencode": "opencode-home"}[tool])
            if tool == 'gemini':
                self.assertEqual(env['GOOGLE_GEMINI_BASE_URL'], 'https://api.example.com')

    def test_native_api_tests_use_native_headers_and_routes(self):
        cases = [('anthropic', 'https://api.example.com/v1/messages', 'X-api-key', {'content': [{'type': 'text', 'text': 'OK'}]}),
                 ('gemini', 'https://api.example.com/v1/models/test-model:generateContent', 'X-goog-api-key', {'candidates': [{'content': {'parts': [{'text': 'OK'}]}}]})]
        for protocol, url, header, body in cases:
            response = MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps(body).encode()
            with patch.object(agent.urllib.request, 'build_opener') as opener:
                opener.return_value.open.return_value = response
                result = agent.api_test(dict(self.payload, protocol=protocol, infer=True))
                request = opener.return_value.open.call_args.args[0]
            self.assertTrue(result['ok'])
            self.assertEqual(request.full_url, url)
            self.assertEqual(request.get_header(header), self.payload['key'])
            self.assertNotIn(self.payload['key'], request.full_url)
            self.assertIsNone(request.get_header('Authorization'))


if __name__ == '__main__':
    unittest.main()
