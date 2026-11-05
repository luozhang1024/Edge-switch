"""One-click Windows repair for FineHigh@192.168.0.168; standard library only."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

from jsonc_utils import patch_jsonc

ROOT = Path(__file__).resolve().parent
TARGET = '192.168.0.168'
LOGIN = 'FineHigh@' + TARGET
CACHE = ROOT / 'cache'
LOG = None
REPAIR_LOCK = None


def say(message):
    message = str(message)
    print(message, flush=True)
    if LOG:
        with LOG.open('a', encoding='utf-8') as f:
            f.write(message + '\n')


def run(args, timeout=45, data=None):
    p = subprocess.run([str(x) for x in args], input=data,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    out = p.stdout.decode('utf-8', errors='replace').strip()
    err = p.stderr.decode('utf-8', errors='replace').strip()
    if p.returncode:
        raise RuntimeError(err or out or ('Command failed: ' + str(args[0])))
    return out


def write_backup(path, text):
    old = path.read_text(encoding='utf-8-sig') if path.exists() else None
    if old == text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_name(path.name + '.backup-ssh-' + str(time.time_ns()))
        shutil.copy2(path, backup)
        say('备份：' + str(backup))
    tmp = path.with_name(path.name + '.repair-tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)


def ssh_options():
    return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
            '-o', 'StrictHostKeyChecking=yes']


def remote(ssh, mode, commit, digest='', local_proxy=''):
    source = ((ROOT / 'jsonc_utils.py').read_bytes() + b'\nLOCAL_PROXY = '
              + repr(local_proxy).encode('utf-8') + b'\n'
              + (ROOT / 'remote_repair.py').read_bytes())
    # SSH's shell executes this fixed command. No untrusted values are interpolated.
    command = 'python3 - ' + mode + ' ' + commit + (' ' + digest if digest else '')
    return json.loads(run([ssh, *ssh_options(), LOGIN, command], timeout=180, data=source))


def metadata(curl, commit, network_options=None):
    url = 'https://update.code.visualstudio.com/commit:' + commit + '/server-linux-arm64/stable'
    CACHE.mkdir(exist_ok=True)
    headers = CACHE / (commit + '.headers')
    route = network_options if network_options is not None else ['--noproxy', '*']
    final = run([curl, '-fsSIL', *route, '--connect-timeout', '12',
                 '--max-time', '40', '-D', headers, '-o', os.devnull,
                 '-w', '%{url_effective}', url], timeout=45)
    text = headers.read_text(encoding='utf-8', errors='replace')
    hashes = re.findall(r'^x-sha256:\s*([0-9a-f]{64})', text, re.I | re.M)
    sizes = re.findall(r'^content-length:\s*(\d+)', text, re.I | re.M)
    if not hashes or not sizes or not final.startswith('https://'):
        raise RuntimeError('Official download metadata is missing checksum/size/HTTPS URL')
    return final, int(sizes[-1]), hashes[-1].lower()


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def download(curl, commit):
    routes = [['--noproxy', '*']]
    settings = Path(os.environ['APPDATA']) / 'Code/User/settings.json'
    if settings.exists():
        from jsonc_utils import jsonc_spans
        source = settings.read_text(encoding='utf-8-sig')
        span = jsonc_spans(source)[0].get('http.proxy')
        proxy = json.loads(source[slice(*span)]) if span else ''
        if proxy:
            routes.append(['--proxy', proxy, '--noproxy', ''])
    routes.append([])  # curl's environment proxy, if configured
    for index, route in enumerate(routes):
        try:
            url, size, digest = metadata(curl, commit, route)
            break
        except (RuntimeError, subprocess.SubprocessError):
            if index == len(routes) - 1:
                raise
            say('当前下载线路不可用，尝试下一条线路。')
    archive = CACHE / (commit + '-arm64.tar.gz')
    if archive.exists() and archive.stat().st_size == size and sha256(archive) == digest:
        say('使用已校验的本地缓存，不重复下载。')
        return archive, digest
    say('服务端缺失，下载官方 ARM64 安装包（约 %.0f MB）。' % (size / 1024 ** 2))
    chunk = 8 * 1024 ** 2
    count = (size + chunk - 1) // chunk

    def fetch(i):
        part = CACHE / (commit + '.part-' + str(i))
        lo, hi = i * chunk, min(size - 1, (i + 1) * chunk - 1)
        run([curl, '-fsSL', *route, '--retry', '2', '--connect-timeout', '12',
             '--max-time', '150', '--range', '%d-%d' % (lo, hi), '-o', part, url], timeout=480)
        if part.stat().st_size != hi - lo + 1:
            raise RuntimeError('Download server did not return the requested range')
        say('下载分块完成：%d/%d' % (i + 1, count))
        return part

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            paths = list(pool.map(fetch, range(count)))
        tmp = archive.with_suffix('.downloading')
        with tmp.open('wb') as out:
            for path in paths:
                with path.open('rb') as inp:
                    shutil.copyfileobj(inp, out)
    except (RuntimeError, subprocess.SubprocessError):
        say('分块下载失败，尝试单路下载。')
        tmp = archive.with_suffix('.downloading')
        run([curl, '-fsSL', *route, '--retry', '2', '--connect-timeout', '12',
             '--max-time', '900', '-o', tmp, url], timeout=2800)
    if tmp.stat().st_size != size or sha256(tmp) != digest:
        raise RuntimeError('SHA-256 verification failed; installation cancelled')
    os.replace(tmp, archive)
    for part in CACHE.glob(commit + '.part-*'):
        part.unlink()
    say('官方 SHA-256 校验通过。')
    return archive, digest


def find_code():
    configured = shutil.which('code.cmd')
    if not configured:
        raise RuntimeError('未找到 VS Code：请确认已安装并加入 PATH。')
    product = Path(configured).resolve().parent.parent
    executables = list(product.glob('Code.exe'))
    if not executables:
        raise RuntimeError('未找到 Code.exe。')
    # Invoke VS Code's Node CLI directly, avoiding cmd.exe quoting/expansion.
    possible = list(product.glob('*/resources/app/out/cli.js')) + list(product.glob('resources/app/out/cli.js'))
    if not possible:
        raise RuntimeError('未找到 VS Code CLI。')
    env = os.environ.copy()
    env['ELECTRON_RUN_AS_NODE'] = '1'
    # The bin launcher identifies the active installation after an update.
    launcher = Path(configured).read_text(encoding='utf-8', errors='replace')
    choices = sorted(possible, key=lambda p: (p.parent.parent.parent.parent.name in launcher,
                                             p.stat().st_mtime), reverse=True)
    for cli in choices:
        p = subprocess.run([str(executables[0]), str(cli), '--version'], env=env,
                           capture_output=True, timeout=25)
        lines = p.stdout.decode(errors='replace').splitlines()
        commits = [line.strip() for line in lines if re.fullmatch('[0-9a-f]{40}', line.strip())]
        if p.returncode == 0 and commits:
            return executables[0], cli, env, commits[0]
    raise RuntimeError('无法识别当前 VS Code 版本。')


def main():
    global LOG, REPAIR_LOCK
    parser = argparse.ArgumentParser()
    parser.add_argument('--diagnose', action='store_true', help='read-only checks; no download or restart')
    args = parser.parse_args()
    logs = ROOT / 'logs'
    logs.mkdir(exist_ok=True)
    LOG = logs / (datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.log')
    say('RK3568 VS Code SSH ' + ('只读诊断' if args.diagnose else '一键修复'))
    say('目标：FineHigh@192.168.0.168；日志：' + str(LOG))
    if not args.diagnose:
        import msvcrt
        REPAIR_LOCK = (ROOT / '.repair.lock').open('a+b')
        if REPAIR_LOCK.seek(0, os.SEEK_END) == 0:
            REPAIR_LOCK.write(b'0')
            REPAIR_LOCK.flush()
        REPAIR_LOCK.seek(0)
        try:
            msvcrt.locking(REPAIR_LOCK.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            raise RuntimeError('另一个修复工具正在运行，请等待它结束。') from exc
        say('请先保存远程工作。修复会重启该账户当前版本的 VS Code 服务，远程终端可能断开。')
        say('8 秒后开始；如需取消请关闭窗口或按 Ctrl+C。')
        time.sleep(8)
    ssh = shutil.which('ssh.exe')
    curl = str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'System32/curl.exe')
    if not Path(curl).exists():
        curl = shutil.which('curl.exe')
    if not ssh or not curl:
        raise RuntimeError('需要 Windows OpenSSH 客户端和 curl.exe。')
    exe, cli, code_env, commit = find_code()
    say('当前 VS Code commit：' + commit)
    try:
        status = remote(ssh, 'status', commit)
    except Exception as exc:
        raise RuntimeError('SSH 登录失败。请检查板子供电、IP、22 端口和密钥。'
                           '本工具不绕过身份验证、不修改主机指纹。详细信息：' + str(exc)) from exc
    say('SSH 正常；远程状态：' + json.dumps(status, ensure_ascii=False))
    if status['arch'] not in ('aarch64', 'arm64'):
        raise RuntimeError('目标不是 ARM64，已停止。')
    if args.diagnose:
        say('只读诊断完成，未修改配置、下载或重启。')
        return
    digest = ''
    if not status['complete']:
        if status['free_bytes'] < 1500 * 1024 ** 2:
            raise RuntimeError('远程可用空间不足 1.5 GB，请先释放空间。')
        archive, digest = download(curl, commit)
        scp = Path(ssh).with_name('scp.exe')
        say('上传安装包……')
        run([scp, *ssh_options(), archive,
             LOGIN + ':/tmp/vscode-repair-' + commit + '.tar.gz'], timeout=300)
    else:
        say('当前版本服务端完整，跳过下载和上传。')
    settings = Path(os.environ['APPDATA']) / 'Code/User/settings.json'
    source = settings.read_text(encoding='utf-8-sig') if settings.exists() else '{}'
    changes = {'remote.SSH.useFlock': bool(status['flock']),
               'remote.SSH.localServerDownload': 'auto'}
    updated = patch_jsonc(source, changes)
    from jsonc_utils import jsonc_spans
    spans, _ = jsonc_spans(source)
    span = spans.get('http.proxy')
    local_proxy = json.loads(source[slice(*span)]) if span else ''
    result = remote(ssh, 'repair', commit, digest, local_proxy)
    say('远程修复结果：' + json.dumps(result, ensure_ascii=False))
    write_backup(settings, updated)
    say('打开新的 VS Code 远程窗口……')
    logroot = Path(os.environ['APPDATA']) / 'Code/logs'
    pattern = '*/window*/exthost/output_logging_*/*Remote*SSH*.log'
    offsets = {p: p.stat().st_size for p in logroot.glob(pattern)}
    subprocess.run([str(exe), str(cli), '--new-window', '--remote', 'ssh-remote+' + TARGET],
                   env=code_env, check=True, timeout=30)
    # Verify real client tunnel establishment; do not call launching a window success.
    started = time.time()
    verified = False
    while time.time() - started < 70:
        for path in logroot.glob(pattern):
            if path.stat().st_mtime < started - 2:
                continue
            with path.open('rb') as stream:
                offset = offsets.get(path, 0)
                stream.seek(offset if path.stat().st_size >= offset else 0)
                text = stream.read().decode('utf-8', errors='replace')
            if 'Resolved "ssh-remote+' + TARGET + '" to' in text:
                verified = True
                break
        if verified:
            break
        time.sleep(2)
    status = remote(ssh, 'status', commit)
    if not verified or not status['server_pids'] or not status['complete']:
        raise RuntimeError('修复已执行，但尚未确认 VS Code 隧道成功。请查看 Remote - SSH 输出和本工具日志。')
    say('修复完成：已确认 VS Code 远程隧道建立、服务端进程正常。')
    say('使用新打开的 SSH 窗口；通过“文件 → 打开文件夹”选择 /home/FineHigh。')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        say('已取消。')
        sys.exit(130)
    except Exception as exc:
        say('修复未完成：' + str(exc))
        if LOG:
            say('请保留日志：' + str(LOG))
        sys.exit(1)
