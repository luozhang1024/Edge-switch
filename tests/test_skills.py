import base64
import tempfile
import unittest
from pathlib import Path
from workbench.skills import skills_target


class SkillTests(unittest.TestCase):
    def test_deploy_to_managed_tool_and_preserve_external_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = dict(tool='codex', id='sample', official={'codex': True},
                           files={'SKILL.md': base64.b64encode(b'Instructions').decode(),
                                  'scripts/test.py': base64.b64encode(b'print(1)').decode()})
            skills_target(dict(payload, operation='enable'), root)
            target = root / 'codex-chatgpt-home/skills/sample'
            self.assertEqual((target / 'scripts/test.py').read_text(), 'print(1)')
            self.assertFalse((root / 'codex-home').exists())
            self.assertEqual(skills_target(dict(payload, operation='list'), root)['codex'], ['sample'])
            with self.assertRaises(ValueError):
                skills_target(dict(payload, operation='enable'), root)
            (target / 'SKILL.md').write_text('External')
            with self.assertRaisesRegex(ValueError, '外部修改'):
                skills_target(dict(payload, operation='disable'), root)
            self.assertTrue(target.exists())
            (target / 'SKILL.md').write_text('Instructions')
            skills_target(dict(payload, operation='disable'), root)
            self.assertFalse(target.exists())

    def test_traversal_and_unowned_skill_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                skills_target(dict(operation='enable', tool='codex', id='../escape'), root)
            with self.assertRaises(ValueError):
                skills_target(dict(operation='enable', tool='codex', id='sample',
                                   files={'SKILL.md': '', '../escape': ''}), root)
            self.assertFalse((root / 'codex-home/skills/sample').exists())
            target = root / 'claude-home/skills/external'
            target.mkdir(parents=True)
            (target / 'SKILL.md').write_text('Original')
            with self.assertRaises(ValueError):
                skills_target(dict(operation='disable', tool='claude', id='external'), root)
            self.assertEqual((target / 'SKILL.md').read_text(), 'Original')
