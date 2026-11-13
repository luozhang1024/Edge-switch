"""Skill deployment for SSH targets; never replace externally owned files."""
import base64
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path


def skills_target(payload, managed_root=None):
    home = Path.home()
    roots = {
        'codex': Path(os.environ.get('CODEX_HOME', home / '.codex')) / 'skills',
        'claude': Path(os.environ.get('CLAUDE_CONFIG_DIR', home / '.claude')) / 'skills',
        'gemini': Path(os.environ.get('GEMINI_CLI_HOME', home)) / '.gemini/skills',
        'opencode': Path(os.environ.get('XDG_CONFIG_HOME', home / '.config')) / 'opencode/skills',
        'kimi': home / '.kimi/skills',
        'grok': home / '.grok/skills',
        'qwen': home / '.qwen/skills',
        'copilot': home / '.copilot/skills',
    }
    if managed_root is not None:
        root = Path(managed_root)
        official = payload.get('official', {})
        roots = {
            'codex': root / ('codex-chatgpt-home' if official.get('codex') else 'codex-home') / 'skills',
            'claude': root / ('claude-official-home' if official.get('claude') else 'claude-home') / 'skills',
            'gemini': root / ('gemini-official-home' if official.get('gemini') else 'gemini-home') / '.gemini/skills',
            'opencode': root / ('opencode-official-home' if official.get('opencode') else 'opencode-home') / 'config/opencode/skills',
            'kimi': root / 'extra-kimi/.kimi/skills',
            'grok': root / 'extra-grok/.grok/skills',
            'qwen': root / 'extra-qwen/.qwen/skills',
            'copilot': root / 'extra-copilot/.copilot/skills',
        }
    operation = payload.get('operation')
    if operation == 'list':
        return {tool: sorted(p.name for p in root.iterdir() if (p / 'SKILL.md').is_file())
                if root.is_dir() else [] for tool, root in roots.items()}
    tool, skill_id = payload.get('tool'), payload.get('id', '')
    if tool not in roots or not skill_id or len(skill_id) > 160 or skill_id.startswith('.') or any(
            not (c.isascii() and (c.isalnum() or c in '-_.')) for c in skill_id):
        raise ValueError('Skill 目录或工具无效')
    target = roots[tool] / skill_id
    records = (Path(managed_root) / 'skills-targets.json') if managed_root is not None else home / '.local/share/edge-ssh-ai/skills/targets.json'
    owned = json.loads(records.read_text('utf-8')) if records.exists() else {}
    key = str(target)

    def fingerprint(files):
        encoded = json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
        return hashlib.sha256(encoded).hexdigest()

    def read_files():
        files, size = {}, 0
        if target.is_symlink():
            raise ValueError('Skill 目录是外部符号链接，已保留')
        for root, dirs, names in os.walk(target, followlinks=False):
            for name in dirs + names:
                if (Path(root) / name).is_symlink():
                    raise ValueError('Skill 内含符号链接，已保留')
            for name in names:
                path = Path(root) / name
                with path.open('rb') as file:
                    data = file.read(32 * 1024 * 1024 + 1)
                size += len(data)
                if size > 32 * 1024 * 1024 or len(files) >= 2000:
                    raise ValueError('Skill 内容过大，已保留')
                files[path.relative_to(target).as_posix()] = base64.b64encode(data).decode()
        return files

    if operation == 'enable':
        if target.exists() or target.is_symlink():
            raise ValueError('同名 Skill 已存在，原目录已保留')
        files = payload.get('files', {})
        if 'SKILL.md' not in files or len(files) > 2000:
            raise ValueError('技能文件无效')
        roots[tool].mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix='.edge-skill-', dir=roots[tool]))
        try:
            size = 0
            for name, encoded in files.items():
                relative = Path(name)
                if not name or '\\' in name or ':' in name or relative.is_absolute() or '..' in relative.parts:
                    raise ValueError('技能文件路径无效')
                data = base64.b64decode(encoded, validate=True)
                size += len(data)
                if size > 32 * 1024 * 1024:
                    raise ValueError('Skill 内容超过 32 MiB')
                path = stage / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            stage.rename(target)
            owned[key] = fingerprint(files)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    elif operation == 'disable':
        if key not in owned:
            raise ValueError('此 Skill 来自工具原有目录，请自行管理，原文件已保留')
        if target.exists() or target.is_symlink():
            if fingerprint(read_files()) != owned[key]:
                raise ValueError('Skill 已被外部修改，已保留，请先备份并手动处理')
            shutil.rmtree(target)
        owned.pop(key)
    else:
        raise ValueError('未知技能操作')
    records.parent.mkdir(parents=True, exist_ok=True)
    temp = records.with_suffix('.tmp')
    temp.write_text(json.dumps(owned), 'utf-8')
    temp.replace(records)
    return {'message': '技能已启用' if operation == 'enable' else '技能已停用'}
