@echo off
cd /d "%~dp0"
set "EDGEAI_ISCC=%~dp0build\toolchain\inno\ISCC.exe"
if not exist "%EDGEAI_ISCC%" set "EDGEAI_ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist "%EDGEAI_ISCC%" (
    echo Install Inno Setup 6 first, or place it in build\toolchain\inno.
    exit /b 1
)
if not exist "dist\current\EdgeSwitch-1.0.1.exe" (
    echo Run Build-Workbench.cmd first.
    exit /b 1
)
"%EDGEAI_ISCC%" "installer\EdgeAI.iss"
exit /b %errorlevel%
