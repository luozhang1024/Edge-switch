"""Official account settings and credential import, separate from custom API keys."""
import json
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox
import customtkinter as ctk
from workbench.core import protect, validate_url
from workbench.remote_agent import parse_official_auth
from workbench.ui import BLUE, INK, MUTED, center_dialog


class OfficialManagement:
    def official_settings(self):
        return self.store.official.get(self.current.id, {})

    def official_auth_payload(self, profile_id):
        value = self.store.official.get(profile_id, {}).get('credentials')
        if not value:
            return None
        try:
            return protect(value, decrypt=True)
        except Exception:
            raise ValueError('无法解密已导入的官方凭据，请编辑官方卡片重新导入 auth.json') from None

    def prepare_official(self, board):
        payload = self.official_auth_payload(board.profile.id)
        if payload:
            board.call('import_official_auth', auth_json=payload)
        board.call('configure', project=board.profile.project, auth_mode='chatgpt', proxy=self.proxy_url(board))

    def test_official(self, infer=False):
        board = self.board()
        if infer and not messagebox.askyesno('验证官方推理', '将通过官方 Codex 发送一条短请求，消耗少量账号额度。继续？'):
            return
        def task():
            payload = self.official_auth_payload(board.profile.id)
            if payload:
                board.call('import_official_auth', auth_json=payload)
            return board.call('official_test', infer=infer, proxy=self.proxy_url(board), timeout=100)
        def done(result):
            (messagebox.showinfo if result.get('ok') else messagebox.showerror)('OpenAI Official', result['message'])
        self.run('验证官方推理' if infer else '测试官方服务', task, done)

    def save_official_settings(self, value, auth_text):
        name = value['name'].strip()
        if not name:
            raise ValueError('请填写供应商名称')
        url = validate_url(value['website'].strip())
        auth = parse_official_auth(auth_text.strip() or '{}')
        settings = dict(self.official_settings(), name=name, note=value['note'].strip(), website=url)
        if auth is not None:
            serialized = json.dumps(auth, sort_keys=True, separators=(',', ':'))
            settings['credentials'] = protect(serialized)
            settings['pending'] = True
        self.store.official[self.current.id] = settings
        self.store.save()
        self.render_api_cards()
        self.status.set('已保存官方服务 · 点击启用应用；{} 表示沿用已有登录')

    def open_official_editor(self):
        if getattr(self, 'official_dialog', None) and self.official_dialog.winfo_exists():
            self.official_dialog.lift()
            return
        self.save()
        existing = self.official_settings()
        dialog = ctk.CTkToplevel(self.root)
        self.official_dialog = dialog
        dialog.title('编辑官方服务')
        center_dialog(dialog, self.root, 650, 620)
        dialog.resizable(False, False)
        dialog.transient(self.root)
        dialog.configure(fg_color='#F5F5F7')
        body = ctk.CTkFrame(dialog, fg_color='white', corner_radius=16)
        body.pack(fill='both', expand=True, padx=18, pady=18)
        ctk.CTkLabel(body, image=self.images['chatgpt'], text='', height=48).pack(pady=(14, 8))
        form = ctk.CTkFrame(body, fg_color='transparent')
        form.pack(fill='x', padx=24)
        form.columnconfigure(0, weight=1)
        form.columnconfigure(1, weight=1)
        values = {k: tk.StringVar(value=existing.get(k, default)) for k, default in
                  [('name', 'OpenAI Official'), ('note', ''), ('website', 'https://chatgpt.com/codex')]}
        for column, (key, label) in enumerate([('name', '供应商名称'), ('note', '备注')]):
            ctk.CTkLabel(form, text=label, text_color=INK, anchor='w').grid(row=0, column=column, sticky='w')
            ctk.CTkEntry(form, textvariable=values[key], height=34, fg_color='#FAFAFC', text_color=INK,
                         border_color='#E3E3E8').grid(row=1, column=column, sticky='ew', padx=(0, 8) if column == 0 else (0, 0))
        ctk.CTkLabel(form, text='官网链接', text_color=INK).grid(row=2, column=0, sticky='w', pady=(10, 0))
        ctk.CTkEntry(form, textvariable=values['website'], height=34, fg_color='#FAFAFC', text_color=INK,
                     border_color='#E3E3E8').grid(row=3, column=0, columnspan=2, sticky='ew')
        ctk.CTkLabel(form, text='API Key', text_color=INK).grid(row=4, column=0, sticky='w', pady=(10, 0))
        ctk.CTkEntry(form, textvariable=tk.StringVar(value='官方账号无需填写 API Key'), state='disabled', height=34,
                     fg_color='#F2F2F5', border_color='#E3E3E8').grid(row=5, column=0, columnspan=2, sticky='ew')
        ctk.CTkLabel(body, text='auth.json（JSON）', text_color=INK).pack(anchor='w', padx=24, pady=(10, 0))
        editor = ctk.CTkTextbox(body, height=130, fg_color='#FAFAFC', text_color=INK,
                               border_width=1, border_color='#E3E3E8', font=('Consolas', 11))
        editor.pack(fill='x', padx=24, pady=(4, 0))
        editor.insert('1.0', '{}')
        hint = '已加密保存导入凭据。' if existing.get('credentials') else ''
        ctk.CTkLabel(body, text=hint + '{} 或留空沿用已有登录；导入后需点击启用。\n使用你本人已登录的 Codex auth.json；凭据仅在本机加密保存并通过 SSH 同步。',
                     text_color=MUTED, justify='left', wraplength=550, font=('Microsoft YaHei UI', 10)).pack(anchor='w', padx=24, pady=8)
        footer = ctk.CTkFrame(body, fg_color='transparent')
        footer.pack(fill='x', padx=24, pady=(0, 14))
        def read_file():
            filename = filedialog.askopenfilename(parent=dialog, title='选择本人 Codex 的 auth.json', filetypes=[('JSON', '*.json'), ('All', '*.*')])
            if not filename:
                return
            path = Path(filename)
            if path.stat().st_size > 256 * 1024:
                raise ValueError('auth.json 不能超过 256 KB')
            raw = path.read_text(encoding='utf-8-sig')
            parse_official_auth(raw)
            editor.delete('1.0', 'end')
            editor.insert('1.0', raw)
        def commit():
            if self.busy:
                return
            self.save_official_settings({k: v.get() for k, v in values.items()}, editor.get('1.0', 'end'))
            dialog.destroy()
        def login():
            commit()
            if not dialog.winfo_exists():
                self.activate_official(force_login=True)
        for label, action in [('导入文件', read_file), ('账号登录', login)]:
            ctk.CTkButton(footer, text=label, width=90, height=32, fg_color='#F0F0F4', text_color=INK,
                           command=lambda f=action: self.guard(f)).pack(side='left', padx=(0, 8))
        ctk.CTkButton(footer, text='保存', width=90, height=32, fg_color=BLUE,
                       command=lambda: self.guard(commit)).pack(side='right')
        dialog.editor_values, dialog.auth_editor, dialog.commit = values, editor, commit
        self.root.after(100, lambda: dialog.grab_set() if dialog.winfo_exists() else None)
