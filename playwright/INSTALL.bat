@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"
set "installResult=%errorlevel%"
if errorlevel 1 (
  echo Installation failed. See the error above. The quoting job has not been marked ready.
) else (
  echo Installation verified. START.bat starts the job. STOP.bat pauses it.
)
pause
exit /b %installResult%
