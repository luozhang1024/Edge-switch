"""API card actions and an independent modal editor."""
import tkinter as tk
from tkinter import ttk, messagebox
from PIL import Image, ImageOps
import uuid
import customtkinter as ctk

from workbench.core import ROOT, Board, Profile, protect
from workbench.ui import BLUE, INK, MUTED, image_asset, Tooltip, center_dialog


OFFICIAL_ID = 'openai-official'


class ApiManagement:
    def api_entry(self, entry_id):
        return next(e for e in self.store.api_entries(self.current) if e['id'] == entry_id)

    def api_key(self, entry_id):
        if entry_id == self.current.active_api:
            return self.key_var.get().strip()
        if entry_id in getattr(self, '_api_keys', {}):
            return self._api_keys[entry_id].strip()
        value = self.store.secrets.get(entry_id)
        return protect(value, decrypt=True) if value else ''

    def render_api_cards(self):
        if not hasattr(self, 'action_images'):
            self.action_images = {key: image_asset(name, (18, 18)) for key, name in {
                'add': '加.png', 'activate': '启用.png', 'edit': '编辑.png', 'login': 'chatgpt-ui.png',
                'test': '测试.png', 'verify': '验证.png', 'delete': '删除.png'}.items()}
            self.action_images['add'] = image_asset('加.png', (32, 32))
            bitmap = Image.open(ROOT / 'image/删除.png').convert('RGBA')
            disabled = ImageOps.grayscale(bitmap).convert('RGBA')
            disabled.putalpha(bitmap.getchannel('A').point(lambda x: round(x * .28)))
            self.action_images['delete_disabled'] = ctk.CTkImage(disabled, size=(18, 18))
            self.add_api_button.configure(text='', image=self.action_images['add'], width=40, height=40,
                                          fg_color='transparent', hover=False, corner_radius=0,
                                          border_width=0)
            self.add_api_button.tooltip = Tooltip(self.add_api_button, '添加')
        for widget in self.api_cards.winfo_children():
            widget.destroy()
        self.api_card_widgets = {}
        if not self.store.api_entries(self.current):
            ctk.CTkLabel(self.api_cards, text='可启用下方官方账号服务，或点击右上角加号添加 API。',
                         text_color=MUTED, font=('Microsoft YaHei UI', 12)).pack(pady=50)
        settings = self.official_settings()
        official = dict(id=OFFICIAL_ID, name=settings.get('name', 'OpenAI Official'),
                        base_url=settings.get('note') or 'ChatGPT 官方账号 · 使用账号套餐额度 · 无需 API Key')
        for entry in [official, *self.store.api_entries(self.current)]:
            eid = entry['id']
            is_official = eid == OFFICIAL_ID
            using = (self.current.codex_auth == 'chatgpt' and not settings.get('pending')) if is_official else self.current.codex_auth == 'api' and self.store.applied.get(self.current.id) == eid
            frame = ctk.CTkFrame(self.api_cards, fg_color='#EDF5FF' if using else 'white',
                                 corner_radius=15, border_width=1,
                                 border_color='#78B6FF' if using else '#E3E3E8', height=88)
            frame.pack(fill='x', pady=(0, 12))
            ctk.CTkLabel(frame, image=self.images['chatgpt'], text='', width=42).pack(side='left', padx=(18, 12), pady=22)
            text = ctk.CTkFrame(frame, fg_color='transparent')
            text.pack(side='left', fill='x', expand=True, pady=14)
            ctk.CTkLabel(text, text=entry['name'], text_color=INK, anchor='w',
                         font=('Microsoft YaHei UI', 14, 'bold')).pack(fill='x')
            ctk.CTkLabel(text, text=entry['base_url'], text_color=BLUE, anchor='w',
                         font=('Microsoft YaHei UI', 11), wraplength=390).pack(fill='x', pady=(2, 0))
            slot = ctk.CTkFrame(frame, fg_color='transparent', width=280, height=50)
            slot.pack(side='right', padx=(8, 16))
            slot.pack_propagate(False)
            actions = ctk.CTkFrame(slot, fg_color='transparent')
            enable = ctk.CTkButton(actions, text='使用中' if using else '启用',
                                   image=None if using else self.action_images['activate'],
                                   width=90, height=32, corner_radius=8,
                                   fg_color='#E6E8ED' if using else BLUE,
                                   text_color='#969BA4' if using else 'white',
                                   hover_color='#E6E8ED' if using else '#0066DD',
                                   state='disabled' if using else 'normal',
                                   command=lambda value=eid: self.guard(lambda: self.activate_api(value)))
            enable.pack(side='left', padx=(0, 8))
            enable.tooltip = Tooltip(enable, '启用')
            tools = ctk.CTkFrame(actions, fg_color='transparent')
            action_buttons = {}
            callbacks = [('edit', '编辑', lambda _: self.open_official_editor()),
                         ('test', '测试', lambda _: self.test_official()),
                         ('verify', '验证', lambda _: self.test_official(infer=True)),
                         ('delete', '删除', lambda _: None)] if is_official else [
                         ('edit', '编辑', self.open_api_editor), ('test', '测试', self.test_api_entry),
                         ('verify', '验证', lambda value: self.test_api_entry(value, infer=True)),
                         ('delete', '删除', self.delete_api)]
            for icon, label, callback in callbacks:
                button = ctk.CTkButton(tools, text='', image=self.action_images['delete_disabled'] if is_official and icon == 'delete' else self.action_images[icon], width=34, height=32,
                              corner_radius=7, fg_color='transparent', hover_color='#E2E8F0',
                              command=lambda value=eid, action=callback: self.guard(lambda: action(value)))
                if is_official and icon == 'delete':
                    button.configure(state='disabled', hover=False)
                button.pack(side='left', padx=2)
                button.tooltip = Tooltip(button, label)
                action_buttons[icon] = button
            tools.pack(side='left')
            def show(active, f=frame, box=actions, icons=tools, current=using):
                if not f.winfo_exists():
                    return
                if active:
                    icons.pack(side='left')
                    box.place(relx=1, rely=.5, anchor='e')
                elif current:
                    icons.pack(side='left')
                    box.place(relx=1, rely=.5, anchor='e')
                else:
                    box.place_forget()
            def leave(event=None, f=frame, show_actions=show):
                def check():
                    if not f.winfo_exists():
                        return
                    x, y = f.winfo_pointerxy()
                    inside = (f.winfo_rootx() <= x < f.winfo_rootx() + f.winfo_width() and
                              f.winfo_rooty() <= y < f.winfo_rooty() + f.winfo_height())
                    show_actions(inside)
                self.root.after(45, check)
            def bind_tree(widget, enter=show, exit_action=leave):
                widget.bind('<Enter>', lambda event=None: enter(True), add='+')
                widget.bind('<Leave>', exit_action, add='+')
                for child in widget.winfo_children():
                    bind_tree(child, enter, exit_action)
            bind_tree(frame)
            show(False)
            self.api_card_widgets[eid] = dict(frame=frame, actions=actions, enable=enable, tools=tools, hover=show, buttons=action_buttons)

    def activate_official(self, force_login=False):
        board = self.board()
        def commit(_=None):
            settings = self.store.official.setdefault(board.profile.id, {})
            settings['pending'] = False
            if force_login:
                settings.pop('credentials', None)
            self.vars['codex_auth'].set('chatgpt')
            self.save()
            self.status.set('使用中 · OpenAI Official · 已打开的 VS Code 请 Reload Window')
        if force_login:
            return self.login_chatgpt(on_success=commit)
        def task():
            self.prepare_official(board)
            return board.call('codex_auth_status')
        def done(result):
            if result.get('authenticated'):
                commit()
            else:
                self.open_official_editor()
                self.status.set('尚未登录 · 请在官方服务编辑窗口导入 auth.json 或点击账号登录')
        self.run('启用 OpenAI Official', task, done)

    def check_official(self):
        board = self.board()
        def done(result):
            messagebox.showinfo('OpenAI Official',
                '官方 ChatGPT 账号已登录。额度与推理可用性请在 Codex 中查看；本次未发送推理请求。'
                if result.get('authenticated') else '尚未登录官方 ChatGPT 账号。请点击官方卡片的“启用”或“登录”。')
        self.run('检查官方账号状态', lambda: board.call('codex_auth_status'), done)

    def service_board(self, entry):
        p = self.snapshot()
        for name in ('base_url', 'model', 'protocol'):
            setattr(p, name, entry[name])
        p.active_api = entry['id']
        return Board(p, self.store.scope(p))

    def activate_api(self, entry_id):
        if entry_id == OFFICIAL_ID:
            return self.activate_official()
        self.save()
        entry = dict(self.api_entry(entry_id))
        board = self.service_board(entry)
        if entry['protocol'] != 'responses':
            raise ValueError('Codex 启用需要 Responses 协议；Chat 服务可以保存和测试，Harness 请在其网页选择模型')
        if not entry['model'].strip():
            raise ValueError('请先点击编辑图标，填写模型 ID')
        key = self.api_key(entry_id)
        payload = dict(base_url=entry['base_url'], model=entry['model'], service_id=entry_id,
                       protocol=entry['protocol'])
        if key:
            payload['key'] = key
            self.validate_model(board, payload)
        else:
            payload.update(reuse=True, legacy_service=entry_id == self.current.id)
        def done(_):
            self.vars['codex_auth'].set('api')
            self.select_api(entry_id)
            self.store.applied[self.current.id] = entry_id
            self.store.save()
            self.render_api_cards()
            self.status.set('使用中 · ' + entry['name'] + ' · 已打开的 VS Code 请 Reload Window')
        self.run('启用 ' + entry['name'], lambda: board.call('configure_ide', project=board.profile.project,
                                                          **self.routed(board, payload)), done)

    def test_api_entry(self, entry_id, infer=False):
        self.save()
        entry = dict(self.api_entry(entry_id))
        key = self.api_key(entry_id)
        board = self.service_board(entry)
        payload = dict(base_url=entry['base_url'], model=entry['model'], protocol=entry['protocol'],
                       service_id=entry_id, legacy_service=entry_id == self.current.id)
        if key:
            payload['key'] = key
        else:
            payload['reuse'] = True
        if infer and key:
            self.validate_model(board, payload)
        elif infer and not entry['model'].strip():
            raise ValueError('请先填写模型 ID')
        if infer and not messagebox.askyesno('推理测试', '将发送少量模型请求，可能产生 API 费用。继续？'):
            return
        def done(result):
            if entry_id == self.current.active_api:
                self._model_check = self.model_signature()
                self.overview_vars['model'].set(('推理通过' if infer else '连通通过，推理未验证') if result.get('ok') else '检查未通过：' + result.get('message', '')[:100])
            if key and result.get('ok') and 'models' in result:
                self.catalogs[self.catalog_key(board, payload)] = result['models']
            message = result['message']
            if result.get('models'):
                message += '\n\n模型：' + '、'.join(result['models'][:20])
            (messagebox.showinfo if result.get('ok') else messagebox.showerror)(entry['name'], message)
        self.run('推理测试' if infer else 'API 连通性测试',
                 lambda: board.call('api_test', infer=infer, **self.routed(board, payload)), done)

    def open_api_editor(self, entry_id=None):
        if getattr(self, 'api_dialog', None) and self.api_dialog.winfo_exists():
            self.api_dialog.lift()
            return
        self.save()
        existing = dict(self.api_entry(entry_id)) if entry_id else dict(
            id=uuid.uuid4().hex, name='', base_url='https://api.openai.com/v1', model='', protocol='responses')
        dialog = ctk.CTkToplevel(self.root)
        self.api_dialog = dialog
        dialog.title('编辑 API' if entry_id else '添加 API')
        center_dialog(dialog, self.root, 590, 560)
        dialog.resizable(False, False)
        dialog.transient(self.root)
        dialog.configure(fg_color='#F5F5F7')
        body = ctk.CTkFrame(dialog, fg_color='white', corner_radius=16)
        body.pack(fill='both', expand=True, padx=22, pady=22)
        ctk.CTkLabel(body, text='编辑 API' if entry_id else '添加模型服务', text_color=INK,
                     font=('Microsoft YaHei UI', 21, 'bold')).pack(anchor='w', padx=24, pady=(22, 12))
        form = ctk.CTkFrame(body, fg_color='transparent')
        form.pack(fill='x', padx=24)
        form.columnconfigure(1, weight=1)
        values = {key: tk.StringVar(value=existing[key]) for key in ('name', 'base_url', 'model', 'protocol')}
        values['key'] = tk.StringVar(value=self.api_key(entry_id) if entry_id else '')
        remember = tk.BooleanVar(value=(existing['id'] in self.store.secrets or not self.api_key(entry_id)) if entry_id else True)
        for i, (key, label) in enumerate([('name', '服务名称'), ('base_url', 'API 地址'), ('model', '模型 ID'),
                                         ('protocol', 'API 协议'), ('key', 'API Key')]):
            ctk.CTkLabel(form, text=label, text_color=MUTED, width=85, anchor='w').grid(row=i, column=0, sticky='w', pady=9)
            if key == 'protocol':
                control = ctk.CTkOptionMenu(form, variable=values[key], values=['responses', 'chat'],
                                           fg_color='#F0F0F4', text_color=INK, button_color='#E3E3E8')
            elif key == 'model':
                board = self.service_board(existing)
                catalog = self.catalogs.get(self.catalog_key(board, dict(key=values['key'].get())), [])
                control = ttk.Combobox(form, textvariable=values[key], values=catalog)
            else:
                control = ctk.CTkEntry(form, textvariable=values[key], height=36,
                                       show='●' if key == 'key' else '', fg_color='#FAFAFC', border_color='#E3E3E8', text_color=INK)
            control.grid(row=i, column=1, sticky='ew', pady=9)
            if key == 'model':
                model_control = control
        def read_models():
            value = dict(existing, **{key: values[key].get().strip() for key in ('name', 'base_url', 'model', 'protocol')})
            key = values['key'].get().strip()
            if not key:
                raise ValueError('请先填写 API Key')
            board = self.service_board(value)
            payload = dict(base_url=value['base_url'], model=value['model'], protocol=value['protocol'], key=key)
            def done(result):
                if not dialog.winfo_exists():
                    return
                if result.get('ok'):
                    models = result.get('models', [])
                    model_control.configure(values=models)
                    self.catalogs[self.catalog_key(board, payload)] = models
                    hint.configure(text='已读取 %d 个模型，请从模型下拉框选择；尚未验证推理。' % len(models))
                else:
                    hint.configure(text=result.get('message', '读取失败'))
            self.run('读取模型', lambda: board.call('api_test', infer=False, **self.routed(board, payload)), done)
        ctk.CTkButton(form, text='读取', width=52, height=30, fg_color='#F0F0F4', text_color=INK,
                      command=lambda: self.guard(read_models)).grid(row=2, column=2, padx=(8, 0))
        ctk.CTkCheckBox(body, text='使用 Windows 加密保存 API Key', variable=remember, text_color=INK,
                        font=('Microsoft YaHei UI', 11)).pack(anchor='w', padx=24, pady=12)
        hint = ctk.CTkLabel(body, text='Codex 选择 Responses。保存后，将鼠标移至卡片点击“启用”。',
                            text_color=MUTED, font=('Microsoft YaHei UI', 11), wraplength=480)
        hint.pack(anchor='w', padx=24)
        footer = ctk.CTkFrame(body, fg_color='transparent')
        footer.pack(fill='x', padx=24, pady=(18, 20))
        def commit():
            if self.busy:
                return
            value = dict(existing, **{key: values[key].get().strip() for key in ('name', 'base_url', 'model', 'protocol')})
            self.save_api_entry(value, values['key'].get().strip(), remember.get())
            dialog.destroy()
        ctk.CTkButton(footer, text='保存', width=100, fg_color=BLUE,
                      command=lambda: self.guard(commit)).pack(side='right', padx=(10, 0))
        ctk.CTkButton(footer, text='取消', width=100, fg_color='#F0F0F4', text_color=INK,
                      command=dialog.destroy).pack(side='right')
        dialog.editor_values, dialog.editor_remember, dialog.commit = values, remember, commit
        self.root.after(100, lambda: dialog.grab_set() if dialog.winfo_exists() else None)

    def save_api_entry(self, value, key, remember):
        if not value['name'].strip():
            raise ValueError('请填写服务名称')
        p = self.snapshot()
        p.base_url, p.model, p.protocol = value['base_url'], value['model'], value['protocol']
        p.validate()
        if any(ord(c) < 32 for c in key):
            raise ValueError('API Key 含无效字符')
        entries = self.store.api_entries(self.current)
        previous = next((e for e in entries if e['id'] == value['id']), None)
        changed = previous is not None and (any(previous[k] != value[k] for k in ('base_url', 'model', 'protocol'))
                                            or self.api_key(value['id']) != key)
        if previous is None:
            entries.append(value)
        else:
            previous.update(value)
        if not hasattr(self, '_api_keys'):
            self._api_keys = {}
        self._api_keys[value['id']] = key
        if remember and key:
            self.store.secrets[value['id']] = protect(key)
        else:
            self.store.secrets.pop(value['id'], None)
        if changed and self.store.applied.get(self.current.id) == value['id']:
            self.store.applied.pop(self.current.id, None)
        if not self.current.active_api:
            self.current.active_api = value['id']
        if value['id'] == self.current.active_api:
            for name in ('base_url', 'model', 'protocol'):
                setattr(self.current, name, value[name])
        self.store.save()
        self.load()
        self.status.set('已保存 ' + value['name'] + ' · 点击卡片“启用”应用')
