@echo off
cd /d "%~dp0"
if exist "%~dp0dist\current\EdgeSwitch-1.0.1.exe" (
    start "" "%~dp0dist\current\EdgeSwitch-1.0.1.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.15.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.15.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.11.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.11.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.10.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.10.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.9.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.9.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.8.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.8.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.7.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.7.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.6.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.6.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.5.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.5.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.4.1.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.4.1.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.4.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.4.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.3.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.3.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI-0.2.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI-0.2.exe"
    exit /b
)
if exist "%~dp0dist\current\EdgeSSHAI.exe" (
    start "" "%~dp0dist\current\EdgeSSHAI.exe"
    exit /b
)
if exist "%~dp0dist\EdgeSSHAI.exe" (
    start "" "%~dp0dist\EdgeSSHAI.exe"
    exit /b
)
python start_workbench.py
if errorlevel 1 pause
