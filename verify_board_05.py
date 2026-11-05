"""Opt-in integration check: own disposable scope, no model inference or shared kills."""
import json
from pathlib import Path
import shlex
import socket
import subprocess
import threading
import time
import uuid
from dataclasses import replace

from workbench.core import Board, ManagedTunnel, PersistentHarness, Store


def wait_for(check, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(.5)
    raise AssertionError('Recovery deadline exceeded')


def main():
    store = Store()
    profile = store.profiles[0]
    original = Board(profile, store.scope(profile))
    scope = uuid.uuid4().hex
    board = Board(profile, scope)
    def remote(source):
        return subprocess.run([*board.ssh(), 'python3 -c ' + shlex.quote(source)],
                              capture_output=True, check=True, timeout=30)
    remote('from pathlib import Path; r=Path.home()/".local/share/edge-ssh-ai"; '
           's=r/' + repr(scope) + '; s.mkdir(mode=0o700); '
           '(s/"runtime").symlink_to(r/' + repr(original.scope) + '/"runtime"); '
           '(s/"tools").symlink_to(r/' + repr(original.scope) + '/"tools")')
    session = attached = first = second = None
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    listener.listen()
    listener.settimeout(.5)
    stopped = threading.Event()
    def accept():
        while not stopped.is_set():
            try:
                client, _ = listener.accept()
                client.close()
            except socket.timeout:
                pass
            except OSError:
                return
    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    report = {}
    try:
        session = PersistentHarness(board)
        pid, port = session.remote_pid, session.port
        session.detach()
        assert board.call('harness_status')['pid'] == pid
        report['detached_service_survives'] = True
        info = board.call('harness_status', include_token=True)
        # Reopening an old server must not reconfigure it from a changed form.
        changed = Board(replace(profile, project='/tmp'), scope)
        attached = PersistentHarness(changed, existing=info)
        assert (attached.remote_pid, attached.port) == (pid, port)
        report['reattach_same_process_and_browser_port'] = True
        report['changed_project_attach_preserves_original_service'] = True
        attached.connection.process.terminate()
        attached.connection.process.wait(timeout=5)
        wait_for(lambda: attached.alive)
        attached._wait_ready()
        assert board.call('harness_status')['pid'] == pid
        report['browser_forward_recovered'] = True
        local_port = listener.getsockname()[1]
        first = ManagedTunnel(board, local_port)
        second = ManagedTunnel(board, local_port)
        remote_port = first.port
        first.connection.process.terminate()
        first.connection.process.wait(timeout=5)
        wait_for(lambda: first.alive)
        assert first.port == remote_port and second.alive
        report['proxy_recovers_same_port_other_tunnel_unaffected'] = True
        attached.close()
        assert board.call('harness_status')['running']
        report['background_close_survives'] = True
        board.call('harness_stop', timeout=30)
        assert not board.call('harness_status')['running']
        report['explicit_stop'] = True
        Path('docs/board-0.5-check.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report))
    finally:
        for item in (session, attached):
            if item:
                item.detach()
        for item in (first, second):
            if item:
                item.close()
        board.call('harness_stop', timeout=30)
        stopped.set()
        listener.close()
        # Only the freshly generated scope; shutil.rmtree does not follow symlinks.
        remote('from pathlib import Path; import shutil; p=Path.home()/".local/share/edge-ssh-ai"/' + repr(scope) + '; shutil.rmtree(p)')


if __name__ == '__main__':
    main()
