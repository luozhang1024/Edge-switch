"""Native Harness credential transfer protects concurrent writes and API selection."""
import hashlib
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from workbench import remote_agent as agent


class HarnessAccountTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.scope = patch.object(agent, 'scope', return_value=self.root)
        self.scope.start()
        self.addCleanup(self.scope.stop)
        self.service = patch.object(agent, 'service_module')
        self.mock = self.service.start()
        self.mock.return_value.status.return_value = dict(running=False)
        self.addCleanup(self.service.stop)

    def test_cas_and_native_lock_preserve_existing_credentials(self):
        path = self.root / 'harness-home/.credentials.yaml'
        old = 'version: 1\nrefs: {other: keep}\n'
        agent.private_write(path, old)
        data = agent.harness_account_read({})
        self.assertEqual(data['hash'], hashlib.sha256(old.encode()).hexdigest())
        path.write_text('changed', encoding='utf-8')
        with self.assertRaises(ValueError):
            agent.harness_account_write(dict(expected_hash=data['hash'], credentials='new'))
        self.assertEqual(path.read_text(), 'changed')
        lock = path.with_name(path.name + '.lock')
        lock.write_text('existing')
        with self.assertRaises(ValueError):
            agent.harness_account_write(dict(expected_hash=data['hash'], credentials='new'))
        self.assertEqual(lock.read_text(), 'existing')

    def test_native_account_switch_removes_only_managed_api_override(self):
        agent.private_write(self.root / 'harness-api.json', '{}')
        agent.private_write(self.root / 'harness-provider.patch.yml', '[]')
        agent.private_write(self.root / 'harness-home/profiles/web/cordis.patch.yml', 'native')
        data = agent.harness_account_read({})
        payload = 'version: 1\nrecords: {account: private-token}\n'
        result = agent.harness_account_write(dict(expected_hash=data['hash'], credentials=payload))
        self.assertNotIn('private-token', str(result))
        self.assertFalse((self.root / 'harness-api.json').exists())
        self.assertFalse((self.root / 'harness-provider.patch.yml').exists())
        self.assertEqual((self.root / 'harness-home/profiles/web/cordis.patch.yml').read_text(), 'native')
        self.assertEqual((self.root / 'harness-home/.credentials.yaml').read_text(), payload)

    def test_running_harness_refuses_account_switch(self):
        self.mock.return_value.status.return_value = dict(running=True)
        with self.assertRaises(ValueError):
            agent.harness_account_write(dict(expected_hash='', credentials='new'))
        self.assertFalse((self.root / 'harness-home/.credentials.yaml').exists())


if __name__ == '__main__':
    unittest.main()
