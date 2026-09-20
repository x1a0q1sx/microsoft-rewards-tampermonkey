@echo off
setlocal

echo Removing Edge extension install block policy...
reg delete "HKCU\Software\Policies\Microsoft\Edge" /f >nul 2>&1

echo Restarting Edge...
taskkill /IM msedge.exe /F >nul 2>&1
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

echo Done. Edge extensions will be available again.
pause
