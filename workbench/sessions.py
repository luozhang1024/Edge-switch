"""Read session logs within the current managed environment only."""
import json
from pathlib import Path


def session_files(root, request):
    homes = [('codex', 'codex-home/sessions'), ('codex', 'codex-chatgpt-home/sessions'),
             ('codex', 'codex-home/archived_sessions'), ('codex', 'codex-chatgpt-home/archived_sessions'),
             ('claude', 'claude-home/projects'), ('claude', 'claude-official-home/projects'),
             ('gemini', 'gemini-home/.gemini/tmp'), ('gemini', 'gemini-official-home/.gemini/tmp'),
             ('harness', 'harness-home/sessions'), ('opencode', 'opencode-home/data/opencode/storage/session'),
             ('opencode', 'opencode-official-home/data/opencode/storage/session')]
    key = request.get('key')
    files, warnings = [], ['OpenCode SQLite 与 Harness 压缩日志暂不支持阅读']
    for index, (tool, home) in enumerate(homes):
        directory = root / home
        if not directory.is_dir():
            continue
        base = directory.resolve()
        if root.resolve() not in base.parents:
            warnings.append('已跳过指向当前环境外部的会话目录')
            continue
        for count, path in enumerate(directory.rglob('*')):
            if count >= 10000:
                warnings.append('部分会话目录超过扫描上限')
                break
            if path.suffix not in ('.json', '.jsonl') or not path.is_file():
                continue
            # Never follow symlinks into another environment or credential directory.
            if base not in path.resolve().parents:
                continue
            if tool == 'gemini' and not path.name.startswith('session-'):
                continue
            source = str(index) + '/' + path.relative_to(directory).as_posix()
            if key and source != key:
                continue
            try:
                limit = 1024 * 1024 if key else 4096
                with path.open('rb') as stream:
                    raw = stream.read(limit + 1)
                files.append(dict(key=source, tool=tool, modified=path.stat().st_mtime,
                                  text=raw[:limit].decode('utf-8', errors='replace'), truncated=len(raw) > limit))
            except OSError:
                warnings.append('部分会话文件无法读取')
            if key:
                return dict(files=files, warnings=warnings)
            if len(files) >= 200:
                warnings.append('会话较多，仅显示扫描到的前 200 条')
                return dict(files=files, warnings=warnings)
    if key:
        raise ValueError('会话不存在或不属于当前环境')
    return dict(files=files, warnings=warnings)
