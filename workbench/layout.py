import queue
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk, ImageOps
import customtkinter as ctk

from workbench.core import ROOT, Store
from workbench.release import APP_NAME, VERSION
from workbench.ui import BG, BLUE, INK, MUTED, Navigation, image_asset, navigation_icon, title, card, note, configure_theme, set_window_icon


class Layout:
    def __init__(self, root, store=None):
        self.root = root
        self.store = store or Store()
        self.current = next((p for p in self.store.profiles if p.id == self.store.selected_profile), self.store.profiles[0])
        self.events = queue.Queue()
        self.busy = False
        self.tunnels, self.sessions, self.catalogs = {}, {}, {}
        self.buttons, self.vars = [], {}
        root.title(APP_NAME + ' · 板卡工作台')
        root.geometry('1040x700')
        root.minsize(980, 640)
        configure_theme(root)
        if (ROOT / 'image/EdgeAI.ico').exists():
            root.iconbitmap(default=str(ROOT / 'image/EdgeAI.ico'))
            self.window_icon = ImageTk.PhotoImage(ImageOps.pad(Image.open(ROOT / 'image/EdgeAI.png').convert('RGBA'), (64, 64), color=(0, 0, 0, 0)))
            root.iconphoto(True, self.window_icon)
        self.images = {'Edge_AI': image_asset('EdgeAI.png', (36, 36)),
                       'chatgpt': image_asset('chatgpt-ui.png', (36, 36))}
        self.images['deepseek'] = image_asset('deepseek-ui.png', (96, 24))
        self.images['vscode'] = navigation_icon('Vscode.png', 22)
        self.nav_icons = {key: navigation_icon(filename) for key, filename in {
            'overview': 'EdgeAI.png', 'connect': '配置环境.png', 'models': 'chatgpt-ui.png',
            'proxy': 'Flclash.png', 'tools': 'Tool.png'}.items()}
        shell = ctk.CTkFrame(root, fg_color=BG, corner_radius=0)
        shell.pack(fill='both', expand=True)
        sidebar = ctk.CTkFrame(shell, width=190, fg_color='#EBEBF0', corner_radius=0)
        sidebar.pack(side='left', fill='y')
        sidebar.pack_propagate(False)
        brand = ctk.CTkFrame(sidebar, fg_color='transparent')
        brand.pack(fill='x', padx=12, pady=(22, 16))
        self.images['brand'] = image_asset('EdgeAI.png', (28, 28))
        ctk.CTkLabel(brand, image=self.images['brand'], text='', width=28).pack(side='left')
        self.brand_label = ctk.CTkLabel(brand, text=APP_NAME, text_color=INK, font=('Segoe UI', 18, 'bold'))
        self.brand_label.pack(side='left', padx=(6, 0))
        ctk.CTkLabel(sidebar, text='板卡工作台', text_color=MUTED, anchor='w', font=('Microsoft YaHei UI', 11)).pack(fill='x', padx=24, pady=(0, 24))
        nav_area = ctk.CTkFrame(sidebar, fg_color='transparent')
        nav_area.pack(fill='x')
        self.status = tk.StringVar(value='就绪 · 连接你的 Linux 板卡')
        self.net_status = tk.StringVar(value='代理未连接')
        self.env_status = tk.StringVar()
        footer = ctk.CTkFrame(sidebar, fg_color='transparent')
        footer.pack(side='bottom', pady=18)
        ctk.CTkLabel(footer, text='EDGE SWITCH   /   ' + VERSION, text_color=MUTED, font=('Segoe UI', 10)).pack()
        ctk.CTkLabel(footer, text='luozhang', text_color=MUTED, font=('Segoe UI', 10)).pack(pady=(2, 0))
        self.button(footer, '退出程序', self.quit_app).pack(pady=(10, 0))
        right = ctk.CTkFrame(shell, fg_color=BG, corner_radius=0)
        right.pack(side='left', fill='both', expand=True, padx=22, pady=(18, 14))
        top = ctk.CTkFrame(right, fg_color='transparent')
        top.pack(fill='x', pady=(0, 16))
        self.current_environment = tk.StringVar()
        ctk.CTkLabel(top, textvariable=self.current_environment, text_color=MUTED, font=('Microsoft YaHei UI', 11)).pack(side='left')
        self.save_state = tk.StringVar(value='更改自动保存')
        ctk.CTkLabel(top, textvariable=self.save_state, text_color=MUTED,
                     font=('Microsoft YaHei UI', 11)).pack(side='right')
        content = ctk.CTkFrame(right, fg_color='transparent')
        content.pack(fill='both', expand=True)
        content.rowconfigure(0, weight=1)
        content.columnconfigure(0, weight=1)
        self.notebook = Navigation(content, nav_area)

        overview = self.tab('设备总览', '连接、工具与网络，一眼掌握。', 'overview')
        self.overview_vars = {}
        for heading, keys in [('当前设备', [('device', '设备'), ('resources', '资源'), ('tools', '工具')]),
                              ('工作状态', [('harness', 'Harness'), ('network', '网络'), ('model', '模型验证'), ('updated', '检查时间')])]:
            panel = card(overview, heading)
            for row_number, (key, label) in enumerate(keys):
                self.label(panel, label, row_number)
                self.overview_vars[key] = tk.StringVar(value='尚未检查')
                ctk.CTkLabel(panel, textvariable=self.overview_vars[key], text_color=INK,
                             anchor='w', justify='left', wraplength=570,
                             font=('Microsoft YaHei UI', 12)).grid(row=row_number, column=1, sticky='w', pady=9)
        row = ctk.CTkFrame(overview, fg_color='transparent')
        row.pack(fill='x', pady=8)
        self.button(row, '刷新设备', self.diagnose, primary=True).pack(side='left', padx=(0, 10))
        self.button(row, '打开 VS Code', self.vscode).pack(side='left', padx=(0, 10))
        self.button(row, '打开 Harness', self.harness).pack(side='left')

        device = self.tab('工作环境', '第一步：添加设备与工程，检查 SSH 连接后继续。', 'connect')
        env_header = ctk.CTkFrame(device, fg_color='transparent')
        env_header.pack(fill='x', pady=(0, 14))
        ctk.CTkLabel(env_header, textvariable=self.env_status, text_color=MUTED,
                     font=('Microsoft YaHei UI', 12)).pack(side='left')
        self.add_environment_button = self.button(env_header, '', self.new)
        self.add_environment_button.pack(side='right')
        self.environment_cards = ctk.CTkFrame(device, fg_color='transparent')
        self.environment_cards.pack(fill='x')
        for key in ('name', 'host', 'user', 'port', 'project', 'identity'):
            self.vars[key] = tk.StringVar()
        row = ctk.CTkFrame(device, fg_color='transparent')
        row.pack(fill='x', pady=12)
        self.button(row, '检查当前连接', self.diagnose).pack(side='left', padx=(0, 10))
        self.button(row, 'SSH 终端', self.ssh_console).pack(side='left', padx=(0, 10))
        self.button(row, '打开 VS Code', self.vscode).pack(side='left')
        self.button(device, '继续：代理网络 →', lambda: self.notebook.select(1)).pack(anchor='e', pady=10)

        api = self.tab('模型服务', '第四步：启用 OpenAI Official 登录官方账号，或添加 API 服务。', 'models')
        header = ctk.CTkFrame(api, fg_color='transparent')
        header.pack(fill='x', pady=(0, 14))
        ctk.CTkLabel(header, text='我的模型服务', font=('Microsoft YaHei UI', 16, 'bold'), text_color=INK).pack(side='left')
        self.add_api_button = self.button(header, '', self.add_api, primary=True)
        self.add_api_button.pack(side='right')
        self.api_cards = ctk.CTkFrame(api, fg_color='transparent')
        self.api_cards.pack(fill='x')
        self.button(api, '打开 VS Code', self.vscode, primary=True).pack(anchor='e', pady=(8, 0))
        self.button(api, '连接诊断', self.vscode_diagnostics).pack(anchor='e', pady=(8, 0))
        ctk.CTkLabel(api, text='测试：检查连通与模型列表    验证：发送少量请求检查推理',
                     text_color=MUTED, font=('Microsoft YaHei UI', 11)).pack(anchor='w', pady=14)
        self.api_name = tk.StringVar()
        self.key_var = tk.StringVar()
        self.remember = tk.BooleanVar(value=False)
        for key in ('base_url', 'model', 'protocol'):
            self.vars[key] = tk.StringVar()
        self.model_picker = ttk.Combobox(api, textvariable=self.vars['model'])

        network = self.tab('代理网络', '第二步（按需）：直连可用时无需代理；需要时配置 FlClash。', 'proxy')
        form = card(network, '连接方式', '支持 FlClash 的 HTTP / mixed 代理端口。')
        self.vars['proxy'] = tk.BooleanVar()
        for i, (key, label) in enumerate([('codex_proxy', 'Codex / API 测试使用本机代理'),
                                         ('harness_proxy', 'Harness 使用本机代理'),
                                         ('proxy', '运行环境下载 / 版本查询使用本机代理')]):
            self.vars[key] = tk.BooleanVar()
            ctk.CTkSwitch(form, text=label, variable=self.vars[key], font=('Microsoft YaHei UI', 12), text_color=INK).grid(row=i, column=0, columnspan=3, sticky='w', pady=(0, 16))
        self.field(form, '本机代理端口', 'proxy_port', 3)
        row = self.actions(form, 4)
        self.button(row, '连接代理', self.start_tunnel, primary=True).pack(side='left', padx=(0, 10))
        self.button(row, '断开连接', self.stop_tunnel).pack(side='left')
        ctk.CTkLabel(form, textvariable=self.net_status, text_color=BLUE, font=('Microsoft YaHei UI', 12), anchor='w').grid(row=5, column=0, columnspan=3, sticky='w', pady=(20, 0))
        note(form, '需要时自动连接代理；断线后自动恢复原端口。修改网络后请重新同步 Codex；运行中的 Harness 需先停止再打开。', 6)
        info = card(network, '连接由你掌控')
        note(info, '退出时关闭本工作台的代理与网页转发。后台 Harness 可以继续运行；若使用电脑代理，电脑离线期间模型请求无法经此代理发出。')
        self.button(network, '继续：安装工具 →', lambda: self.notebook.select(2)).pack(anchor='e', pady=10)

        tools = self.tab('AI 工具', '第三步：安装 Node.js，再选择版本安装 Codex / Harness。', 'tools')
        self.version_status = tk.StringVar(value='进入本页自动读取可安装版本')
        ctk.CTkLabel(tools, textvariable=self.version_status, text_color=MUTED, font=('Microsoft YaHei UI', 11)).pack(anchor='w', pady=(0, 12))
        self.version_pickers = {}
        row = ctk.CTkFrame(tools, fg_color='transparent')
        row.pack(fill='x', pady=(0, 12))
        self.button(row, '检测板卡工具', self.diagnose).pack(side='left', padx=(0, 10))
        self.button(row, '使用已有工具', self.reuse_board_tools).pack(side='left')
        form = card(tools, '运行环境', '独立安装，不替换板卡的系统 Node.js。')
        self.button(form, '安装 Node.js 24', self.runtime).pack(anchor='w')
        form = card(tools, 'Codex', '安装后前往“模型服务”选择官方账号或 API，再打开工具。', self.images['chatgpt'])
        self.vars['codex_auth'] = tk.StringVar()
        self.version_field(form, 'codex')
        row = self.actions(form, 1)
        self.button(row, '安装 Codex', lambda: self.install('codex')).pack(side='left', padx=(0, 10))
        self.button(row, '打开终端', self.codex).pack(side='left', padx=(0, 10))
        self.button(row, '打开 VS Code', self.vscode, primary=True).pack(side='left')
        self.button(row, '导入服务端', self.import_vscode_server).pack(side='left', padx=(10, 0))
        editor_row = self.actions(form, 2)
        self.button(editor_row, '编辑器版本', self.editor_version).pack(side='left')
        form = card(tools, 'DeepSeek Harness', '通过 SSH 安全转发到本机浏览器。', self.images['deepseek'])
        self.version_field(form, 'harness')
        row = self.actions(form, 1)
        self.button(row, '安装 Harness', lambda: self.install('harness')).pack(side='left', padx=(0, 10))
        self.button(row, '打开网页', self.harness, primary=True).pack(side='left', padx=(0, 10))
        self.button(row, '停止', self.stop_harness).pack(side='left')
        self.vars['harness_background'] = tk.BooleanVar()
        ctk.CTkCheckBox(form, text='关闭工作台后继续在板卡后台运行', variable=self.vars['harness_background'],
                       font=('Microsoft YaHei UI', 12), text_color=INK).grid(row=2, column=0, columnspan=3, sticky='w', pady=(18, 4))
        note(form, '后台模式不包含板卡重启后自启。更改此选项后再次点击“打开网页”生效。', 3)
        self.button(tools, '刷新可选版本', self.versions).pack(anchor='w', pady=(0, 10))
        note(tools, 'Harness 首次进入后，在 Settings → Models 配置模型服务。')
        self.button(tools, '继续：配置模型 →', lambda: self.notebook.select(3)).pack(anchor='e', pady=10)

        bottom = ctk.CTkFrame(right, fg_color='white', corner_radius=12, border_width=1, border_color='#E8E8ED')
        bottom.pack(fill='x', pady=(16, 0))
        ctk.CTkLabel(bottom, textvariable=self.status, text_color='#515157', font=('Microsoft YaHei UI', 11), anchor='w').pack(side='left', fill='x', expand=True, padx=16, pady=12)
        ctk.CTkButton(bottom, text='运行记录', width=84, height=30, fg_color='#F1F1F5', text_color=INK, hover_color='#E5E5EA', command=self.toggle_logs).pack(side='right', padx=10)
        self.log_frame = ctk.CTkFrame(right, fg_color='white', corner_radius=12)
        self.logbox = ctk.CTkTextbox(self.log_frame, height=150, font=('Microsoft YaHei UI', 11), fg_color='white', text_color='#515157', state='disabled', wrap='word')
        self.logbox.pack(fill='both', expand=True, padx=8, pady=8)
        self.logs_visible = False
        self.notebook.reorder([1, 3, 4, 2, 0])
        self.notebook.select(0)
        self.notebook.on_select = self.page_changed
        root.protocol('WM_DELETE_WINDOW', self.close)
        self.refresh_picker()
        self.load()
        for name, variable in self.vars.items():
            if name not in ('base_url', 'model', 'protocol'):
                variable.trace_add('write', self.schedule_save)
        set_window_icon(root)
        root.after(150, self.poll)

    def version_field(self, parent, tool):
        name = tool + '_version'
        self.vars[name] = tk.StringVar()
        self.label(parent, '安装版本', 0)
        picker = ttk.Combobox(parent, textvariable=self.vars[name], state='readonly')
        picker.grid(row=0, column=1, sticky='ew', pady=7)
        self.version_pickers[tool] = picker

    def toggle_logs(self):
        if self.logs_visible:
            self.log_frame.pack_forget()
        else:
            self.log_frame.pack(fill='x', pady=(8, 0))
        self.logs_visible = not self.logs_visible

    def tab(self, label, subtitle='', logo=None):
        page = ctk.CTkScrollableFrame(self.notebook.parent, fg_color='transparent', corner_radius=0)
        title(page, label, subtitle)
        self.notebook.add(page, label, subtitle, self.nav_icons.get(logo))
        return page

    def button(self, parent, text, action, primary=False):
        b = ctk.CTkButton(parent, text=text, command=lambda: self.guard(action), height=36, corner_radius=9,
                         font=('Microsoft YaHei UI', 13), fg_color=BLUE if primary else '#F0F0F4',
                         text_color='white' if primary else INK, hover_color='#0066DD' if primary else '#E4E4EA')
        self.buttons.append(b)
        if 'VS Code' in text:
            b.configure(image=self.images['vscode'], fg_color='white', text_color=INK,
                        hover_color='#E8F2FF', border_width=1, border_color='#DFE5ED', width=168)
        return b

    def label(self, parent, text, row):
        ctk.CTkLabel(parent, text=text, width=120, anchor='w', font=('Microsoft YaHei UI', 12), text_color='#515157').grid(row=row, column=0, sticky='w', pady=7, padx=(0, 18))

    def field(self, parent, label, name, row):
        self.vars[name] = tk.StringVar()
        self.label(parent, label, row)
        ctk.CTkEntry(parent, textvariable=self.vars[name], height=38, fg_color='#FAFAFC', border_color='#E3E3E8', text_color=INK, font=('Microsoft YaHei UI', 12)).grid(row=row, column=1, sticky='ew', pady=7)

    def actions(self, parent, row):
        frame = ctk.CTkFrame(parent, fg_color='transparent')
        frame.grid(row=row, column=0, columnspan=3, sticky='w', pady=(16, 0))
        return frame
