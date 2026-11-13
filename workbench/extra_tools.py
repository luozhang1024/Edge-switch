"""Installation and isolated launch of additional coding agents."""
import json
import os
import shutil
import urllib.request


def kimi_inventory(root):
    from pathlib import Path
    current = root / 'tools/kimi/current.json'
    info = json.loads(current.read_text()) if current.is_file() else {}
    binary = info.get('binary') or shutil.which('kimi')
    return dict(id='kimi', installed=bool(binary and Path(binary).is_file()),
                version=info.get('version', ''), path=binary or '', managed=current.is_file(),
                can_remove=current.is_file(), can_upgrade=current.is_file() or not binary)


def manage_kimi(p, root, command, clean_env, private_write):
    operation = p['operation']
    if operation not in ('install', 'upgrade', 'uninstall'):
        raise ValueError('工具操作无效')
    uv = root / 'uv/uv'
    env = clean_env(p.get('proxy', ''))
    env.update(UV_TOOL_DIR=str(root / 'uv-tools'), UV_TOOL_BIN_DIR=str(root / 'bin'),
               UV_PYTHON_INSTALL_DIR=str(root / 'uv-python'))
    current = root / 'tools/kimi/current.json'
    if operation == 'uninstall':
        if not current.is_file():
            raise ValueError('不是当前环境的受管安装，保留原工具')
        command([str(uv), 'tool', 'uninstall', 'kimi-cli'], env, timeout=180)
        current.unlink()
    else:
        if not uv.is_file():
            root.mkdir(parents=True, exist_ok=True)
            handler = urllib.request.ProxyHandler({'http': p.get('proxy'), 'https': p.get('proxy')} if p.get('proxy') else {})
            with urllib.request.build_opener(handler).open('https://astral.sh/uv/install.sh', timeout=45) as response:
                installer = response.read(2 * 1024 * 1024)
            script = root / 'uv-install.sh'
            script.write_bytes(installer)
            install_env = dict(env, UV_INSTALL_DIR=str(root / 'uv'), UV_NO_MODIFY_PATH='1')
            command(['sh', str(script)], install_env, timeout=300)
        command([str(uv), 'tool', 'install', '--upgrade', '--python', '3.13', 'kimi-cli'], env, timeout=1800)
        binary = root / 'bin/kimi'
        version = command([str(binary), '--version'], env, timeout=30)
        private_write(current, json.dumps(dict(binary=str(binary), version=version)))
    return dict(message='Kimi Code 工具操作已完成')


def configure_extra(p, root, private_write):
    tool = p.get('tool')
    if tool not in ('kimi', 'grok', 'qwen', 'copilot'):
        raise ValueError('工具无效')
    config = dict(p)
    if not p.get('official'):
        if tool == 'copilot' or not all(p.get(k) for k in ('base_url', 'model', 'key')):
            raise ValueError('请配置供应商、模型和密钥；Copilot 使用 GitHub 账号')
        if tool == 'kimi':
            provider = 'anthropic' if p.get('protocol') == 'anthropic' else 'openai_legacy'
            text = 'default_model = "edge-switch"\n[providers.edge-switch]\n'
            text += '\n'.join(k + ' = ' + json.dumps(v) for k, v in dict(type=provider, base_url=p['base_url'], api_key=p['key']).items())
            text += '\n[models.edge-switch]\nprovider = "edge-switch"\nmodel = ' + json.dumps(p['model']) + '\nmax_context_size = 32768\n'
            private_write(root / 'extra-kimi/edge-api.toml', text)
        elif tool == 'qwen':
            path = root / 'extra-qwen/.qwen/settings.json'
            value = json.loads(path.read_text()) if path.is_file() else {}
            value.setdefault('security', {}).setdefault('auth', {})['selectedType'] = 'openai'
            value.setdefault('model', {})['name'] = p['model']
            models = value.setdefault('modelProviders', {}).setdefault('openai', [])
            value['modelProviders']['openai'] = [m for m in models if m.get('envKey') != 'EDGE_QWEN_API_KEY'] + [dict(id=p['model'], baseUrl=p['base_url'], envKey='EDGE_QWEN_API_KEY')]
            private_write(path, json.dumps(value))
    elif tool == 'qwen':
        path = root / 'extra-qwen/.qwen/settings.json'
        value = json.loads(path.read_text()) if path.is_file() else {}
        value.setdefault('security', {}).setdefault('auth', {})['selectedType'] = 'qwen-oauth'
        private_write(path, json.dumps(value))
    private_write(root / ('extra-' + tool + '/launch.json'), json.dumps(config))
    return dict(message='已同步当前环境的工具配置')


def official_config(p, root, private_write):
    import hashlib
    paths = {'codex': 'codex-chatgpt-home/config.toml', 'claude': 'claude-official-home/settings.json'}
    if p.get('tool') not in paths:
        raise ValueError('工具无效')
    path = root / paths[p['tool']]
    text = path.read_text() if path.is_file() else ('' if p['tool'] == 'codex' else '{}')
    if len(text.encode()) > 1024 * 1024:
        raise ValueError('配置不能超过 1 MiB')
    revision = hashlib.sha256(text.encode()).hexdigest()
    if p.get('operation') == 'write':
        if p.get('expected') != revision:
            raise ValueError('配置已被外部修改，请重新打开')
        if path.is_file():
            import time
            private_write(path.with_name(path.name + '.edge-switch-' + str(time.time_ns()) + '.bak'), text)
        text = p['config']
        if p['tool'] == 'codex':
            text = 'forced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\n' + text
        private_write(path, text)
    return dict(config=text, revision=hashlib.sha256(text.encode()).hexdigest(), path=str(path))


EXTRA_LAUNCHER = '''import json, os, sys
from pathlib import Path
root = Path(__file__).resolve().parent
tool, proxy = sys.argv[1:3]
if tool not in ('kimi','grok','qwen','copilot'):
    raise SystemExit('Invalid tool')
record = root / 'tools' / tool / 'current.json'
if not record.is_file():
    raise SystemExit('Please install this tool for the current workspace first')
binary = json.loads(record.read_text())['binary']
env = os.environ.copy()
for name in ('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'):
    env.pop(name, None)
if proxy:
    env.update(HTTP_PROXY=proxy, HTTPS_PROXY=proxy)
env['PATH'] = str(root / 'runtime/bin') + os.pathsep + env.get('PATH','')
config = root / ('extra-' + tool)
config.mkdir(parents=True, exist_ok=True)
env.update(XDG_CONFIG_HOME=str(config / 'config'), XDG_DATA_HOME=str(config / 'data'),
           HOME=str(config),
           KIMI_SHARE_DIR=str(config / '.kimi'))
launch = config / 'launch.json'
p = json.loads(launch.read_text()) if launch.is_file() else {}
args = []
if not p.get('official', True):
    if tool == 'kimi':
        args += ['--config-file', str(config / 'edge-api.toml')]
    elif tool == 'grok':
        env.update(GROK_API_KEY=p['key'], GROK_BASE_URL=p['base_url'], GROK_MODEL=p['model'])
    elif tool == 'qwen':
        env.update(EDGE_QWEN_API_KEY=p['key'], OPENAI_API_KEY=p['key'], OPENAI_BASE_URL=p['base_url'], OPENAI_MODEL=p['model'])
if tool == 'kimi':
    prompt = config / 'AGENTS.md'
    if prompt.is_file() and prompt.read_text().strip():
        agent = config / 'edge-agent.json'
        agent.write_text(json.dumps({'version':1,'agent':{'extend':'default','system_prompt_args':{'ROLE_ADDITIONAL':prompt.read_text()}}}))
        args += ['--agent-file', str(agent)]
elif tool == 'grok':
    directory = config / '.grok'
    directory.mkdir(parents=True, exist_ok=True)
    prompt = directory / 'edge-switch-prompt.md'
    text = prompt.read_text() if prompt.is_file() else ''
    for skill in sorted((directory / 'skills').glob('*/SKILL.md')):
        text += '\\n\\n## Skill: ' + str(skill) + '\\n' + skill.read_text()
    target = directory / 'GROK.md'
    original = target.read_text() if target.is_file() else ''
    begin, end = '<!-- edge-switch:start -->', '<!-- edge-switch:end -->'
    preserved = original
    if begin in original:
        prefix, tail = original.split(begin, 1)
        if end not in tail:
            raise SystemExit('GROK.md has an incomplete Edge Switch block; original retained')
        preserved = prefix + tail.split(end, 1)[1]
    updated = preserved.rstrip() + ('\\n\\n' + begin + '\\n' + text + '\\n' + end if text.strip() else '')
    if updated != original:
        if target.is_file():
            import time
            target.with_name('GROK.edge-switch-' + str(time.time_ns()) + '.bak').write_text(original)
        target.write_text(updated)
os.execvpe(binary,[binary] + args + sys.argv[3:],env)
'''
