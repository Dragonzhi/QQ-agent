# 给"肥鱼"放开能力的安全治理分析

> 2026-10-20 · 目标：让 qq-agent 的智能体更自由、更拟人、能持续交互，
> 同时不靠"全开沙箱"换安全。结论先说：**项目已有四层"类审批"设计，但全部是
> 装机时授权或内容级人工审；运行时"危险动作 → 管理员批准"这一层是空的**。
> 现成方案（DSH 自身、Claude Code、Codex、OpenHands、LangGraph）可以拼出一层
> 贴合本项目架构的运行时治理，且大部分零件项目里已经有了。

---

## 1. 项目速览（本次核对的事实）

- **形态**：Electron 桌面 QQ 机器人（`src/app.js` 入口），OneBot v11 协议端 +
  任意 OpenAI 兼容大脑 + 原生 HTML 控制台（`ui/`）。
- **核心架构**：事件驱动 + 无状态会话。每条消息触发开新会话（静态系统提示 +
  存档摘要 + 新消息），会话结束即弃，**成本恒定**（README §技术架构）。
  这是"省钱"的根，任何改造都不要动它。
- **能力面**：28 个内置工具（`src/tools.js` 的 `registerTool`）+ 插件能力
  （`plugins/` 21 个）+ Skill 工具（`skills/` 14 个，含 minecraft / voice / qzone 等重能力）。
- **执行链路**：模型 tool_calls → `executeTool(defs, ctx, name, argsJson)`
  （`src/tools.js:1273`）→ **直接调 `def.execute`，中间没有任何拦截点**。

## 2. 现状盘点：项目里已有什么"类似设计"

### 2.1 装机时能力授权（静态，有）

| 机制 | 位置 | 性质 |
|---|---|---|
| Skill/插件 `permissions` 声明 | `src/plugin-loader.js:71-133` | 清单里不写 `web_fetch` 就拿不到全局 fetch。**安装时授权，运行时不改** |
| 工具可用性七层闸 | `src/tool-registry.js:148-209` | 总开关 → Skill 生效 → 能力依赖 → 分类 → 单工具 → 运行期依赖 → skill `tool.guard` 否决 |
| 敏感工具独立开关先例 | `src/tool-registry.js:186` | `send_to`（跨会话发送）默认关，在可用性层拦——**"社交敏感 = 单独管"的先例已存在** |
| 热重载警告 | README §扩展 | "任意落地的 JS 会被执行，共享机器建议关掉" |

### 2.2 网络硬边界（有，且做得扎实）

`safe-fetch.js`：`security.browseLock` 域名白名单、**逐跳校验**（重定向目标也查）、
DNS 校验 + IP 固定、手动跟重定向、图片地址禁内网（`src/config.js:152-163`）。

### 2.3 内容级人工审批（有，状态机现成）

`pending → active / rejected` 三态在项目里已经跑了很久：

- 回复示例库：每晚 LLM 起草候选 → 只进 pending → 人工审批后才进提示词
  （`src/persona-review.js`，`config.persona.review`）
- 群内梗库：同样 pending/active（`data/group-memes/<chatId>.json`）
- 技能市场发布：待审核（`src/market.js`）
- 审计先例：示例库增删改全量落日志可恢复（提交 `4fbd6b2`）

### 2.4 身份与"主人"概念（有）

`plugins/owner-identity`：只按 QQ 号认主人（结构上不接受名字），主人可切换专属人设。

### 2.5 结论：缺的那一层

> 项目对"能力风险"的回答是**窄能力面**（没有 shell / 文件 / 代码执行工具，
> 28 个工具全部限定在消息、表情、记忆、提醒、受白名单管制的联网）；
> 对"内容风险"的回答是**人工审**（pending 状态机，但只在桌面控制台）。
>
> **没有的**：执行前的风险分级、运行时批准队列、管理员在 QQ 侧的审批通道、
> LLM 自动审核、执行隔间。最重的能力（`skills/minecraft` 起本地 Paper 服务端 +
> mineflayer 子进程、`plugins/voice-bridge` 实时语音、`skills/qqzone` 发说说）
> 只靠"技能总开关"一层管，开了就是应用的完整权限。

放开沙箱不缺"勇气"，缺的是把 §2.3 的 pending 状态机从**内容**搬到**动作**上。

## 3. 现成方案参照

### 3.1 DSH 自身（你的 peer 们在用的那套，也就是本分析运行的环境）

DSH 的契约（`ops_bash` / `run_code` 的工具声明即文档）：

1. **每次操作都过 sandbox policy**：模式分档（`workspace-write` / `danger-full-access`），
   越权即拒，不做"睁一只眼闭一只眼"。
2. **拒绝后一次性 escalation**：被拒的操作可以用
   `sandbox_permissions`（**最窄的放宽档**）+ `justification`（一句话理由）
   申请重试一次，**弹窗问用户**；批准后在一个**隔间临时环境**里执行，
   执行完即弃（够不到之前的变量，也不留状态）。
3. **审批可全局关闭**：关掉后所有需要审批的操作**自动拒绝**（fail-closed）。
4. **结构化询问**：`ask_user_question` 给选项，不给开放式输入。

可抄的四条原则：**默认关、按次申请、最小权限、一次性 + fail-closed**。

### 3.2 其它成熟方案

| 方案 | 机制 | 可抄点 |
|---|---|---|
| Claude Code | `allow / ask / deny` 规则 + 工具粒度 + plan mode | 规则匹配先行，plan mode = 只读演练 |
| Codex CLI | `approval_mode`：untrusted / on-failure / on-request / never | 分档即配置，不改代码 |
| OpenHands | security analyzer：LLM 给命令评 low/medium/high → 自动放行 / 弹确认 | "自动审核"的工程化形态 |
| LangGraph HITL | `interrupt`：执行前中断、人审后 `resume` | 审批队列就是 interrupt 的持久化形态 |
| OpenAI Agents SDK | guardrails / tripwires：并行审核器，输入输出双侧 | 审核与执行解耦，审核失败走另一路 |

共同形状：**规则前置（便宜、确定性）→ LLM 兜底（贵、覆盖长尾）→ 人审终点（贵、只留给中高风险）**。

## 4. 落到 qq-agent 的设计建议（四层，全部贴合现有架构）

### L0 工具风险分级（半天工作量）

工具 def 加一个字段：`risk: 'safe' | 'confirm' | 'admin'`，策略走
`config.tools.riskPolicy`（按工具 id / 分类 / 参数特征覆盖，参照
`toolsCfg.overrides` 的既有形态）。

- 现 28 个工具：`safe`（查询/记忆/提醒）、`confirm`（`send_to` 升级、跨群、
  删记忆）、`admin`（新增的 shell / 文件 / 代码执行类）。
- **这是 `send_to` 独立开关先例的一般化**——把"一个工具一套开关"升级为
  "一个工具一个风险级 + 一张策略表"。

### L1 审批队列（复用 pending 状态机，不动执行语义）

- 存储 `data/approvals/<id>.json`，状态 `pending → approved / rejected / expired`，
  字段：工具 id、参数、来源会话、触发人、风险级、理由、过期时间。
- 执行点改造：`executeTool` 从"直通"改为**分级判定 → 直通 or 入队**。
  入队时**返回给模型的不是错误**，而是"已提交审批，等主人确认"——
  模型可以自然地跟群友说"我想去整个活，主人批了我就去"。
  **拟人感和安全在这里是同一件事**。
- 控制台加「审批」页（`ui/app/` 加一个页面模块，走既有 SSE 会话推送范式）。

### L2 管理员通道（QQ 私聊即审批）

- 主人号码已有现成判定（`plugins/owner-identity`，只认 QQ 号）。
- 主人在私聊回「同意 / 拒绝」（带审批 id 或回复引用），即完成审批；
  桌面控制台同步可批、可批量批。
- 闸：频率限制、过期自动拒（fail-closed，抄 DSH "审批可关 = 全拒"）。

### L3 自动审核（规则前置 + LLM judge 兜底）

- 规则层：黑名单命令/路径模式、危险参数特征、频率限制——确定性、零成本。
- LLM 层：复用 `persona-review.js` 的调用模式（小模型/便宜模型），
  对命中 confirm 的操作评 risk，**低风险自动放行并留痕**（抄 OpenHands），
  中转人，高直接拒。
- 自动审核的放行记录全量进审计日志（抄 `4fbd6b2` 的示例库审计）。

### L4 执行隔间（真要给 shell/代码执行时）

现成范式就在仓库里：`skills/minecraft/runner.mjs` —— **独立子进程 +
127.0.0.1 控制通道 + 预算/空闲/失败多重停机 + 掉线收档**。照抄：

```
子进程（限定 cwd + 超时 + 内存上限 + 出站域名白名单）
  ↑ HTTP/IPC 控制通道（带令牌）
执行器工具（admin 级，默认关，只能经 L1 审批后调用）
```

外加 fail-closed 三件套：总开关（`config.tools.enabled` 已有）、
审批超时默认拒、任何一层异常都按"拒"处理。

## 5. 与"持续 LLM 交互"的关系（两个正交的诉求）

用户原话里其实有两件事：

1. **更自由**（能力面）→ 上面的 L0-L4。
2. **更拟人、持续交互**（节奏面）→ **不要动无状态会话架构**（那是成本命根）。
   持续感用已有零件拼：
   - 主动机会定时器（`src/orchestrator.js:1541`，`config.proactive`）调概率和间隔；
   - 长期记忆工具持久化跨运行印象；
   - `activeTopic` 话题状态已有雏形；
   - 审批等待期本身就是天然的"延迟满足"叙事素材（"等主人批中，先唠点别的"）。

放开沙箱决定它**能干什么**；审批框架决定它**干之前要说什么**；
无状态会话 + 主动定时器决定它**什么时候开口**。三者互不冲突。

## 6. 建议实施顺序

| 阶段 | 内容 | 风险 |
|---|---|---|
| P0 | L0 分级 + L1 审批队列 + 控制台审批页 | 纯新增，现有工具语义不变 |
| P1 | L2 QQ 私聊审批通道（主人） | 依赖 owner-identity |
| P2 | L3 规则 + LLM 自动审核 | 复用 persona-review 调用模式 |
| P3 | L4 隔间化的 shell/代码执行工具（**默认全关**） | 依赖 P0-P2 全就位 |

反向约束（DSH 经验）：任何一层做不出来，**整体保持 fail-closed**，
不要为了"能用"把某层降级成直通。

---

*本文只做现状核对与方案参照，未改动任何运行配置、未提交代码。*
*引用的提交（`4fbd6b2` 等）与文件行号以 2026-10-20 工作区为准。