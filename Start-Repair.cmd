@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if exist "D:\software\Anaconda\python.exe" (
  "D:\software\Anaconda\python.exe" -X utf8 "%~dp0repair.py" %*
) else (
  py -3 -X utf8 "%~dp0repair.py" %*
)
echo.
pause
