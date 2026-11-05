"""Light desktop components with a quiet sidebar and rounded cards."""
from pathlib import Path
import tkinter as tk
from tkinter import ttk
import customtkinter as ctk
from PIL import Image, ImageOps

from workbench.core import ROOT

BG = '#F5F5F7'
INK = '#1D1D1F'
MUTED = '#86868B'
BLUE = '#007AFF'


def center_dialog(dialog, parent, width, height):
    parent.update_idletasks()
    dialog.geometry('%dx%d' % (width, height))
    x = parent.winfo_rootx() + (parent.winfo_width() - width) // 2
    y = parent.winfo_rooty() + (parent.winfo_height() - height) // 2
    dialog.geometry('%dx%d%+d%+d' % (width, height, x, y))
    def align():
        if not dialog.winfo_exists():
            return
        # Windows adds a title bar and invisible resize border after mapping.
        dx = dialog.winfo_rootx() + dialog.winfo_width()/2 - parent.winfo_rootx() - parent.winfo_width()/2
        dy = dialog.winfo_rooty() + dialog.winfo_height()/2 - parent.winfo_rooty() - parent.winfo_height()/2
        dialog.geometry('%+d%+d' % (round(x - dx), round(y - dy)))
    parent.after(250, align)


class Tooltip:
    def __init__(self, widget, text):
        self.widget, self.text = widget, text
        self.pending = self.window = None
        widget.bind('<Enter>', self.enter, add='+')
        widget.bind('<Leave>', self.hide, add='+')
        widget.bind('<ButtonPress>', self.hide, add='+')
        widget.bind('<Destroy>', self.hide, add='+')

    def enter(self, event=None):
        self.hide()
        self.pending = self.widget.after(400, self.show)

    def show(self):
        self.pending = None
        if not self.widget.winfo_exists():
            return
        self.window = tk.Toplevel(self.widget)
        self.window.overrideredirect(True)
        self.window.attributes('-topmost', True)
        x = self.widget.winfo_rootx() + self.widget.winfo_width() // 2 - 22
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 6
        self.window.geometry('+%d+%d' % (x, y))
        tk.Label(self.window, text=self.text, bg='#303038', fg='white',
                 padx=9, pady=5, font=('Microsoft YaHei UI', 10)).pack()

    def hide(self, event=None):
        if self.pending:
            self.widget.after_cancel(self.pending)
            self.pending = None
        if self.window:
            self.window.destroy()
            self.window = None


def set_window_icon(root):
    """Set both native Windows icon sizes after Tk has created its wrapper HWND."""
    import os
    if os.name != 'nt':
        return
    import ctypes
    from ctypes import wintypes
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.GetParent.argtypes = [wintypes.HWND]
    user.GetParent.restype = wintypes.HWND
    user.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT,
                               ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user.LoadImageW.restype = wintypes.HANDLE
    user.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user.SendMessageW.restype = wintypes.LPARAM
    root.update_idletasks()
    hwnd = user.GetParent(root.winfo_id())
    root.native_icons = []  # Keep handles for the lifetime of the window.
    for kind, size in ((0, 16), (1, 32)):
        handle = user.LoadImageW(None, str(ROOT / 'image/EdgeAI.ico'), 1, size, size, 0x10)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        user.SendMessageW(hwnd, 0x80, kind, handle)  # WM_SETICON
        root.native_icons.append(handle)


class Navigation:
    """Small notebook-compatible controller for existing task code."""
    def __init__(self, parent, sidebar):
        self.parent, self.sidebar = parent, sidebar
        self.pages, self.buttons = [], []
        self.active = 0

    def add(self, frame, text, subtitle, icon):
        index = len(self.pages)
        self.pages.append(frame)
        button = ctk.CTkButton(self.sidebar, text='  ' + text, image=icon, anchor='w', height=44,
                              corner_radius=10, font=('Microsoft YaHei UI', 13),
                              fg_color='transparent', text_color='#515157', hover_color='#E5E5EA',
                              command=lambda: self.select(index))
        button.pack(fill='x', padx=14, pady=3)
        self.buttons.append(button)
        return index

    def select(self, index):
        if not isinstance(index, int):
            index = self.pages.index(index)
        for i, page in enumerate(self.pages):
            if i == index:
                page.grid(row=0, column=0, sticky='nsew')
            else:
                page.grid_remove()
            self.buttons[i].configure(fg_color='#DDEBFE' if i == index else 'transparent',
                                      text_color=BLUE if i == index else '#515157')
        self.active = index
        if getattr(self, 'on_select', None):
            self.on_select(index)

    def reorder(self, order):
        self.pages = [self.pages[i] for i in order]
        self.buttons = [self.buttons[i] for i in order]
        for index, button in enumerate(self.buttons):
            button.pack_forget()
            button.configure(command=lambda i=index: self.select(i))
            button.pack(fill='x', padx=14, pady=3)

    def tabs(self):
        return list(self.pages)

    def nametowidget(self, name):
        return name


def image_asset(name, size):
    path = ROOT / 'image' / name
    if not path.exists():
        return None
    with Image.open(path) as source:
        bitmap = source.convert('RGBA')
    ratio = min(size[0] / bitmap.width, size[1] / bitmap.height)
    return ctk.CTkImage(bitmap, size=(round(bitmap.width * ratio), round(bitmap.height * ratio)))


def navigation_icon(name, size=22):
    """Same square layout box; preserve each image's proportions and transparency."""
    bitmap = Image.open(ROOT / 'image' / name).convert('RGBA')
    bounds = bitmap.getbbox()
    if bounds:
        bitmap = bitmap.crop(bounds)
    bitmap = ImageOps.contain(bitmap, (size * 3, size * 3), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size * 3, size * 3))
    canvas.alpha_composite(bitmap, ((canvas.width - bitmap.width) // 2, (canvas.height - bitmap.height) // 2))
    return ctk.CTkImage(canvas, size=(size, size))


def title(parent, text, subtitle):
    ctk.CTkLabel(parent, text=text, text_color=INK, font=('Microsoft YaHei UI', 27, 'bold'), anchor='w').pack(fill='x')
    ctk.CTkLabel(parent, text=subtitle, text_color=MUTED, font=('Microsoft YaHei UI', 12), anchor='w').pack(fill='x', pady=(5, 22))


def card(parent, heading, description='', image=None):
    wrapper = ctk.CTkFrame(parent, fg_color='white', corner_radius=16, border_width=1, border_color='#E8E8ED')
    wrapper.pack(fill='x', pady=(0, 15))
    if heading:
        row = ctk.CTkFrame(wrapper, fg_color='transparent')
        row.pack(fill='x', padx=20, pady=(16, 0))
        if image:
            ctk.CTkLabel(row, text='', image=image, width=38).pack(side='left', padx=(0, 12))
        labels = ctk.CTkFrame(row, fg_color='transparent')
        labels.pack(side='left', fill='x', expand=True)
        ctk.CTkLabel(labels, text=heading, font=('Microsoft YaHei UI', 16, 'bold'), text_color=INK, anchor='w').pack(fill='x')
        if description:
            ctk.CTkLabel(labels, text=description, font=('Microsoft YaHei UI', 11), text_color=MUTED, anchor='w').pack(fill='x', pady=(3, 0))
    body = ctk.CTkFrame(wrapper, fg_color='transparent')
    body.pack(fill='x', padx=20, pady=14)
    body.columnconfigure(1, weight=1)
    return body


def note(parent, text, row=None):
    label = ctk.CTkLabel(parent, text=text, text_color=MUTED, font=('Microsoft YaHei UI', 11),
                        justify='left', anchor='w', wraplength=740)
    if row is None:
        label.pack(fill='x', pady=(3, 9))
    else:
        label.grid(row=row, column=0, columnspan=3, sticky='w', pady=(10, 0))
    return label


def configure_theme(root):
    ctk.set_appearance_mode('light')
    ctk.set_default_color_theme('blue')
    root.configure(bg=BG)
    style = ttk.Style(root)
    style.theme_use('clam')
    style.configure('TCombobox', fieldbackground='white', background='#F0F0F3', foreground=INK,
                    bordercolor='#D8D8DE', lightcolor='#D8D8DE', darkcolor='#D8D8DE',
                    arrowsize=14, padding=8, font=('Microsoft YaHei UI', 11))
    style.map('TCombobox', fieldbackground=[('readonly', 'white')], selectbackground=[('readonly', 'white')],
              selectforeground=[('readonly', INK)])
    root.option_add('*TCombobox*Listbox.font', ('Microsoft YaHei UI', 11))
