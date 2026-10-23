---
name: qq-agent-restart
description: QQ-Agent 桌面/无头实例重启。改了 src/*、electron/*、配置默认值，或技能/插件热重载没生效时，用它安全地停旧实例、拉起新实例并校验就绪；覆盖 Windows 上 ELECTRON_RUN_AS_NODE、进程树孤儿、实例锁这几个坑。普通 skills/plugins 改动先试热重载，不要无脑重启。
---

# QQ-Agent · 重启实例

项目根 = 本文件向上三级（`E:\QQRobot\QQ-agent`）。**先判断是否真的需要重启**：

| 改了什么 | 怎么生效 |
| --- | --- |
| `skills/`、`plugins/` 里的技能/插件 | 热重载已开启，存盘即加载（看日志「重扫完成（watch）」） |
| `ui/` 前端 | 刷新窗口 / 重开控制台即可（Electron 窗口 Ctrl+R 或重开） |
| `src/*`、`electron/*`、`config.js` 默认值、`package.json` | **需要重启实例** |
| 只改文档 / `test/` / `data/` 内容 | 不需要重启 |

## 首选：跑脚本

```bash
node scripts/restart-app.mjs
```

脚本会：读 `data/qq-agent.lock` 拿旧 PID → `taskkill /PID <pid> /T /F` 停整棵进程树 →
去掉 `ELECTRON_RUN_AS_NODE` 后拉起（自动沿用原来的 electron / headless 方式）→
等锁文件换成新 PID 且 `http://127.0.0.1:<server.port>/api/config` 返回 200 →
报 PID、OneBot 是否连接、`persona.review` 阈值是否为新代码。

强制模式：`--electron` / `--headless`。（headless = `node src/server.js`）

## 手工步骤（脚本不可用时）

1. **看旧 PID**：`cat data/qq-agent.lock`（内容就是主进程 PID）。
2. **停**：`taskkill /PID <pid> /T /F`。
   - 必须 `/T` 杀树，否则 SnowLuma 子进程变孤儿、下次启动抢端口。
   - 不要「只关窗口」：配置 `closeToTray` 让关窗只是隐藏。
   - 强杀会跳过退出清理，`qq-agent.lock` 会留残留；新实例会自动抢占（别手删，除非确认 PID 已死且启动报活锁）。
   - 便携 QQ 通常不是 Electron 的子进程，会保留，**不用重新登录**。
3. **启**：
   - 最稳：双击 `启动QQ机器人.bat`（内部就是 `start` electron.exe），或
   - 命令行（先清变量再 start）：
     ```
     set ELECTRON_RUN_AS_NODE=
     start "" "E:\QQRobot\QQ-agent\node_modules\electron\dist\electron.exe" "E:\QQRobot\QQ-agent"
     ```
     bash/git-bash：`env -u ELECTRON_RUN_AS_NODE cmd //c start "" "E:\...\electron.exe" "E:\QQRobot\QQ-agent"`
4. **验**：
   - 锁文件 PID 已变；
   - 日志 `data/logs/qq-agent-<今天>.log` 出现「控制台已就绪：http://127.0.0.1:3210」「\[onebot\] 连接成功」；
   - `curl -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3210/api/config` 得 200。

## 坑（都踩过）

- **`ELECTRON_RUN_AS_NODE=1`**：从 Agent/CI shell 起 electron.exe 会被当普通 Node，直接崩在
  `cjsPreparseModuleExports` / `Cannot read properties of undefined (reading 'exports')`。
  启动前必须 unset；脚本已处理。
- **别用 `Stop-Process -Id <pid>`**：不带 `/T`，SnowLuma 留孤儿；也绕过了退出清理。
- **别 kill 所有 node.exe**：这台机器上还有一堆 MCP / npx 的 node 进程，只杀锁文件那个 PID 的树。
- **端口**：取自 `data/config.json` 的 `server.port`（默认 3210），不是固定常量。
- **单实例锁**：`src/instance-lock.js` 用 `data/qq-agent.lock` 的 PID 判活；活锁会拒绝启动，
  死锁自动抢占。启动后若日志报「已有 QQ Agent 实例在运行（PID …）」，先确认那个 PID 是不是真的在跑。
- **OneBot 连接**：控制台 200 之后还要几秒才连上 SnowLuma，验证时别只看端口。
- 重启不会加载未保存的编辑器改动，也不会提交任何东西；`data/` 不要为重启去改。

## 常见验证动作

- 证明新后端代码已加载：`GET /api/config` 里出现新加的默认键（例如 `persona.review.minConfidence`）。
- 手动触发一轮复盘：控制台 → 设置 → 人设 → 回复示例库 →「立即跑一次」，或
  `curl -X POST http://127.0.0.1:3210/api/persona/review/run`。
