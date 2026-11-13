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
           KIMI_HOME=str(config / 'kimi'), GROK_CONFIG_DIR=str(config / 'grok'),
           QWEN_CODE_HOME=str(config / 'qwen'), COPILOT_HOME=str(config / 'copilot'))
os.execvpe(binary,[binary],env)
'''
