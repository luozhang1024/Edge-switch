"""Board-side detached Harness supervisor; Python 3.8+, standard library only."""
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time


def write_json(path, value):
    tmp = path.with_name(path.name + '.tmp')
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
    os.replace(str(tmp), str(path))


def process_identity(pid):
    try:
        root = Path('/proc') / str(int(pid))
        # comm can contain spaces and parentheses, so split after its final ')'.
        stat = (root / 'stat').read_text().rsplit(')', 1)[1].split()
        if root.stat().st_uid != os.getuid() or stat[0] == 'Z':
            return None
        return stat[19]  # starttime, /proc stat field 22
    except (OSError, ValueError, IndexError):
        return None


def status(root, include_token=False):
    try:
        value = json.loads((root / 'harness-service.json').read_text())
        identity = process_identity(value['pid'])
        args = (Path('/proc') / str(value['pid']) / 'cmdline').read_bytes().split(b'\0')
        running = bool(identity and identity == value['start_ticks'] and
                       str(root / 'harness-service.py').encode() in args)
        if not running:
            return dict(running=False)
        result = {k: value[k] for k in ('pid', 'port', 'local_port', 'project', 'proxy', 'background')}
        result.update(running=True, ready=bool(value.get('token')))
        if include_token:
            result['token'] = value.get('token', '')
        return result
    except (OSError, ValueError, KeyError, TypeError):
        return dict(running=False)


def stop(root):
    if not root.exists():
        return dict(running=False, stopped=False)
    with (root / 'harness-operation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _stop(root)


def _stop(root):
    value = status(root)
    if not value['running']:
        return dict(running=False, stopped=False)
    # The supervisor owns its child group. Never match processes by a broad name.
    try:
        os.kill(value['pid'], signal.SIGTERM)
    except ProcessLookupError:
        return dict(running=False, stopped=True)
    for _ in range(80):
        if not status(root)['running']:
            return dict(running=False, stopped=True)
        time.sleep(.2)
    raise RuntimeError('Harness 未正常退出；保留进程，未执行强制批量结束')


def start(root, project, proxy, local_port, background, source):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / 'harness-operation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = status(root, include_token=True)
        if previous['running']:
            if previous['project'] != project or previous['proxy'] != proxy:
                raise RuntimeError('Harness 正在运行，且工程或网络设置不同；请先停止，再重新启动，避免中断任务')
            # Lifecycle policy may be changed without restarting the server.
            raw = json.loads((root / 'harness-service.json').read_text())
            raw['background'] = bool(background)
            write_json(root / 'harness-service.json', raw)
            previous['background'] = bool(background)
            return previous
        if not Path(project).is_dir():
            raise ValueError('工程目录不存在')
        if not (root / 'tools/harness/current.json').is_file():
            raise ValueError('请先安装 Harness')
        script = root / 'harness-service.py'
        script.write_bytes(source)
        script.chmod(0o600)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        write_json(root / 'harness-service-input.json', dict(project=project, proxy=proxy,
                   local_port=int(local_port), port=port, background=bool(background)))
        log = root / 'harness-service.log'
        fd = os.open(str(log), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            child = subprocess.Popen([sys.executable, '-u', str(script)], stdin=subprocess.DEVNULL,
                                     stdout=stream, stderr=stream, start_new_session=True, close_fds=True)
        for _ in range(40):
            value = status(root, include_token=True)
            if value['running']:
                return value
            if child.poll() is not None:
                raise RuntimeError('Harness 后台启动失败；请检查板卡专属目录中的 harness-service.log')
            time.sleep(.1)
        raise RuntimeError('Harness 后台启动状态未确认，请刷新概览后再试')


def serve(root):
    os.umask(0o077)
    lock = (root / 'harness-daemon.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    config = json.loads((root / 'harness-service-input.json').read_text())
    state = dict(config, pid=os.getpid(), start_ticks=process_identity(os.getpid()), token='')
    state_path = root / 'harness-service.json'
    write_json(state_path, state)
    env = os.environ.copy()
    for name in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
        env.pop(name, None)
    if config['proxy']:
        env.update(HTTP_PROXY=config['proxy'], HTTPS_PROXY=config['proxy'],
                   http_proxy=config['proxy'], https_proxy=config['proxy'])
    env.update(DSH_HOME=str(root / 'harness-home'), DSH_TELEMETRY_MODE='DISABLED',
               NO_PROXY='localhost,127.0.0.1,::1', no_proxy='localhost,127.0.0.1,::1')
    env['PATH'] = str(root / 'runtime/bin') + os.pathsep + env.get('PATH', '')
    binary = json.loads((root / 'tools/harness/current.json').read_text())['binary']
    child = None
    stopped = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *args: stopped.set())
    try:
        args = [binary]
        model_path = root / 'harness-api.json'
        if model_path.is_file():
            model = json.loads(model_path.read_text())
            for name in list(env):
                if any(part in name.upper() for part in ('API_KEY', 'ACCESS_TOKEN', 'AUTH_TOKEN')):
                    env.pop(name, None)
            env['EDGE_MODEL_API_KEY'] = model['key']
            args += ['--patch', str(root / 'harness-provider.patch.yml')]
        env['DSH_TELEMETRY_DISABLED'] = '1'
        child = subprocess.Popen(args + ['web', '--host', '127.0.0.1', '--port', str(config['port']),
                                  '--trusted-host', '127.0.0.1:' + str(config['local_port']), '--no-open'],
                                 env=env, cwd=config['project'], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 universal_newlines=True, start_new_session=True)
        def read_output():
            for line in child.stdout:
                match = re.search(r'[?&]token=([A-Za-z0-9_-]+)', line)
                if match:
                    # Keep the current lifecycle policy if it was changed by an attach.
                    with (root / 'harness-operation.lock').open('a') as operation:
                        fcntl.flock(operation, fcntl.LOCK_EX)
                        latest = json.loads(state_path.read_text())
                        latest['token'] = match.group(1)
                        write_json(state_path, latest)
                    line = line.replace(match.group(1), '[hidden]')
                print(line.rstrip(), flush=True)
        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()
        while child.poll() is None and not stopped.wait(.3):
            pass
    finally:
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
        # Removing state makes PID reuse unable to target another process.
        try:
            state_path.unlink()
        except FileNotFoundError:
            pass
        lock.close()


if __name__ == '__main__':
    serve(Path(__file__).resolve().parent)
