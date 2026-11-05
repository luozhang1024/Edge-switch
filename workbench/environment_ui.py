"""Saved device environments with explicit switching and modal configuration."""
from dataclasses import replace
import tkinter as tk
from tkinter import filedialog, messagebox
import customtkinter as ctk
from workbench.core import Board, Profile
from workbench.ui import BLUE, INK, MUTED, Tooltip, navigation_icon, center_dialog


class EnvironmentManagement:
    def render_environment_cards(self):
        if not hasattr(self, 'environment_cards'):
            return
        self.env_status.set('当前：' + self.current.name)
        self.add_environment_button.configure(image=self.action_images['add'], width=40, height=40,
                                              fg_color='transparent', hover=False, border_width=0)
        if not hasattr(self.add_environment_button, 'tooltip'):
            self.add_environment_button.tooltip = Tooltip(self.add_environment_button, '添加')
        if 'environment' not in self.images:
            self.images['environment'] = navigation_icon('配置环境.png', 30)
        for widget in self.environment_cards.winfo_children():
            widget.destroy()
        self.environment_card_widgets = {}
        for profile in self.store.profiles:
            using = profile.id == self.current.id
            frame = ctk.CTkFrame(self.environment_cards, fg_color='#EDF5FF' if using else 'white',
                                 border_width=1, border_color='#78B6FF' if using else '#E3E3E8', corner_radius=14)
            frame.pack(fill='x', pady=(0, 10))
            ctk.CTkLabel(frame, image=self.images['environment'], text='').pack(side='left', padx=(16, 12), pady=18)
            text = ctk.CTkFrame(frame, fg_color='transparent')
            text.pack(side='left', fill='x', expand=True, pady=12)
            ctk.CTkLabel(text, text=profile.name, text_color=INK, anchor='w', font=('Microsoft YaHei UI', 14, 'bold')).pack(fill='x')
            ctk.CTkLabel(text, text='%s@%s:%s' % (profile.user, profile.host, profile.port),
                         text_color=BLUE, anchor='w', font=('Microsoft YaHei UI', 11)).pack(fill='x')
            ctk.CTkLabel(text, text=profile.project, text_color=MUTED, anchor='w', wraplength=300,
                         font=('Microsoft YaHei UI', 10)).pack(fill='x')
            tools = ctk.CTkFrame(frame, fg_color='transparent')
            tools.pack(side='right', padx=14)
            use = ctk.CTkButton(tools, text='使用中' if using else '使用', width=82, height=32,
                                fg_color='#E6E8ED' if using else BLUE, text_color='#969BA4' if using else 'white',
                                state='disabled' if using else 'normal',
                                command=lambda pid=profile.id: self.guard(lambda: self.use_environment(pid)))
            use.pack(side='left', padx=(0, 8))
            for icon, label, action in [('edit', '编辑', self.open_environment_editor),
                                         ('test', '测试', self.test_environment), ('delete', '删除', self.delete_environment)]:
                button = ctk.CTkButton(tools, text='', image=self.action_images[icon], width=30, height=32,
                                       fg_color='transparent', hover_color='#E2E8F0',
                                       command=lambda pid=profile.id, callback=action: self.guard(lambda: callback(pid)))
                button.pack(side='left', padx=2)
                button.tooltip = Tooltip(button, label)
            ctk.CTkButton(tools, text='配置 SSH 登录', width=105, height=30,
                           command=lambda pid=profile.id: self.guard(lambda: self.setup_ssh(pid))).pack(side='left', padx=(8, 0))
            self.environment_card_widgets[profile.id] = frame

    def setup_ssh(self, profile_id):
        self.save()
        profile = next(p for p in self.store.profiles if p.id == profile_id)
        if not messagebox.askokcancel('首次 SSH 登录',
                '即将打开终端。请核验板卡主机指纹，并输入 Linux 账号密码（输入时不显示字符）。\n'
                '仅向此账号追加本机公钥，不保存密码。完成后会自动检查连接。'):
            return
        board = Board(profile, self.store.scope(profile))
        def done(identity):
            self.save_environment(replace(profile, identity=identity))
            messagebox.showinfo('SSH 已配置', '这台电脑已可使用自己的密钥登录板卡。现在可以打开 VS Code。')
        self.run('首次 SSH 授权（请在终端输入）',
                 lambda: board.enroll_ssh(self.store.directory / 'ssh'), done)

    def use_environment(self, profile_id):
        self.save()
        self.current = next(p for p in self.store.profiles if p.id == profile_id)
        self.store.selected_profile = profile_id
        self.store.save()
        self.refresh_picker()
        self.load()
        self.status.set('使用环境：' + self.current.name)

    def test_environment(self, profile_id):
        self.save()
        p = next(p for p in self.store.profiles if p.id == profile_id)
        board = Board(p, self.store.scope(p))
        def done(info):
            messagebox.showinfo('连接正常', '%s\n%s / %s\n可用内存 %s MB' %
                                (p.name, info['arch'], info['libc'], info['memory_mb'].get('MemAvailable', '?')))
        self.run('检查环境连接', lambda: board.call('diagnose'), done)

    def open_environment_editor(self, profile_id=None):
        if getattr(self, 'environment_dialog', None) and self.environment_dialog.winfo_exists():
            self.environment_dialog.lift()
            return
        self.save()
        source = next((p for p in self.store.profiles if p.id == profile_id), None)
        profile = replace(source) if source else Profile(name='新工作环境')
        dialog = ctk.CTkToplevel(self.root)
        self.environment_dialog = dialog
        dialog.title('编辑环境' if source else '添加环境')
        center_dialog(dialog, self.root, 550, 580)
        dialog.resizable(False, False)
        dialog.transient(self.root)
        dialog.configure(fg_color='#F5F5F7')
        body = ctk.CTkFrame(dialog, fg_color='white', corner_radius=14)
        body.pack(fill='both', expand=True, padx=18, pady=18)
        ctk.CTkLabel(body, text='编辑工作环境' if source else '添加工作环境', text_color=INK,
                     font=('Microsoft YaHei UI', 20, 'bold')).pack(anchor='w', padx=22, pady=(20, 12))
        form = ctk.CTkFrame(body, fg_color='transparent')
        form.pack(fill='x', padx=22)
        form.columnconfigure(1, weight=1)
        values = {}
        for row, (name, label) in enumerate([('name', '环境名称'), ('host', '设备地址'), ('user', 'Linux 用户'),
                                             ('port', 'SSH 端口'), ('project', '工程目录'), ('identity', 'SSH 私钥')]):
            values[name] = tk.StringVar(value=getattr(profile, name))
            ctk.CTkLabel(form, text=label, text_color=MUTED, anchor='w', width=90).grid(row=row, column=0, pady=8)
            ctk.CTkEntry(form, textvariable=values[name], height=36, fg_color='#FAFAFC',
                         border_color='#E3E3E8', text_color=INK).grid(row=row, column=1, sticky='ew', pady=8)
        def choose():
            filename = filedialog.askopenfilename(parent=dialog, title='选择 SSH 私钥')
            if filename:
                values['identity'].set(filename)
        ctk.CTkButton(form, text='选择', width=48, command=choose).grid(row=5, column=2, padx=(6, 0))
        ctk.CTkLabel(body, text='每个环境独立管理 API 与网络。首次使用请核验 SSH 主机指纹。\n私钥可留空，使用系统密钥；工作台不保存 SSH 密码。',
                     text_color=MUTED, justify='left', wraplength=460, font=('Microsoft YaHei UI', 11)).pack(anchor='w', padx=22, pady=14)
        footer = ctk.CTkFrame(body, fg_color='transparent')
        footer.pack(fill='x', padx=22, pady=10)
        def commit():
            if self.busy:
                return
            value = {k: v.get().strip() for k, v in values.items()}
            value['port'] = int(value['port'])
            updated = replace(profile, **value)
            self.save_environment(updated)
            dialog.destroy()
        ctk.CTkButton(footer, text='保存', width=100, command=lambda: self.guard(commit)).pack(side='right', padx=(8, 0))
        ctk.CTkButton(footer, text='取消', width=100, fg_color='#F0F0F4', text_color=INK, command=dialog.destroy).pack(side='right')
        dialog.editor_values, dialog.commit = values, commit
        self.root.after(100, lambda: dialog.grab_set() if dialog.winfo_exists() else None)

    def save_environment(self, profile):
        profile.validate()
        if not profile.name.strip():
            raise ValueError('请填写环境名称')
        old = next((p for p in self.store.profiles if p.id == profile.id), None)
        changed = old and any(getattr(old, k) != getattr(profile, k) for k in ('host', 'port', 'user', 'identity', 'project'))
        if changed and (profile.id in self.sessions or profile.id in self.tunnels):
            raise ValueError('此环境仍有网页或代理连接，请先切换到该环境停止 Harness、断开代理，再修改连接')
        if old:
            self.store.profiles[self.store.profiles.index(old)] = profile
        else:
            self.store.profiles.append(profile)
            self.store.api_entries(profile)
        if changed:
            self.store.applied.pop(profile.id, None)
        if profile.id == self.current.id:
            self.current = profile
        self.store.save()
        self.refresh_picker()
        self.load()
        self.status.set('已保存环境：' + profile.name + ' · 点击“使用”切换')

    def delete_environment(self, profile_id):
        self.save()
        if len(self.store.profiles) == 1:
            raise ValueError('请至少保留一个工作环境')
        if profile_id in self.sessions or profile_id in self.tunnels:
            raise ValueError('此环境仍有网页或代理连接，请先停止 Harness 并断开代理')
        profile = next(p for p in self.store.profiles if p.id == profile_id)
        if not messagebox.askyesno('删除环境', '删除“%s”的本机配置？板卡文件、后台任务及 VS Code 窗口会保留。' % profile.name):
            return
        if self.current.id == profile_id:
            self.use_environment(next(p.id for p in self.store.profiles if p.id != profile_id))
        self.store.profiles.remove(profile)
        for entry in self.store.services.pop(profile_id, []):
            self.store.secrets.pop(entry['id'], None)
            getattr(self, '_api_keys', {}).pop(entry['id'], None)
        self.store.applied.pop(profile_id, None)
        self.store.official.pop(profile_id, None)
        self.store.save()
        self.refresh_picker()
        self.load()
