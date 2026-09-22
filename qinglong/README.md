# 青龙面板自动执行 Microsoft Rewards

本目录提供把本仓库油猴脚本接入青龙面板（或 Windows 任务计划程序）的方法。

## 工作原理

油猴脚本必须运行在浏览器里，不能直接作为 Node/Python 任务执行。青龙任务只做一件事：

```text
启动 Edge 并打开 https://rewards.bing.com/?mr_auto_run=1
```

油猴脚本 `Get Microsoft Rewards v1.0.1.54+` 检测到 `mr_auto_run=1` 后，会自动点击悬浮窗里的“一键全部执行”。

## 前提

1. 电脑已登录 Microsoft Rewards，并且 Edge 里保留登录态。
2. Edge 已安装 Tampermonkey。
3. Edge Tampermonkey 已安装本仓库脚本，且版本为 `1.0.1.54` 或更高。
4. 如果 Edge 打开 `/earn` 时下载 `Clear.PNG`，先禁用“迅雷下载支持”等下载类扩展；它们可能拦截微软埋点资源并干扰页面。
   可使用仓库内的 `../tools/disable-edge-thunder.bat`，恢复时运行 `../tools/enable-edge-thunder.bat`。

## 青龙任务配置

将 `mr_rewards_auto.py` 放到青龙的脚本目录，例如：

```text
<ql_data_dir>/scripts/mr_rewards_auto.py
```

Windows 本地青龙示例：

```text
D:\...\qinglong\data\scripts\mr_rewards_auto.py
```

定时规则可参考 `crontab.example`：

```cron
30 7 * * * real_time=false no_tee=true ID=2 log_name=mr_rewards_auto task mr_rewards_auto.py
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MR_EDGE_PATH` | 自动探测 | Edge 可执行文件路径 |
| `MR_REWARDS_AUTO_URL` | `https://rewards.bing.com/?mr_auto_run=1` | 启动地址 |
| `MR_EDGE_WAIT_SECONDS` | `300` | 青龙任务等待秒数。任务退出不会关闭 Edge，油猴脚本仍继续执行 |

## Windows 任务计划程序

如果不用青龙，也可以直接运行：

```bat
start-edge-rewards.cmd
```

建议每天 07:30 触发一次。

## PC 搜索额度和移动搜索额度

脚本会显示两类额度：

```text
PC x/y  移动 x/y
```

如果出现“无搜索额度”，不要直接理解为账号没有额度。新版脚本会输出来源，例如：

```text
搜索额度：PC 0/150（有计数器） | 移动 0/60（无计数器） | 来源 BingFlyout
```

常见情况：

- PC 搜索：微软会按浏览器、账号地区、登录态和客户端识别返回不同计数。Edge 有 PC 搜索额度时，Chrome 不一定有。
- 移动搜索：通常需要 Bing 移动端 App 或移动端搜索场景。桌面浏览器油猴不能可靠获取移动搜索分。
- 如果当天已经完成 PC/移动搜索，进度会显示 `x/x`，不会继续执行。

## 排查文件

脚本会在 Tampermonkey 本地存储写入一条心跳：

```text
mr_last_run_debug
```

内容包含：

- `version`
- `url`
- `panel`
- `source`
- `pc`
- `mobile`
- `pcOk`
- `mobileOk`

如果你需要让我继续判断“为什么 Edge 没显示图标”或“为什么没 PC 额度”，请更新到最新版后打开一次 `?mr_auto_run=1`，然后把悬浮窗日志发出来即可。
