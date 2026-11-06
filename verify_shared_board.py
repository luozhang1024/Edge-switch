"""Simulate a fresh colleague environment, reusing tools without credentials or inference."""
import json
from pathlib import Path
import shlex
import subprocess
import tempfile
import uuid
from unittest.mock import patch

from workbench.core import Board, Store, open_vscode


def main():
    store = Store()
    profile = store.profiles[0]
    scope = uuid.uuid4().hex
    board = Board(profile, scope)
    report = {}
    run = subprocess.run
    try:
        before = board.call('diagnose')
        assert before['codex'] and before['harness']
        assert not before['scoped_codex'] and not before['scoped_harness']
        report['fresh_environment_sees_board_tools'] = True
        board.call('reuse_tools', tools=['codex', 'harness'], timeout=100)
        after = board.call('diagnose')
        assert after['managed_runtime'] and after['scoped_codex'] and after['scoped_harness']
        report['existing_binaries_validate_and_reuse'] = True
        source = ('from pathlib import Path; r=Path.home()/".local/share/edge-ssh-ai"/' + repr(scope) +
                  '; assert not (r/"launch.json").exists(); assert not (r/"codex-home/auth.json").exists(); '
                  'assert not (r/"codex-chatgpt-home/auth.json").exists(); assert not (r/"harness-service.json").exists()')
        run([*board.ssh(), 'python3 -c ' + shlex.quote(source)], check=True, capture_output=True, timeout=25)
        report['no_credentials_or_tasks_copied'] = True
        with tempfile.TemporaryDirectory() as folder:
            def dispatch(args, **kwargs):
                if args[0] == 'Code.exe':
                    return subprocess.CompletedProcess(args, 0, b'ms-vscode-remote.remote-ssh\n', b'')
                return run(args, **kwargs)
            with patch('workbench.editor_runtime.editor_for', return_value=('Code.exe', 'cli.js', {}, 'test')), \
                 patch('workbench.vscode_server.prepare_server', return_value=dict(path='/private/test-server', ready=True)), \
                 patch('workbench.core.subprocess.run', side_effect=dispatch):
                open_vscode(board, folder)
            settings = json.loads((Path(folder) / 'User/settings.json').read_text())
            assert settings['remote.SSH.remotePlatform']['edge-' + scope] == 'linux'
            assert settings['remote.SSH.useExecServer'] is False
            report['vscode_exact_generated_ssh_config_real_login'] = True
        Path('docs/shared-board-1.0.1-check.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report))
    finally:
        source = ('from pathlib import Path; import shutil; p=Path.home()/".local/share/edge-ssh-ai"/' + repr(scope) +
                  '; shutil.rmtree(p) if p.exists() else None')
        run([*board.ssh(), 'python3 -c ' + shlex.quote(source)], check=True, capture_output=True, timeout=25)


if __name__ == '__main__':
    main()
