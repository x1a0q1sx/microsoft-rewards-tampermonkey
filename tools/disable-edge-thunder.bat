@echo off
setlocal

set "THUNDER_ID=ncennffkjdiamlpmcbajkmaiiiddgioo"
set "KEY=HKCU\Software\Policies\Microsoft\Edge\ExtensionInstallBlocklist"

echo Disabling Edge Thunder Download extension policy...
reg add "%KEY%" /v 1 /t REG_SZ /d "%THUNDER_ID%" /f
if errorlevel 1 (
  echo Policy write failed. Try right-click and Run as administrator.
  pause
  exit /b 1
)

echo Restarting Edge...
taskkill /IM msedge.exe /F >nul 2>&1
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" "https://rewards.bing.com/?mr_auto_run=1"

echo Done. Edge should restart without Thunder Download support.
pause
