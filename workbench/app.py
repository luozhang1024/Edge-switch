import json
import os
import queue
import subprocess
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox
import webbrowser
import uuid
import customtkinter as ctk

from workbench.core import Board, DATA, PersistentHarness, Profile, Store, connect_proxy, open_vscode, protect, validate_model_selection
from workbench.layout import Layout
from workbench.api_ui import ApiManagement
from workbench.official_ui import OfficialManagement
from workbench.environment_ui import EnvironmentManagement
from workbench.versions import fetch_versions


class App(EnvironmentManagement, OfficialManagement, ApiManagement, Layout):
    def guard(self, action):
        if self.busy:
            return
        try:
            action()
        except Exception as exc:
            messagebox.showerror('操作未完成', self.redact(str(exc)))

    def redact(self, text):
        key = self.key_var.get()
        return text.replace(key, '[已隐藏]') if key else text

    def log(self, text):
        self.events.put(('log', str(text)))

    def run(self, label, task, done=None):
        self.busy = True
        self.task_label = label
        self.task_started = time.monotonic()
        self.status.set(label + '…')
        for b in self.buttons:
            b.configure(state='disabled')
        def worker():
            try:
                value = task()
                self.events.put(('done', (label, value, done)))
            except Exception as exc:
                self.events.put(('error', (label, str(exc))))
        threading.Thread(target=worker, daemon=True).start()

    def poll(self):
        while True:
            try:
                kind, value = self.events.get_nowait()
            except queue.Empty:
                break
            if kind == 'log':
                self.logbox.configure(state='normal')
                self.logbox.insert('end', self.redact(value) + '\n')
                self.logbox.see('end')
                self.logbox.configure(state='disabled')
            elif kind == 'versions':
                result, route = value
                self._versions_loading = False
                if result.get('ok') is False:
                    self.version_status.set(result['message'])
                else:
                    self._version_catalog = result
                    self._version_stamp = time.time()
                    self.apply_versions(result)
                    self.version_status.set('版本列表已更新，可下拉选择；其他功能可正常使用。')
                    try:
                        path = self.store.directory / 'versions-cache.json'
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text(json.dumps(dict(time=self._version_stamp, data=result)), encoding='utf-8')
                    except OSError:
                        pass
            elif kind == 'tray':
                if value == 'show':
                    self.root.deiconify()
                    self.root.lift()
                elif value == 'quit':
                    self.quit_app()
            else:
                self.busy = False
                for b in self.buttons:
                    b.configure(state='normal')
                if kind == 'error':
                    label, error = value
                    self.status.set(label + '未完成')
                    self.log(label + '：' + error)
                    messagebox.showerror(label + '未完成', self.redact(error))
                else:
                    label, result, done = value
                    failed = isinstance(result, dict) and result.get('ok') is False
                    self.status.set(label + ('未通过' if failed else '已完成'))
                    self.log(label + '：' + (json.dumps(result, ensure_ascii=False, indent=2) if isinstance(result, (dict, list)) else str(result or '完成')))
                    if done:
                        self.guard(lambda: done(result))
        tunnel = self.tunnels.get(self.current.id)
        self.net_status.set('板卡端口 %d · %s' % (tunnel.port, tunnel.state) if tunnel else '代理：未连接')
        session = self.sessions.get(self.current.id)
        if session:
            self.overview_vars['harness'].set('后台运行 · ' + session.state if session.background else '随工作台运行 · ' + session.state)
        if getattr(self, '_model_check', None) and self._model_check != self.model_signature():
            self.overview_vars['model'].set('配置已变化，请重新测试')
        if self.busy:
            self.status.set('%s… 已运行 %d 秒' % (self.task_label, time.monotonic() - self.task_started))
        self.root.after(150, self.poll)

    def refresh_picker(self):
        self.current_environment.set(self.current.name + '  ·  ' + self.current.user + '@' + self.current.host)

    def load(self):
        self._loading = True
        if getattr(self, '_save_after', None):
            self.root.after_cancel(self._save_after)
            self._save_after = None
        entries = self.store.api_entries(self.current)
        entry = next((x for x in entries if x['id'] == self.current.active_api), None)
        self.api_name.set(entry['name'] if entry else '')
        self._model_check = None
        for var in self.overview_vars.values():
            var.set('尚未检查（请刷新设备）')
        self.overview_vars['device'].set(self.current.user + '@' + self.current.host)
        self.overview_vars['model'].set('未测试（在“模型服务”中验证）')
        self.overview_vars['network'].set('Codex：%s / Harness：%s' % tuple('电脑代理' if self.current.uses_proxy(t) else '板卡直连' for t in ('codex', 'harness')))
        self.model_picker['values'] = []
        for key, var in self.vars.items():
            var.set(getattr(self.current, key))
        if getattr(self, '_version_catalog', None):
            self.apply_versions(self._version_catalog)
        else:
            for tool, picker in self.version_pickers.items():
                current = self.vars[tool + '_version'].get()
                picker['values'] = [current] if current else []
        try:
            memory = getattr(self, '_api_keys', {})
            self.key_var.set(memory.get(self.store.secret_id(self.current), self.store.key(self.current)))
            self.remember.set(self.store.secret_id(self.current) in self.store.secrets)
        except Exception:
            self.key_var.set('')
            self.remember.set(False)
            self.log('无法解密已保存凭据，请重新输入 API Key')
        self.render_api_cards()
        self.render_environment_cards()
        self._loading = False

    def schedule_save(self, *args):
        if getattr(self, '_loading', False):
            return
        if getattr(self, '_save_after', None):
            self.root.after_cancel(self._save_after)
        self.save_state.set('等待保存…')
        self._save_after = self.root.after(700, self.auto_save)

    def auto_save(self):
        self._save_after = None
        if self.busy:
            self._save_after = self.root.after(500, self.auto_save)
            return
        try:
            self.save()
        except Exception as exc:
            self.save_state.set('未保存 · 请检查配置')
            self.status.set('自动保存未完成：' + self.redact(str(exc)))

    def snapshot(self):
        value = dict(vars(self.current))
        for key, var in self.vars.items():
            value[key] = var.get()
        value['port'], value['proxy_port'] = int(value['port']), int(value['proxy_port'])
        profile = Profile(**value)
        profile.validate()
        return profile

    def save(self):
        p = self.snapshot()
        if any(getattr(p, name) != getattr(self.current, name) for name in
               ('host', 'port', 'user', 'identity', 'project', 'codex_proxy', 'proxy_port')):
            self.store.applied.pop(p.id, None)
        index = self.store.profiles.index(self.current)
        self.store.profiles[index] = p
        self.current = p
        self.store.selected_profile = p.id
        entries = self.store.api_entries(p)
        entry = next((x for x in entries if x['id'] == p.active_api), None)
        if entry:
            entry.update(name=self.api_name.get().strip() or '未命名 API', base_url=p.base_url, model=p.model, protocol=p.protocol)
        secret_id = self.store.secret_id(p)
        if not hasattr(self, '_api_keys'):
            self._api_keys = {}
        self._api_keys[secret_id] = self.key_var.get()
        if entry and self.remember.get() and self.key_var.get():
            self.store.secrets[secret_id] = protect(self.key_var.get())
        else:
            self.store.secrets.pop(secret_id, None)
        self.store.save()
        self.refresh_picker()
        self.render_api_cards()
        self.render_environment_cards()
        self.save_state.set('已自动保存')
        return p

    def render_api_cards(self):
        return ApiManagement.render_api_cards(self)

    def select_api(self, entry_id):
        self.save()
        entry = next(x for x in self.store.api_entries(self.current) if x['id'] == entry_id)
        self.current.active_api = entry_id
        for name in ('base_url', 'model', 'protocol'):
            setattr(self.current, name, entry[name])
        self.store.save()
        self.load()
        self.status.set('已选择 ' + entry['name'] + ' · 点击同步后应用到 Codex')

    def add_api(self):
        self.open_api_editor()

    def delete_api(self, entry_id):
        self.save()
        entries = self.store.api_entries(self.current)
        entry = next(x for x in entries if x['id'] == entry_id)
        if not messagebox.askyesno('删除 API', '删除“%s”的本机配置及保存密钥？板卡当前配置会保留，直到再次同步。' % entry['name']):
            return
        if self.current.active_api == entry_id:
            if len(entries) > 1:
                self.select_api(next(x['id'] for x in entries if x['id'] != entry_id))
            else:
                self.current.active_api = ''
                self.current.base_url = 'https://api.openai.com/v1'
                self.current.model = ''
                self.current.protocol = 'responses'
        entries.remove(entry)
        if self.store.applied.get(self.current.id) == entry_id:
            self.store.applied.pop(self.current.id, None)
        self.store.secrets.pop(entry_id, None)
        self._api_keys.pop(entry_id, None)
        self.store.save()
        self.load()

    def save_clicked(self):
        self.save()
        self.log('配置已保存：' + str(self.store.path))

    def new(self):
        self.open_environment_editor()

    def choose_identity(self):
        filename = filedialog.askopenfilename(title='选择 SSH 私钥')
        if filename:
            self.vars['identity'].set(filename)

    def board(self):
        p = self.save()
        return Board(p, self.store.scope(p))

    def diagnose(self):
        board = self.board()
        def done(info):
            self.overview_vars['device'].set('%s@%s · %s / %s' % (board.profile.user, board.profile.host, info['arch'], info['libc']))
            self.overview_vars['resources'].set('可用内存 %s MB / %s MB · 磁盘剩余 %s MB' % (info['memory_mb'].get('MemAvailable', '?'), info['memory_mb'].get('MemTotal', '?'), info['disk_free_mb']))
            self.overview_vars['tools'].set('Codex %s · Harness %s · API %s' % ('已安装' if info['codex'] else '未安装', '已安装' if info['harness'] else '未安装', '已配置' if info.get('codex_configured') else '未配置'))
            service = info.get('harness_service', {})
            self.overview_vars['harness'].set(('后台运行' if service.get('background') else '随工作台运行') + (' · 网页已就绪' if service.get('ready') else ' · 启动中') if service.get('running') else '未运行')
            self.overview_vars['network'].set('Codex：%s / Harness：%s' % tuple('电脑代理' if board.profile.uses_proxy(t) else '板卡直连' for t in ('codex', 'harness')))
            self.overview_vars['updated'].set(time.strftime('%Y-%m-%d %H:%M:%S') + ' · 手动刷新')
            self.log('SSH 登录正常；%s / %s；可用内存 %s MB，磁盘 %s MB。' %
                     (info['arch'], info['libc'], info['memory_mb'].get('MemAvailable', '?'), info['disk_free_mb']))
            if info['shell_proxy_files']:
                self.log('发现原有 Shell 中的 7890 代理配置；独立工具会覆盖自己的网络环境，原配置保持不变。')
            self.log('独立工具：Codex %s，Harness %s。' %
                     ('已安装' if info['codex'] else '未安装', '已安装' if info['harness'] else '未安装'))
        self.run('只读诊断', lambda: board.call('diagnose'), done)

    def ssh_console(self):
        self.board().console()

    def vscode(self):
        board = self.board()
        api = None
        if board.profile.codex_auth == 'chatgpt':
            api = dict(auth_mode='chatgpt')
            self.log('使用官方 ChatGPT 登录；不需要 API Key。首次使用请先点击“登录 ChatGPT”。')
        elif self.key_var.get().strip():
            if board.profile.protocol != 'responses':
                raise ValueError('同步 Codex 插件需要 Responses 协议，请在“模型服务”修改')
            api = self.api_payload(board)
            self.validate_model(board, api)
            self.log('正在安装／检查远程 Codex 扩展，同步 API 配置并验证登录状态…')
        else:
            self.log('未填写新密钥；若板卡保存了此环境的 Codex 配置，将复用密钥同步插件。')
        self.run('同步并打开 VS Code' if api else '打开 VS Code',
                 lambda: open_vscode(board, DATA / 'vscode' / board.scope, api=self.routed(board, api) if api else None, proxy=self.proxy_url(board)))

    def sync_api(self):
        board = self.board()
        if board.profile.codex_auth == 'chatgpt':
            raise ValueError('当前 Codex 使用官方 ChatGPT 账号；使用 API 请在 AI 工具中切换为 API')
        if board.profile.protocol != 'responses':
            raise ValueError('Codex 需要 Responses 协议；Chat API 可以保存和测试，不能直接用于 Codex')
        if not board.profile.model.strip():
            raise ValueError('请先填写模型 ID')
        if self.key_var.get().strip():
            payload = self.api_payload(board)
            self.validate_model(board, payload)
        else:
            payload = dict(reuse=True, base_url=board.profile.base_url, model=board.profile.model,
                           service_id=board.profile.active_api,
                           legacy_service=board.profile.active_api == board.profile.id)
        def done(_):
            self.status.set('已同步到 Codex · 已打开的 VS Code 请执行 Reload Window，新终端重新打开')
            self.log('已验证扩展 CLI 的 API 登录。已运行的插件和终端需重载后使用新配置。')
        self.run('同步 API 到 Codex', lambda: board.call('configure_ide', project=board.profile.project,
                                                       **self.routed(board, payload)), done)

    def proxy_url(self, board, tool='codex'):
        # Called only in worker threads: establishing SSH must never block Tk.
        if not board.profile.uses_proxy(tool):
            return ''
        entry = self.tunnels.get(board.profile.id)
        signature = (board.profile.host, board.profile.port, board.profile.user, board.profile.identity, board.profile.proxy_port)
        if entry and entry.signature != signature:
            raise ValueError('代理连接设置已改变，请先断开旧连接')
        if not entry:
            entry = connect_proxy(board, self.log)
            self.tunnels[board.profile.id] = entry
        if not entry.alive:
            raise ValueError('代理正在恢复，请检查本机代理并稍后重试')
        return 'http://127.0.0.1:' + str(entry.port)

    def start_tunnel(self):
        board = self.board()
        old = self.tunnels.get(board.profile.id)
        if old:
            raise ValueError('已有隧道；如需修改连接，请先停止旧隧道')
        def task():
            tunnel = connect_proxy(board, self.log)
            self.tunnels[board.profile.id] = tunnel
            return '独立代理端口：' + str(tunnel.port)
        self.run('启动代理隧道', task)

    def stop_tunnel(self):
        tunnel = self.tunnels.pop(self.current.id, None)
        if tunnel:
            self.run('停止隧道', tunnel.close)

    def api_payload(self, board):
        key = self.key_var.get().strip()
        if not key or any(ord(c) < 32 for c in key):
            raise ValueError('请输入有效 API Key')
        return dict(base_url=board.profile.base_url, model=board.profile.model, key=key,
                    protocol=board.profile.protocol, service_id=board.profile.active_api)

    def routed(self, board, payload):
        return dict(payload, proxy=self.proxy_url(board))

    def test_api(self, infer):
        board = self.board()
        payload = self.api_payload(board)
        signature = self.model_signature()
        if infer:
            self.validate_model(board, payload)
        if infer and not messagebox.askyesno('最小推理测试', '将从板卡发送一条短请求，可能产生少量 API 费用。继续？'):
            return
        self.log('请求线路：%s；接口：%s；协议：%s%s' %
                 ('独立代理' if board.profile.uses_proxy('codex') else '板卡直连', board.profile.base_url,
                  board.profile.protocol, '；模型：' + board.profile.model if infer else ''))
        if infer and board.profile.protocol == 'chat':
            self.log('提示：当前在验证 Chat Completions；独立 Codex 使用的是 Responses 协议。')
        def done(result):
            self._model_check = signature
            self.overview_vars['model'].set(('推理通过' if infer else '列表可读，推理未验证') if result.get('ok') else '检查未通过：' + result.get('message', '')[:140])
            if result.get('ok') and 'models' in result:
                self.model_picker['values'] = result['models']
                self.catalogs[self.catalog_key(board, payload)] = result['models'] if not result.get('truncated') else []
                self.log('可在“模型名称”下拉框选择供应商返回的准确模型 ID。')
                if board.profile.model and result['models'] and board.profile.model not in result['models']:
                    self.log('当前模型“%s”未出现在列表中；请先改为下拉框中的准确 ID，再测试推理。' % board.profile.model)
                    messagebox.showwarning('请重新选择模型', '模型列表已读取，但当前“%s”不在列表中。\n请从“模型名称”下拉框选择准确 ID，例如 gpt-6.1-sol（若列表包含）。\n模型列出仍不保证当前供应商渠道可用。' % board.profile.model)
                    self.model_picker.focus_set()
                    return
            (messagebox.showinfo if result['ok'] else messagebox.showerror)('测试结果', result['message'])
        self.run('推理测试' if infer else '模型列表检查', lambda: board.call('api_test', infer=infer, **self.routed(board, payload)),
                 done)

    def model_signature(self):
        import hashlib
        return tuple(self.vars[k].get() for k in ('host', 'port', 'user', 'base_url', 'model', 'protocol', 'codex_proxy', 'proxy_port')) + (hashlib.sha256(self.key_var.get().encode()).hexdigest(),)

    def catalog_key(self, board, payload):
        import hashlib
        return (board.profile.id, board.profile.base_url.rstrip('/'),
                hashlib.sha256(payload['key'].encode()).hexdigest())

    def validate_model(self, board, payload):
        validate_model_selection(board.profile.model, self.catalogs.get(self.catalog_key(board, payload)))

    def runtime(self):
        board = self.board()
        self.run('安装独立 Node.js', lambda: board.install_runtime(self.log))

    def page_changed(self, index):
        if index == 2:
            self.root.after_idle(self.ensure_versions)

    def ensure_versions(self):
        if self.notebook.active != 2:
            return
        if not getattr(self, '_cache_loaded', False):
            self._cache_loaded = True
            try:
                cached = json.loads((self.store.directory / 'versions-cache.json').read_text(encoding='utf-8'))
                self._version_catalog, self._version_stamp = cached['data'], cached['time']
                self.apply_versions(self._version_catalog)
                self.version_status.set('已加载缓存版本，可直接选择安装。')
            except (OSError, ValueError, KeyError, TypeError):
                pass
        route = (self.vars['proxy'].get(), self.vars['proxy_port'].get())
        if time.time() - getattr(self, '_version_stamp', 0) < 86400:
            return
        if getattr(self, '_versions_route', None) != route:
            self.versions()

    def apply_versions(self, result):
        for tool in ('codex', 'harness'):
            options = list(result[tool]['versions'])
            current = self.vars[tool + '_version'].get()
            if current and current not in options:
                options.append(current)
            self.version_pickers[tool]['values'] = options
            if not current:
                self.vars[tool + '_version'].set(result[tool]['latest'])

    def versions(self):
        if getattr(self, '_versions_loading', False):
            return
        p = self.snapshot()
        route = (p.proxy, str(p.proxy_port))
        self._versions_route = route
        self._versions_loading = True
        self.version_status.set('后台更新版本中，可继续使用其他功能…')
        def task():
            try:
                return fetch_versions(p.proxy, p.proxy_port)
            except Exception:
                return dict(ok=False, message='版本列表读取失败，请检查电脑网络或下载代理，再点击“刷新可选版本”。已保存版本仍可安装。')
        def worker():
            self.events.put(('versions', (task(), route)))
        threading.Thread(target=worker, daemon=True).start()

    def install(self, tool):
        board = self.board()
        version = getattr(board.profile, tool + '_version')
        if not version:
            raise ValueError('请先查询或填写明确版本号')
        self.log('首次安装可能需要数分钟；依赖较多时最多等待 30 分钟。成功后才切换当前版本。')
        self.run('安装 ' + tool, lambda: board.call('install_tool', timeout=1860, tool=tool, version=version, proxy=self.proxy_url(board, tool)))

    def login_chatgpt(self, on_success=None):
        board = self.board()
        def task():
            board.call('configure', auth_mode='chatgpt', project=board.profile.project, proxy=self.proxy_url(board))
            process = board.console('python3 ~/.local/share/edge-ssh-ai/' + board.scope + '/run-codex.py login --device-auth')
            try:
                status = process.wait(timeout=600)
            except subprocess.TimeoutExpired:
                process.terminate()
                raise RuntimeError('ChatGPT 授权超时，请重新点击登录') from None
            if status:
                raise RuntimeError('ChatGPT 授权未完成；请检查终端提示、账号权限及 Codex 网络线路。可在官方账号安全设置中启用设备码登录后重试。')
            if not board.call('codex_auth_status')['authenticated']:
                raise RuntimeError('尚未确认 ChatGPT 登录，请重新授权')
            return '已确认 ChatGPT 登录；可以打开 Codex 终端或 VS Code。'
        self.log('请在弹出的终端查看官方授权网址与设备码，在电脑浏览器完成授权；请勿向他人发送设备码。')
        self.run('等待 ChatGPT 授权（请查看终端）', task, on_success)

    def codex(self):
        board = self.board()
        if board.profile.codex_auth == 'chatgpt':
            self.run('配置官方 Codex',
                     lambda: board.call('configure', auth_mode='chatgpt', project=board.profile.project, proxy=self.proxy_url(board)),
                     lambda _: board.console('python3 ~/.local/share/edge-ssh-ai/' + board.scope + '/run-codex.py'))
            return
        if board.profile.protocol != 'responses':
            raise ValueError('此 Codex 适配器需要 Responses API；请配置对应的供应商和模型')
        if not board.profile.model:
            raise ValueError('请填写模型名称')
        payload = self.api_payload(board)
        self.validate_model(board, payload)
        def done(result):
            board.console('python3 ~/.local/share/edge-ssh-ai/' + board.scope + '/run-codex.py')
        self.run('配置独立 Codex', lambda: board.call('configure', project=board.profile.project, **self.routed(board, payload)), done)

    def harness(self, mode=None):
        board = self.board()
        old = self.sessions.get(board.profile.id)
        def task():
            info = board.call('harness_status', include_token=True)
            if mode == 'restart':
                if old:
                    old.detach()
                board.call('harness_stop', timeout=30)
                info = dict(running=False)
            if info['running']:
                # Opening a browser is an attach operation. Never restart a job implicitly.
                same_project = os.path.normpath(info['project']) == os.path.normpath(board.profile.project)
                uses_proxy = board.profile.uses_proxy('harness')
                same_route = bool(info.get('proxy')) == uses_proxy
                if uses_proxy and info.get('proxy'):
                    try:
                        self.proxy_url(board, 'harness')
                    except Exception as exc:
                        self.log('Harness 网页可以打开，但电脑代理暂不可用：' + str(exc))
                tunnel = self.tunnels.get(board.profile.id)
                if uses_proxy and tunnel:
                    same_route = same_route and info.get('proxy') == 'http://127.0.0.1:' + str(tunnel.port)
                if mode != 'attach' and (not same_project or not same_route):
                    return dict(conflict=True, project=info['project'], requested=board.profile.project,
                                route='电脑代理' if info.get('proxy') else '板卡直连',
                                requested_route='电脑代理' if uses_proxy else '板卡直连')
                if old and old.alive and old.remote_pid == info['pid']:
                    return '已接回现有 Harness 网页'
                if old:
                    old.detach()
                session = PersistentHarness(board, log=self.log, existing=info)
                self.sessions[board.profile.id] = session
                return '已接回现有 Harness 网页；工程：' + info['project']
            proxy = self.proxy_url(board, 'harness')
            if old:
                old.detach()
            session = PersistentHarness(board, proxy, self.log)
            self.sessions[board.profile.id] = session
            return 'Harness 网页已就绪'
        def done(result):
            if isinstance(result, dict) and result.get('conflict'):
                choice = messagebox.askyesnocancel('Harness 已在后台运行',
                    '现有工程：%s\n当前配置：%s\n现有网络：%s；当前配置：%s\n\n'
                    '是：打开现有服务，保留任务\n否：停止现有服务，按当前配置重新启动（会中断任务）\n取消：暂不打开' %
                    (result['project'], result['requested'], result['route'], result['requested_route']))
                if choice is not None:
                    self.harness('attach' if choice else 'restart')
                return
            webbrowser.open(self.sessions[board.profile.id].url)
        self.run('打开 Harness', task, done)

    def stop_harness(self):
        board = self.board()
        def task():
            session = self.sessions.pop(board.profile.id, None)
            if session:
                session.detach()
            return board.call('harness_stop', timeout=30)
        self.run('停止 Harness', task, lambda _: self.overview_vars['harness'].set('已停止'))

    def close(self):
        try:
            if not getattr(self, 'tray', None):
                from workbench.tray import Tray
                self.tray = Tray(self.events)
            self.root.withdraw()
        except Exception as exc:
            messagebox.showerror('托盘不可用', '窗口保持打开，请使用“退出程序”关闭。' + str(exc))

    def quit_app(self):
        if self.busy:
            messagebox.showinfo('任务进行中', '请等待当前任务结束后关闭，避免安装中断。')
            return
        try:
            self.save()
        except Exception as exc:
            self.log('未保存未完成的配置：' + str(exc))
        def stop_all():
            for item in list(self.sessions.values()) + list(self.tunnels.values()):
                item.close()
        def done(_):
            if getattr(self, 'tray', None):
                self.tray.close()
            self.root.destroy()
        self.run('关闭受管连接', stop_all, done)


def main():
    # One controller per Windows user: stable workspace IDs must not have two owners.
    import msvcrt
    import ctypes
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('EdgeSSHAI.Workbench')
    DATA.mkdir(parents=True, exist_ok=True)
    lock = (DATA / 'workbench.lock').open('a+b')
    if lock.seek(0, os.SEEK_END) == 0:
        lock.write(b'0')
        lock.flush()
    lock.seek(0)
    root = tk.Tk()
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        root.withdraw()
        messagebox.showinfo('工作台已运行', '请在任务栏右侧系统托盘（含隐藏图标区域）双击 Edge AI，或右键选择“打开工作台”。')
        root.destroy()
        lock.close()
        return
    App(root)
    try:
        root.mainloop()
    finally:
        lock.close()


if __name__ == '__main__':
    main()
