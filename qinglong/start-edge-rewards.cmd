@echo off
setlocal

set "EDGE_PATH=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set "MR_REWARDS_AUTO_URL=https://rewards.bing.com/?mr_auto_run=1"

if not exist "%EDGE_PATH%" set "EDGE_PATH=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

start "" "%EDGE_PATH%" --new-window "%MR_REWARDS_AUTO_URL%"
