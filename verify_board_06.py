"""Opt-in Codex API-switch check in an isolated board scope; no inference."""
import json
from pathlib import Path
import shlex
import subprocess
import uuid
from workbench.core import Board, Store


def main():
    store = Store()
    profile = store.profiles[0]
    original = store.scope(profile)
    scope = uuid.uuid4().hex
    board = Board(profile, scope)
    def remote(source):
        return subprocess.run([*board.ssh(), 'python3 -c ' + shlex.quote(source)],
                              capture_output=True, check=True, timeout=30)
    remote('from pathlib import Path; r=Path.home()/".local/share/edge-ssh-ai"; s=r/' + repr(scope) +
           '; s.mkdir(mode=0o700); (s/"runtime").symlink_to(r/' + repr(original) +
           '/"runtime"); (s/"tools").symlink_to(r/' + repr(original) + '/"tools")')
    report = {}
    try:
        payload = dict(project=profile.project, base_url='https://example.com/v1',
                       model='gpt-6.1-sol', protocol='responses', proxy='')
        for service in ('first', 'second'):
            result = board.call('configure_ide', service_id=service, key='test-local-only-' + service, **payload)
            assert result['auth'] == 'API Key'
        report['two_services_cli_login'] = True
        board.call('configure_ide', reuse=True, service_id='second', **payload)
        report['same_service_key_reuse'] = True
        try:
            board.call('configure_ide', reuse=True, service_id='first', **payload)
        except RuntimeError:
            report['other_service_key_reuse_blocked'] = True
        else:
            raise AssertionError('Wrong service credential reused')
        source = ('from pathlib import Path; import json; r=Path.home()/".local/share/edge-ssh-ai"/' + repr(scope) +
                  '; p=json.loads((r/"launch.json").read_text()); assert p["service_id"]=="second"; '
                  'assert p["key"]=="test-local-only-second"')
        remote(source)
        report['failed_reuse_preserves_previous_configuration'] = True
        result = board.call('configure_ide', project=profile.project, auth_mode='chatgpt', proxy='')
        assert result['auth'] == 'ChatGPT'
        source = ('from pathlib import Path; import json; r=Path.home()/".local/share/edge-ssh-ai"/' + repr(scope) +
                  '; p=json.loads((r/"launch.json").read_text()); assert p["auth_mode"]=="chatgpt"; assert not p["key"]; '
                  'assert "model_provider" not in (r/"codex-chatgpt-home/config.toml").read_text(); '
                  'assert json.loads((r/"api-launch.json").read_text())["service_id"]=="second"')
        remote(source)
        report['official_mode_separate_home_no_api_credentials'] = True
        board.call('configure_ide', reuse=True, service_id='second', **payload)
        report['return_to_api_retains_credentials'] = True
        imported = dict(auth_mode='chatgpt', OPENAI_API_KEY=None,
                        tokens=dict(access_token='dummy-access-no-network', refresh_token='dummy-refresh',
                                    id_token='dummy-id', account_id='dummy-account'))
        board.call('import_official_auth', auth_json=json.dumps(imported))
        remote('from pathlib import Path; import json; r=Path.home()/".local/share/edge-ssh-ai"/' + repr(scope) +
               '; p=r/"codex-chatgpt-home/auth.json"; assert p.stat().st_mode & 0o777 == 0o600; '
               'a=json.loads(p.read_text()); a["tokens"]["access_token"]="rotated-dummy"; p.write_text(json.dumps(a))')
        board.call('import_official_auth', auth_json=json.dumps(imported))
        remote('from pathlib import Path; import json; r=Path.home()/".local/share/edge-ssh-ai"/' + repr(scope) +
               '; a=json.loads((r/"codex-chatgpt-home/auth.json").read_text()); '
               'assert a["tokens"]["access_token"]=="rotated-dummy"')
        report['oauth_import_private_permissions_and_refresh_preserved'] = True
        board.call('configure_ide', project=profile.project, auth_mode='chatgpt', proxy='')
        report['imported_oauth_recognized_without_inference'] = board.call('codex_auth_status')['authenticated']
        Path('docs/board-0.6-check.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report))
    finally:
        remote('from pathlib import Path; import shutil; p=Path.home()/".local/share/edge-ssh-ai"/' + repr(scope) + '; shutil.rmtree(p)')


if __name__ == '__main__':
    main()
