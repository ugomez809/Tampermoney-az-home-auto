@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_PATH=%SCRIPT_DIR%eagentsaml-clicker.ahk"

set "AHK="
if exist "%ProgramFiles%\AutoHotkey\v2\AutoHotkey64.exe" set "AHK=%ProgramFiles%\AutoHotkey\v2\AutoHotkey64.exe"
if not defined AHK if exist "%ProgramFiles%\AutoHotkey\v2\AutoHotkey.exe" set "AHK=%ProgramFiles%\AutoHotkey\v2\AutoHotkey.exe"
if not defined AHK if exist "%ProgramFiles%\AutoHotkey\AutoHotkey64.exe" set "AHK=%ProgramFiles%\AutoHotkey\AutoHotkey64.exe"
if not defined AHK if exist "%ProgramFiles%\AutoHotkey\AutoHotkey.exe" set "AHK=%ProgramFiles%\AutoHotkey\AutoHotkey.exe"
if not defined AHK if exist "%LocalAppData%\Programs\AutoHotkey\AutoHotkey64.exe" set "AHK=%LocalAppData%\Programs\AutoHotkey\AutoHotkey64.exe"
if not defined AHK if exist "%LocalAppData%\Programs\AutoHotkey\AutoHotkey.exe" set "AHK=%LocalAppData%\Programs\AutoHotkey\AutoHotkey.exe"

if not defined AHK (
  echo AutoHotkey v2 was not found.
  echo Install AutoHotkey v2, then run this launcher again.
  echo Expected script:
  echo   %SCRIPT_PATH%
  pause
  exit /b 1
)

start "" "%AHK%" "%SCRIPT_PATH%"
endlocal
