@echo off
cd /d "%~dp0"
python -c "from PIL import Image,ImageOps; im=ImageOps.pad(Image.open('image/EdgeAI.png').convert('RGBA'),(256,256),color=(0,0,0,0)); im.save('image/EdgeAI.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
if errorlevel 1 exit /b 1
python -m PyInstaller --noconfirm --onefile --windowed --distpath dist/current --name EdgeSwitch-1.0.0 --icon image/EdgeAI.ico --version-file installer/windows-version.txt --collect-all customtkinter --hidden-import pystray._win32 --add-data "image;image" --add-data "LICENSE;." --add-data "workbench/remote_agent.py;workbench" --add-data "workbench/harness_service.py;workbench" start_workbench.py
exit /b %errorlevel%
