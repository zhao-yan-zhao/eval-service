@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0LabConsole\tools\start-normal.ps1" %*
if errorlevel 1 (
echo START FAILED. See LabConsole outputs normal-startup.
pause
exit /b 1
)
