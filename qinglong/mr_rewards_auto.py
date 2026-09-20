#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Microsoft Rewards 每日自动执行（青龙面板 / Windows 通用）。

本脚本不直接运行油猴脚本，而是启动 Edge 并打开：
    https://rewards.bing.com/?mr_auto_run=1

油猴脚本检测到 mr_auto_run=1 后，会自动点击悬浮窗里的“一键全部执行”。

环境变量（可选）：
  MR_EDGE_PATH             Edge 可执行文件路径
  MR_REWARDS_AUTO_URL      自动执行地址，默认 https://rewards.bing.com/?mr_auto_run=1
  MR_EDGE_WAIT_SECONDS     青龙任务等待秒数，默认 300
"""

import os
import subprocess
import sys
import time
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

DEFAULT_URL = "https://rewards.bing.com/?mr_auto_run=1"


def now():
    return datetime.now().isoformat(timespec="seconds")


def find_edge():
    configured = os.environ.get("MR_EDGE_PATH", "").strip()
    if configured:
        if os.path.exists(configured):
            return configured
        raise RuntimeError(f"MR_EDGE_PATH 不存在: {configured}")
    for path in EDGE_CANDIDATES:
        if os.path.exists(path):
            return path
    raise RuntimeError("未找到 Edge，请设置 MR_EDGE_PATH")


def main():
    edge = find_edge()
    url = os.environ.get("MR_REWARDS_AUTO_URL", DEFAULT_URL).strip() or DEFAULT_URL
    try:
        wait_seconds = max(5, int(os.environ.get("MR_EDGE_WAIT_SECONDS", "300")))
    except ValueError:
        wait_seconds = 300

    print(f"[{now()}] 启动 Edge: {edge}")
    print(f"[{now()}] 打开: {url}")
    subprocess.Popen([edge, "--new-window", url])
    print(f"[{now()}] 等待 {wait_seconds}s（油猴脚本自动执行，浏览器保持打开）...")
    time.sleep(wait_seconds)
    print(f"[{now()}] 青龙任务完成；浏览器中的油猴脚本仍会继续运行。")


if __name__ == "__main__":
    main()
