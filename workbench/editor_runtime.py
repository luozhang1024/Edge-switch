"""Keep a local editor copy so system VS Code updates cannot change board requirements."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid


def seed_extensions(target):
    """Only seed the Remote SSH extension family; never copy extension state."""
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    source = Path.home() / '.vscode/extensions'
    for prefix in ('ms-vscode-remote.remote-ssh-', 'ms-vscode.remote-explorer-'):
        candidates = [path for path in source.glob(prefix + '*') if (path / 'package.json').is_file()]
        if not candidates or any(target.glob(prefix + '*')):
            continue
        newest = max(candidates, key=lambda path: path.stat().st_mtime)
        stage = target / ('copy-' + uuid.uuid4().hex)
        try:
            shutil.copytree(newest, stage)
            stage.rename(target / newest.name)
        finally:
            if stage.exists():
                shutil.rmtree(stage)


def inspect_editor(executable):
    exe = Path(executable).resolve()
    if exe.name.lower() != 'code.exe' or not exe.is_file():
        raise ValueError('请选择已安装 VS Code 的 Code.exe')
    choices = list(exe.parent.glob('*/resources/app/out/cli.js')) + list(exe.parent.glob('resources/app/out/cli.js'))
    env = os.environ.copy()
    env['ELECTRON_RUN_AS_NODE'] = '1'
    for cli in sorted(choices, key=lambda path: path.stat().st_mtime, reverse=True):
        result = subprocess.run([str(exe), str(cli), '--version'], env=env, capture_output=True,
                                timeout=25, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        lines = result.stdout.decode(errors='replace').splitlines()
        commits = [line.strip() for line in lines if re.fullmatch('[a-f0-9]{40}', line.strip())]
        if not result.returncode and commits:
            return exe, cli, env, commits[0]
    raise RuntimeError('无法运行所选 VS Code 或识别其版本')


def pin_editor(directory, progress=lambda message: None, executable=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if executable is None:
        from repair import find_code
        exe, cli, env, commit = find_code()
    else:
        exe, cli, env, commit = inspect_editor(executable)
    exe, cli = Path(exe), Path(cli)
    target = directory / commit
    if not target.exists():
        stage = directory / ('preparing-' + uuid.uuid4().hex)
        stage.mkdir()
        progress('VS Code：正在从电脑已有安装创建固定版本副本，无需联网下载…')
        try:
            # Copy application files only. Never copy portable data, profiles,
            # extensions, credentials or the user's project directories.
            relative_cli = cli.relative_to(exe.parent)
            allowed = {'bin', 'resources', 'locales', 'swiftshader'}
            if relative_cli.parts[0] != 'resources':
                allowed.add(relative_cli.parts[0])
            for source in exe.parent.iterdir():
                application_file = (not source.name.lower().startswith('unins') and
                                    (source.suffix.lower() in {'.exe', '.dll', '.pak', '.bin', '.dat', '.manifest', '.xml'} or
                                     source.name in {'LICENSE.txt', 'ThirdPartyNotices.txt', 'LICENSES.chromium.html'}))
                if source.is_file() and application_file:
                    shutil.copy2(source, stage / source.name)
                elif source.name in allowed:
                    shutil.copytree(source, stage / source.name)
            copied = inspect_editor(stage / 'Code.exe')
            if copied[3] != commit:
                raise RuntimeError('复制期间系统 VS Code 版本发生变化，请重试')
            stage.rename(target)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    result = inspect_editor(target / 'Code.exe')
    if result[3] != commit:
        raise RuntimeError('固定编辑器版本检查失败，未切换版本')
    seed_extensions(target / 'managed-extensions')
    descriptor = directory / 'selected.json'
    temp = directory / (uuid.uuid4().hex + '.json')
    temp.write_text(json.dumps(dict(commit=commit)), encoding='utf-8')
    os.replace(temp, descriptor)
    progress('VS Code：已固定编辑器版本 %s；后续不跟随系统 VS Code 自动更新。' % commit[:10])
    return result


def editor_for(directory, progress=lambda message: None):
    directory = Path(directory)
    descriptor = directory / 'selected.json'
    if not descriptor.exists():
        return pin_editor(directory, progress)
    try:
        commit = json.loads(descriptor.read_text(encoding='utf-8'))['commit']
        if not re.fullmatch('[a-f0-9]{40}', commit):
            raise ValueError('invalid commit')
    except (ValueError, KeyError):
        raise RuntimeError('固定编辑器配置无效，请在“编辑器版本”中重新选择') from None
    result = inspect_editor(directory / commit / 'Code.exe')
    if result[3] != commit:
        raise RuntimeError('固定编辑器文件与版本不一致，请重新选择版本')
    seed_extensions(directory / commit / 'managed-extensions')
    progress('VS Code：使用固定编辑器 %s，忽略系统编辑器更新。' % commit[:10])
    return result
