"""Bounded, verified VS Code Server bootstrap, independent of extension downloads."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def prepare_server(board, commit, cache, progress, proxy=''):
    status = board.call('vscode_server', commit=commit, proxy=proxy, timeout=180)
    if status['ready']:
        progress('VS Code：%s，跳过下载和上传。' % ('已从板卡现有文件复用匹配服务端' if status.get('reused') else '服务端版本已匹配'))
        return status
    arch = {'aarch64': 'arm64', 'arm64': 'arm64', 'x86_64': 'x64'}.get(status['arch'])
    if not arch:
        raise RuntimeError('VS Code Server 当前仅支持 ARM64 / x86_64 Linux')
    if status['free_bytes'] < 1024 ** 3:
        raise RuntimeError('准备 VS Code Server 需要板卡至少 1 GB 可用空间')
    archive, checksum = download_server(commit, arch, cache, board.profile.proxy,
                                        board.profile.proxy_port, progress)
    scp = shutil.which('scp.exe') or shutil.which('scp')
    if not scp:
        raise RuntimeError('未找到 OpenSSH scp 客户端')
    upload_id = uuid.uuid4().hex
    remote = status['path'] + '/' + commit + '-' + upload_id + '.tar.gz'
    progress('VS Code：正在通过 SSH 上传已校验的服务端安装包…')
    result = subprocess.run([scp, *board.options(), '-P', str(board.profile.port), str(archive),
                             board.profile.user + '@' + board.profile.host + ':' + remote],
                            capture_output=True, timeout=180,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('VS Code Server 上传失败；请检查 SSH / SFTP 和板卡磁盘空间')
    progress('VS Code：正在板卡校验、解压并检查服务端 Node…')
    status = board.call('vscode_server', commit=commit, install=True, upload_id=upload_id,
                        sha256=checksum, proxy=proxy, timeout=180)
    if not status['ready']:
        raise RuntimeError('VS Code Server 尚未准备就绪')
    return status


def download_server(commit, arch, cache, use_proxy, port, progress):
    if not re.fullmatch('[a-f0-9]{40}', commit) or arch not in ('arm64', 'x64'):
        raise ValueError('Invalid VS Code download target')
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / (commit + '-' + arch + '.tar.gz')
    marker = archive.with_suffix('.json')
    # A verified cache works offline and is shared across local environments.
    if marker.exists() and archive.exists():
        try:
            metadata = json.loads(marker.read_text())
            if archive.stat().st_size == metadata['size'] and digest(archive) == metadata['sha256']:
                progress('VS Code：使用 SHA-256 校验通过的本机缓存。')
                return archive, metadata['sha256']
        except (OSError, ValueError, KeyError):
            pass
    curl = shutil.which('curl.exe') or shutil.which('curl')
    if not curl:
        raise RuntimeError('下载 VS Code Server 需要系统 curl 客户端')
    task = uuid.uuid4().hex
    headers = cache / (task + '.headers')
    direct = ['--noproxy', '*']
    routes = ([['--proxy', 'http://127.0.0.1:' + str(port), '--noproxy', ''], direct]
              if use_proxy else [direct])
    progress('VS Code：通过%s读取官方 %s 服务端下载信息…' % ('电脑代理' if use_proxy else '电脑直连', arch))
    url = 'https://update.code.visualstudio.com/commit:' + commit + '/server-linux-' + arch + '/stable'
    def request_args(route):
        return [curl, '-fLsS', '--proto', '=https', '--proto-redir', '=https', *route,
                '--connect-timeout', '12']
    active = []
    temp = cache / (task + '.downloading')
    try:
        result = None
        for route in routes:
            try:
                result = subprocess.run([*request_args(route), '-I', '--max-time', '30', '-D', str(headers),
                                         '-o', os.devnull, '-w', '%{url_effective}', url],
                                        capture_output=True, timeout=35,
                                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                if result.returncode == 0:
                    break
            except subprocess.TimeoutExpired:
                result = None
            progress('VS Code：当前官方元数据线路失败，尝试下一条可用线路…')
        if result is None or result.returncode:
            raise RuntimeError('无法读取 VS Code 官方下载信息；请检查电脑代理 / FlClash 后重试')
        text = headers.read_text(encoding='utf-8', errors='replace')
        hashes = re.findall(r'^x-sha256:\s*([0-9a-f]{64})', text, re.I | re.M)
        sizes = re.findall(r'^content-length:\s*(\d+)', text, re.I | re.M)
        final_url = result.stdout.decode().strip()
        if not hashes or not sizes or not final_url.startswith('https://'):
            raise RuntimeError('官方未返回 SHA-256、大小或 HTTPS 下载地址，已停止安装')
        checksum, size = hashes[-1].lower(), int(sizes[-1])
        if size <= 0 or size > 1024 ** 3:
            raise RuntimeError('VS Code Server 下载大小异常')
        # Also accept an archive copied from a browser or a colleague, but only
        # after verifying against the official metadata for this exact commit.
        candidates = [archive, cache / ('vscode-server-linux-' + arch + '.tar.gz')]
        imported = next((path for path in candidates if path.exists() and
                         path.stat().st_size == size and digest(path) == checksum), None)
        if imported:
            if imported != archive:
                shutil.copy2(imported, temp)
                os.replace(temp, archive)
            marker.write_text(json.dumps(dict(size=size, sha256=checksum)), encoding='utf-8')
            progress('VS Code：本地安装包与官方 SHA-256 匹配，跳过下载。')
            return archive, checksum
        # Completed chunks survive a failed attempt. Final SHA-256 covers every byte.
        parts = cache / (commit + '-' + arch + '-' + checksum[:12] + '.parts')
        parts.mkdir(exist_ok=True)
        chunk = 1024 ** 2
        pending, paths = [], []
        attempts = {}
        for lo in range(0, size, chunk):
            hi = min(size - 1, lo + chunk - 1)
            part = parts / str(lo)
            paths.append(part)
            if part.exists() and part.stat().st_size > hi - lo + 1:
                part.unlink()
            if not part.exists() or part.stat().st_size != hi - lo + 1:
                pending.append((lo, hi, part))
        progress('VS Code：安装包 %.1f MB；最多 3 路下载，支持分块内续传和自动重试…' % (size / 1024 ** 2))
        started = last = time.monotonic()
        while pending or active:
            while pending and len(active) < 3:
                lo, hi, part = pending.pop(0)
                attempt = attempts.get(lo, 0)
                attempts[lo] = attempt + 1
                offset = part.stat().st_size if part.exists() else 0
                incoming = cache / (task + '-' + str(lo) + '.incoming')
                response_headers = incoming.with_suffix('.response')
                route = routes[attempt % len(routes)]
                args = [*request_args(route), '--max-time', '90', '--speed-limit', '256', '--speed-time', '30',
                        '--range', '%d-%d' % (lo + offset, hi), '-D', str(response_headers),
                        '-o', str(incoming), final_url]
                process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                active.append((process, part, lo, hi, offset, incoming, response_headers))
            for job in list(active):
                process, part, lo, hi, offset, incoming, response_headers = job
                if process.poll() is not None:
                    # Only append bytes when the server confirms the exact requested
                    # range. Even curl timeout can contain useful partial data.
                    response = response_headers.read_text(errors='replace') if response_headers.exists() else ''
                    ranges = re.findall(r'^content-range:\s*bytes (\d+)-(\d+)/(\d+)', response, re.I | re.M)
                    valid = ranges and tuple(map(int, ranges[-1])) == (lo + offset, hi, size)
                    received = incoming.stat().st_size if incoming.exists() else 0
                    if valid and 0 < received <= hi - lo + 1 - offset:
                        with part.open('ab') as target, incoming.open('rb') as source:
                            shutil.copyfileobj(source, target)
                    incoming.unlink(missing_ok=True)
                    response_headers.unlink(missing_ok=True)
                    active.remove(job)
                    if not part.exists() or part.stat().st_size != hi - lo + 1:
                        if attempts[lo] >= 6:
                            raise RuntimeError('VS Code Server 下载线路连续失败；所有已校验范围的部分数据均已保留，再次点击可继续。也可用浏览器下载官方包，放入本机下载缓存后重试。')
                        progress('VS Code：分块线路中断（curl %d），保留已接收字节；自动%s重试 %d/6…' %
                                 (process.returncode, '切换代理 / 直连' if len(routes) > 1 else '', attempts[lo] + 1))
                        pending.append((lo, hi, part))
            now = time.monotonic()
            if now - started > 600:
                raise RuntimeError('VS Code Server 下载超过 10 分钟；已保留分块，检查电脑网络后重试可续传')
            if now - last >= 5:
                received = sum(path.stat().st_size for path in paths if path.exists())
                progress('VS Code：已保留 %.1f / %.1f MB（%.0f%%）；正在接收的字节稍后计入…' % (received / 1024 ** 2, size / 1024 ** 2, received * 100 / size))
                last = now
            time.sleep(.2)
        with temp.open('wb') as target:
            for part in paths:
                with part.open('rb') as source:
                    shutil.copyfileobj(source, target)
        if temp.stat().st_size != size or digest(temp) != checksum:
            shutil.rmtree(parts)
            raise RuntimeError('VS Code Server 官方 SHA-256 校验失败；已清除损坏分块，未安装')
        os.replace(temp, archive)
        metadata_temp = cache / (task + '.json')
        metadata_temp.write_text(json.dumps(dict(size=size, sha256=checksum)), encoding='utf-8')
        os.replace(metadata_temp, marker)
        shutil.rmtree(parts)
        progress('VS Code：官方安装包 SHA-256 校验通过。')
        return archive, checksum
    finally:
        for process, part, lo, hi, offset, incoming, response_headers in active:
            if process.poll() is None:
                process.kill()
            process.wait()
            response = response_headers.read_text(errors='replace') if response_headers.exists() else ''
            ranges = re.findall(r'^content-range:\s*bytes (\d+)-(\d+)/(\d+)', response, re.I | re.M)
            received = incoming.stat().st_size if incoming.exists() else 0
            if ranges and tuple(map(int, ranges[-1])) == (lo + offset, hi, size) and 0 < received <= hi - lo + 1 - offset:
                with part.open('ab') as target, incoming.open('rb') as source:
                    shutil.copyfileobj(source, target)
            incoming.unlink(missing_ok=True)
            response_headers.unlink(missing_ok=True)
        temp.unlink(missing_ok=True)
        headers.unlink(missing_ok=True)
