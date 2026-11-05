"""Runs on the RK3568, using Python 3.8+ standard library only."""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit

BEGIN = '# >>> RK3568 SSH repair: VS Code proxy guard >>>'
END = '# <<< RK3568 SSH repair: VS Code proxy guard <<<'
PROXIES = ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
           'http_proxy', 'https_proxy', 'all_proxy')


def reachable(value):
    try:
        u = urlsplit(value if '://' in value else 'http://' + value)
        with socket.create_connection((u.hostname, u.port or (443 if u.scheme == 'https' else 80)), 2):
            return True
    except (OSError, ValueError, TypeError):
        return False


def backup_write(path, text):
    if path.exists() and path.read_text() == text:
        return
    if path.exists():
        shutil.copy2(str(path), str(path) + '.backup-ssh-' + str(time.time_ns()))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def servers(dest):
    found = []
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():
            continue
        try:
            if p.stat().st_uid != os.getuid():
                continue
            args = (p / 'cmdline').read_bytes().split(bytes([0]))
            if str(dest / 'out/server-main.js').encode() in args:
                found.append(int(p.name))
        except (OSError, ProcessLookupError):
            pass
    return found


def main():
    mode, commit = sys.argv[1:3]
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('Invalid VS Code commit')
    root = Path.home() / '.vscode-server'
    dest = root / 'bin' / commit
    required = ('node', 'bin/code-server', 'out/server-main.js', 'product.json')
    complete = all((dest / name).is_file() for name in required)
    if complete:
        try:
            product = json.loads((dest / 'product.json').read_text())
            complete = product.get('commit') == commit
            subprocess.run([str(dest / 'node'), '--version'], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=10)
        except (OSError, ValueError, subprocess.SubprocessError):
            complete = False
    broken = [k for k in PROXIES if os.environ.get(k) and not reachable(os.environ[k])]
    if mode == 'status':
        print(json.dumps({'user': os.environ.get('USER'), 'home': str(Path.home()),
                          'arch': os.uname().machine, 'complete': complete,
                          'free_bytes': shutil.disk_usage(str(Path.home())).free,
                          'server_pids': servers(dest), 'broken_proxy_variables': broken,
                          'flock': bool(shutil.which('flock'))}))
        return
    if mode != 'repair':
        raise ValueError('Unknown operation')

    # Remote HTTP settings are evaluated on the board, not on the Windows PC.
    machine = root / 'data/Machine/settings.json'
    settings = machine.read_text() if machine.exists() else '{}'
    spans, _ = jsonc_spans(settings)
    span = spans.get('http.proxy')
    effective_proxy = json.loads(settings[slice(*span)]) if span else LOCAL_PROXY
    proxy_overridden = bool(effective_proxy and not reachable(effective_proxy))
    if proxy_overridden:
        backup_write(machine, patch_jsonc(settings, {'http.proxy': ''}))

    # Guard only VS Code startup; leave shared shell configuration untouched.
    envfile = root / 'server-env-setup'
    original = envfile.read_text() if envfile.exists() else '#!/bin/sh\n'
    original = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\n?', '', original, flags=re.S)
    guard = '''
eval "$(python3 - <<'RK3568_PROXY_CHECK'
import os, socket
from urllib.parse import urlsplit
cache = {}
for name in ('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'):
    value = os.environ.get(name)
    if not value:
        continue
    if value not in cache:
        try:
            u = urlsplit(value if '://' in value else 'http://' + value)
            with socket.create_connection((u.hostname, u.port or (443 if u.scheme == 'https' else 80)), 1.5):
                cache[value] = True
        except (OSError, ValueError, TypeError):
            cache[value] = False
    if not cache[value]:
        print('unset ' + name)
RK3568_PROXY_CHECK
)"
'''
    backup_write(envfile, original.rstrip() + '\n\n' + BEGIN + guard + END + '\n')
    envfile.chmod(0o700)

    # This account/commit only. Never kill unrelated applications or other users.
    pids = servers(dest)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for _ in range(30):
        if not servers(dest):
            break
        time.sleep(.2)
    if servers(dest):
        raise RuntimeError('Server did not stop gracefully; no forced kill performed')

    if not complete:
        archive = Path('/tmp') / ('vscode-repair-' + commit + '.tar.gz')
        if not archive.is_file():
            raise RuntimeError('Verified server archive was not uploaded')
        expected = sys.argv[3]
        import hashlib
        h = hashlib.sha256()
        with archive.open('rb') as f:
            for block in iter(lambda: f.read(1024 * 1024), b''):
                h.update(block)
        if h.hexdigest() != expected:
            raise RuntimeError('Remote archive checksum mismatch')
        stage = dest.with_name(commit + '.repair-' + str(time.time_ns()))
        stage.mkdir(parents=True)
        subprocess.run(['tar', '-xzf', str(archive), '--strip-components=1', '-C', str(stage)], check=True)
        if not all((stage / name).is_file() for name in required):
            raise RuntimeError('Archive does not contain the required server files')
        product = json.loads((stage / 'product.json').read_text())
        if product.get('commit') != commit:
            raise RuntimeError('Archive commit mismatch')
        subprocess.run([str(stage / 'node'), '--version'], check=True,
                       stdout=subprocess.DEVNULL, timeout=10)
        if dest.exists():
            dest.rename(dest.with_name(commit + '.incomplete-backup-' + str(time.time_ns())))
        stage.rename(dest)
        archive.unlink()

    # The process has stopped: archive leftover installation locks, never the server.
    locks = [p for p in dest.glob('vscode-remote-lock.*') if '.backup-' not in p.name]
    if locks:
        lockbackup = root / 'repair-backups' / str(time.time_ns())
        lockbackup.mkdir(parents=True)
        for p in locks:
            p.rename(lockbackup / p.name)
    print(json.dumps({'repaired': True, 'restarted_pids': pids,
                      'server_installed': not complete, 'proxy_guard': str(envfile),
                      'dead_remote_http_proxy_overridden': proxy_overridden}))


if __name__ == '__main__':
    main()
