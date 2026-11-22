@echo off
rem Shared checked production launcher; token is never exposed in command-line arguments.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -File "%~dp0LabConsole\tools\ensure_production_bridge.ps1"
exit /b %errorlevel%