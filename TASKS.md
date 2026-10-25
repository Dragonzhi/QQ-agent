# QQ-agent

status: 进行中
next: 「上下文插话判定」已接线并上线（2026-10-25 17:24 重启，PID 49788）：原生触发全没命中时会问一次小模型「这句有没有我的戏份」，要接才开会话。插件参数已调成能跑（maxTokens 768 / timeout 22s，主模型会思考，64 token 必然被 reasoning 吃光）。下一步：观察一天判定质量与插话频率，再决定要不要回调滑条（当前 3 档 14.3% 偏静）。
updated: 2026-10-25

## 待办

> 怎么读：一条一句话，标了「谁做 / 多久」。历史过程与已结清的账在下面的交接摘要、工作留痕里，不在这一节。

- [ ] 【你 · 10 分钟】审掉复盘待审：设置页现有 5 条（2 条回复示例 + 3 条群梗），逐条点「晋升」或「驳回」。驳回后同名不会再收，不用删。
- [ ] 【你 · 1 分钟】定插话频率：判定已接线，先按现在的 3 档 14.3% 观察一两天。太闷 → 滑条抬到 45 左右或参与度调回「普通群友」；还吵 → 压到 2 档（只认关键词）。
- [ ] 【可代做】看插话判定的质量：翻 `data/logs` 里的 `[chime]` 行，确认「该接的接了、别人的局没插」；偏吵就调 `confidenceThreshold`，偏静就调 `cooldownSec`/`judgeProbability`。
- [ ] 【你定 · 大】「自主摸鱼」要不要做：让它自己刷视频/看帖、主动开话题。含 4 个子项：① proactive 加"摸鱼"选项；② 事件驱动插件（轮询 UP 主/RSS，有更新才唤醒）；③ 私聊也放开摸鱼；④ 安全分层（自己看=safe，分享才走发送闸）。一行没动，是新一轮开发。
- [ ] 【暂缓】MC 方向收尾：你说过先不玩 MC，代码与既有验证都留着，恢复时再验运行实例（见「进行中」）。

## 进行中

- [ ] 「自主摸鱼」方向：方案 A（proactive 语义扩展）与 B（事件驱动插件）已与用户确认方向，实现未开始（明细见待办最后一条）。
- [ ] 【暂缓·MC 方向】MC 玩家技能收尾核对：P0/P1/皮肤/版本化/事件驱动分享均已完成且已核对确实在当前树；任意版本/Java 选择与自主循环未在运行实例复验。2026-10-23 起降级暂缓（近期不安排 AI 进游戏，优先 meme）；恢复时再验运行实例。

## 已完成

- [x] 【Meme·插话】把闲置的「上下文插话判定」接上线（2026-10-25）：`plugins/context-chime` 早就提供了 `reply.interest-judge`（"这句有没有我的戏份"，一次极短模型调用），但 `src/` 里**从来没有调用方** —— 装上了、加载了、一次都没被叫过。本次在 `src/orchestrator.js` 接线：`onIncoming` 里原生触发（@/关键词/随机）全没命中时调一次判定，`{respond:true}` 就按 tier 3 / 原因「上下文相关（插话判定：why）」排定唤醒，否则与原生"未触发"完全一致地标已读；`wake()` 增加 chime 分支，避免重掷随机档把原因写成"未触发"却照跑。边界：1 档（仅艾特）不调（用户显式要求"只认 @"）、私聊/通话不调、插件缺失或抛错一律 fail-closed 当"不接"、同一群判定进行中不再并发判定。踩坑两条：① `cfg.api.apiKey` 是"手动模式"遗留字段，直传会 **HTTP 401**，必须用 `resolveApiKey(cfg)` 解析；② 本机主模型 `deepseek/deepseek-v4.1-flash` 走 commandcode 网关时**思考关不掉**（网关方言不在 thinking.js 识别表里），插件默认 `maxTokens=64` 会被 reasoning 吃光 → 正文空 → 判定静默失效；实测把 `maxTokens` 调到 768、`timeoutMs` 22000 后可用（2.2~6.8s，623+67 / 642+547 token），两次探针判定质量正确（"刚说过话，非直接点名，避免连发"→不接；"点名叫肥鱼，明显在喊机器人算题"→接 88%）。验证：新增 `test/context-chime-wiring-test.mjs` 7/7（要接排唤醒、不接标已读、无插件回原生、1 档不调、抛错 fail-closed、@ 命中不调、并发去重）并挂进 `npm test`；运行实例 17:24 重启（PID 49788），17:29 已实测走通真实链路。未验证：判定质量在真实群聊长期表现。
- [x] 【Meme】「莫名插话」整改：把默认值从「接话」翻成「沉默」（2026-10-25）：用户截图反馈「话题明明没指向它，它却莫名其妙出来说一句」。先取证：那次发言的会话记录 `data/sessions/mvmmk79g-3456c89a.json` 显示唤醒原因是 `随机命中(67%)`（滑条 72.51 = 3 档 75% 随机），触发消息「别骂我呗」`atMe=false`——没人叫它，是抽签叫它的。再回测该群近 36h 的 39 次随机命中发言，定位成三层叠加：① 水龙头太大（每条群消息独立掷骰，75% 命中 ≈ 每天 20+ 次插话，被 @ 只占 4%）；② 提示词把默认值设在「参与」那一侧（`participation=medium`「能接的话题就接」+「即使没人 @ 你也值得主动参与」+「不要因为路过就默认划走」，模型被叫来时的任务是"找一句能接的话"而不是"判断这话跟有没有关"）；③ 2 秒聚批把两人互怼整段带入，模型把自己当成对话里的第三人。修法（代码 + 配置）：`src/prompt.js` 的 `speakOrNot()` 改为「默认不开口 + 白名单例外（被@/被问、撞梗或记忆、冷场有内容）+ 别人的局不插话（两人互怼/@或引用别人/合并转发）」；`notAQueue()` 删掉「不要因为路过就默认划走」，改成「旁观机会：默认划走」；`participationText('medium')`（新建配置的默认档）从「能接的话题就接」改成「大部分时候看戏」；`src/personas.js:28` 同步去矛盾（原句「别习惯性潜水…主动参与」）。配置经 `POST /api/config` 落盘：`store.contextSliderPos` 72.51→30（3 档 14.3% 随机）、`persona.participation` medium→low，免重启即时生效。验证：`node test/test-prompt.mjs` 全过（新增第 13 节锁住新默认值、并断言旧反向措辞已消失）；`npm test` 55/64，9 项失败经 stash 对照确认为技能清单存量问题（minecraft/qqzone 等，与本改无关）。重启排障：重启前发现实例已于 00:49 静默退出（无错误日志、锁文件已释放，原因未能从日志确定）；`scripts/restart-app.mjs` 起新实例后 OneBot 连不上（SnowLuma 起在 01:01:36 但没有 `[Hook] login detected`），`POST /api/qq-portable/launch` 拉起便携 QQ 后 5 分钟内自动登录恢复（UIN 2107255986，未要求扫码）。已提交 `6ada1f0`、已推送。
  - 效果回测（2026-10-25 17:00，整改后 16 小时）：全群发言 131 条/天 → 15 条/天（−89%），同期群活跃度没有下降（984686890 收到 212 条 vs 整改前 24h 119 条）。**明显偏静**：随机命中只剩 3 次（整改前 96 次/24h），主因是「连发合并」插件把 4 秒内的消息并成一批，实际掷骰次数远低于消息条数。回调未做（用户 2026-10-25 决定「插话先不需要改」）；配合本次接线的插话判定，静的问题可交由判定补回来。
- [x] 【工程】QQ-Agent 重启工具化（2026-10-23）：手工重启踩了两次坑（`ELECTRON_RUN_AS_NODE=1` 让 electron 退化成 Node、只杀主进程留下 SnowLuma 孤儿），于是固化成 ① 脚本 `scripts/restart-app.mjs`（读 `data/qq-agent.lock` 拿 PID → `taskkill /T /F` 停树 → 清 `ELECTRON_RUN_AS_NODE` 后拉起，自动沿用 electron/headless 方式 → 等锁换新 PID 且 `http://127.0.0.1:<server.port>/api/config` 200 → 报 OneBot 连接与 `persona.review` 阈值；支持 `--electron`/`--headless`）② 项目 skill `.agents/skills/qq-agent-restart/SKILL.md`（何时需要重启 vs 热重载、手工兜底步骤、坑清单；因 `.gitignore` 的 `skills/` 规则，该 skill 只在本机生效、不入库）。实测：57488 → 59712 一次通过，控制台 200、OneBot 已连接。已提交 `c4e72ee`。

- [x] 【Meme】复盘「收梗质量闸」（2026-10-23）：真实复盘一次收 13 条群梗 + 6 条示例，多数算不上梗（随机数字、"？这啥"、"九格那个也行"、普通问答），人工筛不过来。① 样本与提示词收紧：任务一只喂「后面有群友接话」的回复（没人接的样本是垃圾示例主要来源），提示词明确「梗」定义（反复出现/固定含义/外部查不到）、给正反例、要求 `confidence` 自评与 `evidence`/`why` 自证、宁缺毋滥；② 落盘闸：`minConfidence`（默认 0.72）以下丢弃，占位符/纯数字/水回复/复读触发句丢弃，群梗无 `evidence` 丢弃，每群每次最多 `maxMemesPerChat`（默认 2）条；③ 去重：示例的 rejected 也参与去重（此前往返重收）；④ 设置页新增「可信度门槛」「每群梗上限」，两处待审行展示「依据/可信度」并加「**驳回**」按钮（驳回=rejected，不删除、参与去重）。验证：persona-review-test 6/6（含质量闸专项）、test-prompt、prompt-anchor、render-test 85、coverage-wiring 5/5；未重启实例、未真实跑复盘；已提交 `719bb30`。

- [x] 【Meme】回复示例增加「梗解释」（`note`）字段（2026-10-23）：示例原字段 trigger/good/bad 只能教句式，模型不认识群内黑话（截图里的「龙🐉可是帝王之征」「胶固」）就学不到含义。① 后端：`prompt.js` 渲染「梗解释：」行（空白不渲染）；`persona-review.js` 复盘起草时要求并落盘 note（单行化 + 160 字截断，缺省空串不阻塞草稿）；`routes.js` capture 预填空串、手动添加/编辑读写 note；`config.js` 字段注释同步。② 前端：面板带 note 时折第二行展示、手动添加表单加输入、编辑弹窗加 textarea（顺修弹窗未回填 bad 的存量 bug——此前编辑会把反例静默清空）。③ 测试：复盘 note 落盘/缺省、提示词渲染/空白不渲染、HTTP capture+POST+PUT 用例。验证：persona-review-test 4/4、test-prompt、prompt-anchor、render-test 85、coverage-wiring 5/5、coverage-http 127 过 1 失败（失败为既有 `qq-portable/launch` 环境项）。已提交 `719bb30`。

- [x] 【工程】撤回并行 worktree、回到单仓开发（2026-10-22）：核对两处 worktree 与 3 条方向分支相对 main 均 0 独有提交、`skills/` 与主仓逐文件一致、plugins 工作树同为 116d29c 且无独有提交，确认无代码可丢；把两侧 TASKS.md／WORKSPACE.md／baseline.json 归档到 `.goal-baseline/isolation-20261021/worktrees/`，删除 `E:\QQRobot\QQ-agent-memes`、`E:\QQRobot\QQ-agent-minecraft`（各约 587MB）及插件仓库内对应工作树，删除 5 条零提交分支（`feat/memes`、`feat/minecraft`、`feature/voice-bridge`、`codex/qq-agent-memes-plugins`、`codex/qq-agent-minecraft-plugins`），并把原先分流的梗收集与 MC 收尾任务收回本文件。未提交、未推送。

- [x] 【minecraft 方向】定掌技能侧是否跟随 worktree 的 src/：已实测 ESM 会把 junction 路径规范化成主工作区真身（技能+runner 默认走主工作区的 src/*、data/*、runtime/*）；要 worktree 侧 src/ 对技能生效，启动需加 `NODE_OPTIONS=--preserve-symlinks`（已实测可保留联接路径，但两套 src/* 会同时驻留进程）。（改为独立技能副本，按默认 Node 解析即可指向本工作区；无需 preserve-symlinks。）

- [x] 各方向 worktree 装依赖：node_modules 被 .gitignore 挡着不共享；进各 worktree 跑 `pnpm install`（store 硬链，几乎不占额外空间）。（两边实际使用 npm ci --ignore-scripts，450 packages；未执行安装脚本，桌面启动未验证。）

- [x] 【minecraft 方向】在案屿里定义 `E:\\QQRobot\\QQ-agent-minecraft`（分支 feat/minecraft）的任务清单——本轮只建好环境，方向内容未列，不空想猜。（已按方向整理，见对应 TASKS.md 与 WORKSPACE.md。）

- [x] 【memes 方向】在案屿里定义 `E:\\QQRobot\\QQ-agent-memes`（分支 feat/memes）的任务清单——本轮只建好环境，方向内容未列，不凭空猜。（已按方向整理，见对应 TASKS.md 与 WORKSPACE.md。）

- [x] 预算停机体验优化：用户遇到 30 万预算耗尽循环停止（bot 傻站服务器）。改为：停机时游戏内告别 + 60 秒后自动优雅下线（存盘关服）；预算上限默认 30 万→100 万（约 6~8 小时）。2026-10-20
- [x] 调研+实施"让它真的会玩"（012）：读透 Voyager/MindCraft 源码。① 反射模式层 modes.mjs（保命/怯战/脱困/捡物/插把，500ms 检查，5 个可关）；② 知识层：MC 生存手册 + 实体相对描述（距离·方向·高低）+ ASCII 俯视图 + think 字段；③ 动作层：searchFor/collect/craft/attack(修 hostile 过滤 bug,支持按名字+远追)/flee/digDown(安全阀)/goToSurface/rememberHere/collectItems + 方块别名表 + 字符串动作解析。实测：击杀僵尸、捡物、被围夜逃、think 战术合理。2026-10-20
- [x] 【游戏】页签·模型视角：点动态流任意一轮看该轮的思考/提示词输入/原始输出/执行链；循环日记加全过程字段（reasoning/raw/promptUser/durationMs/会话头）。2026-10-19
- [x] 控制台【游戏】页签：index.html 导航+区块、13-game.js 页面模块（3s 轮询/离开即停）、00-core switchTab 接线、11-init 启动、style.css 样式；routes /api/game/state + /api/game/control（能力消费）；技能提供 game.state/game.control（providers 导出+manifest 声明）。接线测试 5/5 过（850 元素）；skill-test 24 项过；game.state 快照模拟实测通过。2026-10-19：实时实况（身体状态/轮次/token/动态流/游戏内聊天）+ 上线/下线按钮；路由与能力全部游戏无关命名（game.state/game.control），后续别的游戏可直接接入。2026-10-19
- [x] MC 控制台可见性：app.js 注册 mc.session 能力（create/activity/stats/usage/finish）+ 技能侧轮询同步（20s）；游戏会话进存档页（实时活动状态）+ 循环用量进用量页（addExternalUsage，游标去重）；runner 掉线自动收档。模拟链路实测通过，skill-test 24 项全过。2026-10-19
- [x] MC 管理员自动化：ops 设置（默认 Dragon_Zhi）+ runner 启动时 ensureOps 幂等写入（离线 UUID 自动算，算法用 Xiaojingyu 已知 UUID 验证）；实测服务端回应 "already is an operator"。2026-10-19
- [x] MC 事件驱动分享：循环决策 share 字段 → runner 出站箱 → 应用侧轮询 → LLM 转写成群聊口气 → test-send 投递；会话内 15 分钟 + 应用侧 45 分钟/日 6 条三层闸 + 转写器二审。端到端实测通过（私聊收到“僵尸矿洞嘤嘤嘤”）。2026-10-19
- [x] MC 游戏循环 P1：runner 内 GameLoop（观察→LLM JSON 决策→执行→日记 JSONL）；游戏内玩家发言可驱动（喊名/问号立刻插轮）；token 预算/空闲/失败多重停机；mc_status 展示循环状态。实测：bot 自主移动并捡物品（位置 -3.5→6.6，背包 15→42 泥土）、观众 bot 进服说话得到游戏内回复。2026-10-19
- [x] MC 自定义皮肤 + 一键围观：SkinsRestorer（Hangar 15.12.6）+ `.customskin` 文件注册 + URL 改写本地方案；bot 进服自动换肤（"[SkinsRestorer] Your skin changed." 实测）；runner serve /skin.png；mc_online 自动把「小鲸鱼的世界 127.0.0.1:25565」写进客户端 servers.dat（根+同版本目录，带备份、幂等）。2026-10-19
- [x] MC 任意版本支持：`javaPath` 设置 + 按服务端版本自动选 Java（1.16.5-→8 / 1.17~1.20.4→17 / 1.20.5+→21，选满足要求的最低版本）；README 补服务端软件×版本×Java 对照表；pickJava 单测 9 例全过、冒烟测试回归通过。2026-10-19
- [x] MC 玩家技能 P0（`skills/minecraft/`）：Paper 1.20.1 本地服 + mineflayer bot + HTTP 控制通道 runner；工具 mc_online/mc_status/mc_observe/mc_act/mc_offline 全部注册并冒烟通过（起服→进服→观察→说话→挖掘→关机→世界落盘）。2026-10-18
- [x] agent 自由度安全治理分析（`doc/agent-freedom-security-analysis.md`，随 671ec01 提交）：盘点现状四层（装机时 permissions 授权 / 网络白名单+SSRF / 内容级 pending 审批 / 主人识别），指出缺“运行时危险动作 → 管理员批准”一层；参照 DSH 沙箱契约（默认关+按次申请+最小权限+一次性+fail-closed）、Claude Code、Codex、OpenHands、LangGraph，给出 L0 风险分级 → L1 审批队列（复用 pending 状态机）→ L2 QQ 私聊审批通道 → L3 LLM 自动审核 → L4 执行隔间（照抄 minecraft runner 子进程范式）的方案与 P0-P3 实施顺序。2026-10-20
- [x] 并行开发环境（工程侧）：`git fetch --all --prune` 后确认 main（671ec01）存在且与 origin/main 同步；从 main 创建 worktree `feat/memes` → `E:\\QQRobot\\QQ-agent-memes`（分支与目标目录原先均不存在，未覆盖/未删除/未强推；未暂存/未提交/未合并/未推送）。worktree 的 `skills/`、`plugins/` 以目录 junction 软链接到主工作区 `E:\\QQRobot\\QQ-agent`（14 skills + 21 plugins 可见，readdir 透传，git status 干净——二者均被 .gitignore）。`data/`、`runtime/` 刻意不链接：data 须每实例独立（instance-lock 本就禁止双实例），runtime 含 1.6GB 便携 QQ 且双实例并发有进程冲突风险。2026-10-21
- [x] 核对 MC 事件驱动分享实现是否在当前代码（2026-10-20 留痕称与记录不符）：2026-10-21 在主工作区逐项核对——loop.mjs 有 share 决策+outbox、runner.mjs 有 /outbox、index.js 有分享轮询+test-send、skill.json 有 share 设置，代码一无缺失；`data/minecraft-share-state.json` 不存在只说明此后没有分享触发过。结论：实现未丢失，此前的“不符”是核对上下文有误。 2026-10-21
- [x] git 合并与推送（2026-10-20 晚）：把 feature/voice-bridge 上全部工作快进合并进 main 并推送 origin（1dd73e7..671ec01，41 文件 +5820/-98）。合并前新提交两笔：`37259c8` feat(game) 控制台「游戏」页筩+ 游戏无关能力（routes/app.js/tool-registry 的 game 分类、ui 13-game.js、冒烟测试、起服脚本、mineflayer 依赖）、`671ec01` doc 交接记录+安全治理分析。合并前验证：skill-test 24/24、coverage-wiring 5/5、render-test 85、skill-modal-ui 32、scroll-test 17、prompt-anchor 全通；顺修 routes.js 缩进、注册 game 工具分类、补 minecraft serverDir/botHost 的 configSchema、删临时脚本。tools-skill-audit 余 9 项失败均为其他技能存量问题（qqzone/qzone-diary 分类、whale-memes 空 required、pixiv schema、qukan 能力未实现等），MC 相关项已清零。 2026-10-20
- [x] 并行开发环境（minecraft 方向，工程侧）：从 main（671ec01）创建 worktree `feat/minecraft` → `E:\\QQRobot\\QQ-agent-minecraft`（分支与目标目录原先均不存在，未覆盖/未强推/未暂存/未提交/未合并/未推送；主工作区保持 main 不动）。沿用既定约定：`skills/`、`plugins/` 以目录 junction 链接主工作区（14 skills + 23 plugins 可见、readdir 透传、worktree git status 干净）；`data/`、`runtime/` 不链接（实例隔离/便携 QQ 体积与进程冲突），仅把 `data/config.json` 复制成种子供该实例启动。已实测结论：ESM 加载会把 junction 路径规范化成主工作区真身（探针验证 import.meta.url），即技能及其 runner 默认跑主工作区的 src/*、data/*、runtime/*——MC 的世界/运行时文件仍归主工作区，worktree 侧改 src/ 不会被技能看到；要翻转需 `NODE_OPTIONS=--preserve-symlinks`（已实测有效）。 2026-10-21

以下开发结果属于历史工作，本轮仅核对现有提交和相关源码；不代表本轮重新实现或重新验证。

- [x] 回复示例库 P0/P1：提示词示例注入、存档一键收藏、示例库管理面板（`ee6aa5a`）。
- [x] 每晚复盘 P2：LLM 起草候选示例、群内梗收集与待审晋升、复盘用量记账（`01f94d3`）。
- [x] 加入「接话要有内容」核心规则及话题热身卡测试（`b236ec1`）；本地 `skills/topic-warmup/` 本体不入主仓库。
- [x] 修复复盘读取 LLM 返回结构错误，改用扁平结构 `message.content`，并增加契约回归测试（`c6f6120`）。
- [x] 修复思考模型耗尽输出预算导致正文截空：先提高到 8000（`95ea254`），后将示例起草、群梗收集两路均提高到 12000，并收紧测试守卫（`fce7c8f`）。
- [x] 补充示例库增删改审计日志，删除时保留完整内容供恢复（`4fbd6b2`）。
- [x] 群内梗库支持编辑梗名、含义与例句，编辑不改变审批状态（`81dba96`）。
- [x] 整理本文件：补齐任务清单，合并重复交接信息，更新预算说明，区分历史验证、本轮核对与未验证事项。

## 交接摘要

### 2026-10-25 插话判定接线 + TASKS 整理（当前有效）

- **做了什么**：把 `plugins/context-chime`（上下文插话判定）从"装着但没人调"接到核心。`src/orchestrator.js` 新增 `#tryInterestJudge` / `#runInterestJudge`，在 `onIncoming` 的原生触发全没命中处调用能力 `reply.interest-judge`；`wake()` 增加 chime 分支记录触发原因「上下文相关（插话判定：why）」。新增 `test/context-chime-wiring-test.mjs`（7/7）并挂进 `npm test`。插件设置经 `POST /api/skills/context-chime` 落盘为 `maxTokens=768 / timeoutMs=22000`。
- **两个必须记住的坑**：① 判定请求要传 `resolveApiKey(cfg)` 解析后的 Key —— `cfg.api.apiKey` 是手动模式遗留字段，直传会 HTTP 401；② 本机主模型走 commandcode 网关**关不掉思考**（`thinking.js` 的方言表没识别这个网关），插件默认 `maxTokens=64` 必然被 reasoning 吃光、正文为空、判定静默失效，必须给到 768 且把超时放宽到 22s（实测 2.2~6.8s、每次 620+ 输入 + 70~550 输出 token）。
- **接线后的行为变化**：没被 @ 的消息不再只有"掷骰子"一条路 —— 但**1 档（仅艾特）刻意不调**，避免偷偷推翻用户在 UI 上选的"只认 @"。插件自带同群冷却 12s、短消息跳过、单群每日上限 400，成本有闸。
- **本次重写 TASKS.md 结清的旧账**（内容已并入上文，不再单列）：① 「核对实例是否已加载 fce7c8f / 81dba96」—— 两个提交都在 HEAD，实例此后重启多次，过期；② 「手动点立即跑一次」「一晚自动复盘验收」—— 2026-10-24 20:00 已自动跑成（示例 2 条、群梗 3 条、质量闸拦下 0、扫描 4 个会话、88 秒），等价于已验收；③ 「按实际复盘输出优化梗收集」「人设示例库与群梗学习实战验收」—— 与 Meme 验收重复；④ 「观察 topic-warmup / trendy-memes」—— 长期观察项，不是任务；⑤ 「自主摸鱼方向」进行中那条 —— 与待办 4 个子项重复。
- **更正过的陈旧事实**：复盘时间不是历史记录里的 04:00，当前配置是**每日 20:00**；`persona.review = {enabled, hour:20, maxDrafts:6, groupMemes, minConfidence:0.72, maxMemesPerChat:2}`。
- **未验证**：插话判定在真实群聊的长期判定质量（是偏吵还是偏静）；`participation=low` + 提示词整改 + 判定三者叠加后的最终发言频率。

### 2026-10-25 莫名插话整改：把默认值从「接话」翻成「沉默」（当前有效）

- 用户反馈（带截图）：群里话题明明没指向机器人，它却「莫名其妙出来说一句」。截图那条是两个群友互怼（「我鸟都不鸟你」→「[表情13]」→「别骂我呗」），机器人接了句「谁骂你了 我还没开口呢」。
- 取证：`data/sessions/mvmmk79g-3456c89a.json` 的 `contextTier=3`、`contextReason="随机命中(67%)"`，触发消息 `atMe=false`——唤醒它的是 75% 的随机抽签，不是任何人。回测该群（592931715）近 36h 的 39 次「随机命中且发言」：约 13% 属于插入别人的局，其余多数是对图片/游戏话题的正常吐槽；同时 51% 的会话醒来后 `noreply`（白烧一次 LLM 调用）。
- 三层根因：① 滑条 72.51 = 3 档 75% 随机，且每条消息独立掷骰，产品语义变成「任何消息都可能召唤我」；② 提示词通篇教「主动参与」（`即使没人 @ 你也值得主动参与`、`没被叫但有话题也主动参与`、`不要因为"路过"就默认划走`），与人设里早已写对的规则（`personas.js:34-36`「群里不是每句话都是对你说的」）互相打架，且赢的是嗓门大的那边；③ 2 秒聚批把 A→B→A 的互怼整段带入上下文，模型把自己当对话里的第三人。
- 修法：提示词改默认值（默认不开口 + 三条例外 + 「别人的局不插话」）+ 配置降频（滑条→30 ≈14.3% 随机、participation→low）。**没有做本地「别人的局」闸门**——回测过三个候选规则（@别人 / 引用别人 / 窗口内≤2 人且自己最近没说话），最好的一档也只能在拦 8 条里抓住 2 条目标、误伤 6 条合理回复，精度不够，强行上线会把群里正常的接梗一起杀掉。这一条留给以后有更强信号（或小模型分类器）时再做。
- 生效状态：2026-10-25 01:01 用 `node scripts/restart-app.mjs` 重启（新 PID 35600），01:05 经 `POST /api/config` 落盘新配置；OneBot 在便携 QQ 重新登录后恢复连接（UIN 2107255986）。
- 排障记录（两次都不是本改引起，但都撞上了）：① 重启前发现运行实例已于 00:49 静默退出——日志无错误、实例锁已释放，原因未能从日志确定，怀疑是窗口被关或进程被外部结束；② 新实例起后 OneBot 连不上（`ECONNREFUSED 127.0.0.1:3001`，SnowLuma 只有 starting/WebUI 两行、没有 `[Hook] login detected`），`POST /api/qq-portable/launch` 拉起便携 QQ 后约 5 分钟自动登录恢复，未要求扫码。
- 未验证：新默认值在真实群聊上的实际效果（发言频次、是否变得太闷）；`participation=low` 与提示词整改可能叠加过度，若群里彻底不说话就把参与度调回 medium 或把滑条抬到 40+。工作区仍有未提交的「心事本（mind）」改动（非本轮产生，未触碰）。

### 2026-10-23 收梗质量闸：回应「明明算不上梗却总收进待审」（当前有效）

- 诊断（有数据）：今天 20:00 那轮复盘日志显示「示例 6 条、群梗 13 条」；用户随后删掉了 18 条待审示例（删除日志留档）。抽样可见随机数字（19959878509 405360）、水回复（"？这啥""九格那个也行"）、图片占位（[图片][图片]）、普通问答都进了待审。根因：提示词松（只说"找梗"）、无每群上限、无质量闸、示例去重不拦 rejected。
- 修法：任务一样本只取「有群友接话」的回复（此前约半数样本没人理，模型只能硬挑）+ 提示词收紧 + 落盘闸（confidence 门槛/噪音与水句启发式/evidence 必填/每群上限）+ 驳回按钮（rejected 参与去重，示例也改）。阈值在设置页「每晚复盘」里可调：可信度门槛默认 0.72、每群梗上限默认 2。
- 副作用与边界：宁可漏收，不再拿垃圾占待审位；弱模型可能自评虚高，所以本地启发式与「驳回记忆」是兜底。旧待审条目没有 confidence/evidence，面板照常显示但无元信息。
- 重启验证（2026-10-23 21:33）：Electron 实例已重启（PID 57488，旧进程 61268 强杀）；`GET /api/config` 已返回 `persona.review.minConfidence=0.72`、`maxMemesPerChat=2`，控制台 `http://127.0.0.1:3210` 就绪，OneBot（SnowLuma）连接成功。实例锁已更新为新 PID，便携 QQ 未重启（无需重新登录）。
- 操作注意：本会话环境带 `ELECTRON_RUN_AS_NODE=1`，直接 `electron.exe` 启动会被当成普通 Node 运行并报 `cjsPreparseModuleExports` 错；启动前须 unset 该变量（本次用 `env -u ELECTRON_RUN_AS_NODE` 启动）。
- 重启工具化（2026-10-23）：`scripts/restart-app.mjs`（入 git）+ 项目 skill `.agents/skills/qq-agent-restart/SKILL.md`。`.gitignore` 已显式放行 `.agents/skills/`（原 `skills/` 规则按目录名匹配会误伤），`isle` skill 也一并入库。以后重启直接 `node scripts/restart-app.mjs`；同日 21:40 用它把实例从 57488 换到 59712，一次通过。
- 提交整理（2026-10-23）：拆成 `719bb30` feat(persona)（示例梗解释 + 收梗质量闸）、`c4e72ee` chore(dev)（重启脚本 + 项目 skill + `.gitignore`）两笔，本文件记录另有 docs 提交；用 hunk 级暂存把工作区里未提交的「心事本（mind）」WIP 排除在外。已推送 origin（55f8d7c）。注意：在 Agent/CI shell 里推送必须带 `GCM_INTERACTIVE=never`（如 `GCM_INTERACTIVE=never git push origin main`），否则 Windows 凭据管理器会等交互，命令表面挂死；`git ls-remote` 不受影响，所以容易误判成网络问题。
- 未验证：新提示词在真实群聊上的实际拦下比例、模型自评可信度是否靠谱；尚未跑真实复盘（旧待审数据没有 confidence/evidence，面板照常显示）。
- 工作区仍有未提交的「心事本（mind）」改动（非本轮产生，未触碰）。

### 2026-10-23 优先级调整：meme 先行、MC 降级；示例加「梗解释」

- 方向取舍（用户决定）：先把 meme／人设示例与接梗做透，Minecraft 部分降级暂缓——近期不安排 AI 进游戏。MC 代码与既有验证保留（`skills/minecraft` 本地不入公开库；游戏页签/控制能力已随 37259c8 提交），恢复时再验任意版本/Java 与自主循环，不排新活。
- 截图里那部分是「回复示例库」（`trigger + good + bad`），不是群内梗库；群梗（per-chat）在 P2 就有 `meaning` 且会注入【群内梗】段。示例库原先缺「含义」通道，本次补 `note`：模型看到的示例块变成「群友：X / 梗解释：… / 你可以：Y」，才学得到为什么这样接。
- 落点：`src/prompt.js` 渲染、`src/persona-review.js` 复盘起草生成、`src/routes.js` 读写（capture/POST/PUT）、`ui/app/07`／`08` 面板与弹窗、`ui/style.css` 折行布局、`doc/persona-meme-plan.md` 同步。旧条目无 note 照常工作；空白不渲染；note 单行 160 字上限。
- 未验证：真实复盘草稿的 note 质量与准确性、补写解释后的接梗效果；未重启运行实例、未调用模型。
- 工作区另有未提交的「心事本（mind）」改动（`src/mind.js`、`src/tools.js`、`src/orchestrator.js`、`package.json`、`ui/app/06-settings-render.js`、`ui/index.html`、`test/selftest.mjs`，以及 `config.js`／`prompt.js`／`08-modals.js` 内的 mind 片段），不是本轮产生；本轮未改动其逻辑，提交前请确认作者与完成度。

### 2026-10-22 撤回并行 worktree

- 并行开发实际未产出：两个 worktree 及全部方向分支相对 main 都是 0 提交，`skills/` 与主仓逐文件一致，`plugins/` 工作树停在 116d29c 无独有提交。根因是运行约束而非流程细节——同一台机器只能跑一个 QQ/机器人实例（instance-lock、端口、便携 QQ 数据目录），两个方向无法同时验收；加上共享 `TASKS.md` 的 next／摘要／留痕每轮都要人工收敛，成本高于收益。结论：回到主仓 `main` 单线开发。
- 已删除：worktree `E:\QQRobot\QQ-agent-memes`、`E:\QQRobot\QQ-agent-minecraft`（各 587MB，主体是各自 node_modules）及二者在插件仓库 `E:\QQRobot\qq-agent-plugins.git` 中的工作树；分支 `feat/memes`、`feat/minecraft`、`feature/voice-bridge`（均已在 main 中）、`codex/qq-agent-memes-plugins`、`codex/qq-agent-minecraft-plugins`（均为 116d29c）。`git worktree list` 现在只剩主工作区，插件仓库同样只剩主工作区。
- 回收内容：两侧改写的 TASKS.md、WORKSPACE.md、baseline.json 与 VS Code 工作区文件已归档到 `.goal-baseline/isolation-20261021/worktrees/`；原先分流的七项梗收集待办、MC 收尾核对与人设实战验收已收回本文件，不再区分「主目录／方向工作区」。
- 现状：`main` = `origin/main` = 671ec01，未提交改动只有本文件的记录更新；`plugins` 仓 main 领先 origin 6 个提交（既有状态，本轮未推送）。本轮未启动机器人/QQ/MC、未调用模型、未跑测试。
- 旧的 worktree 说明（junction、`--preserve-symlinks`、独立技能副本、按方向合并）仅作历史保留，已无可操作对象；后续任何改动直接提交 `main`。

### 2026-10-21 工作区隔离修正（2026-10-22 已撤回，见上）
- 原六项梗收集待办及其进行中任务曾分流到 QQ-agent-memes/TASKS.md；MC 收尾进行中任务曾分流到 QQ-agent-minecraft/TASKS.md（2026-10-22 已收回本文件）。主目录保留自主摸鱼、安全治理与方向合并任务。
- 两个方向已按名称加入案屿真实清单，项目级 isle Skill 均已补齐，三条线自动归为 QQ-agent 一组。
- 原共享 skills/plugins 方案已替换：两边技能独立副本、插件独立 Git worktree 分支；基线与原链接备份见各目录 .goal-baseline/isolation-20261021，具体保存／合并边界见 WORKSPACE.md。先前关于“技能默认回到主目录”的描述仅适用于已移走的旧 junction。
- 两份方向任务已重新分流，MC 的 P1 未开始等旧提示已纠正；主目录无关任务与历史保留。两边依赖安装成功（忽略安装脚本），未启动机器人、QQ、MC 或调用模型。独立运行与端口验收仍待完成。

### MC 玩家技能（2026-10-18 的历史 P0 记录）

- 新增 `skills/minecraft/`：`index.js`（Skill 入口+工具注册）、`runner.mjs`（独立子进程：Paper 服务端 + mineflayer bot + 127.0.0.1:25580 控制通道）、`skill.json`（含"你是真的在玩 MC"提示词片段）、`README.md`。
- 依赖已装：`mineflayer@4.39.0`、`mineflayer-pathfinder@2.4.5`（写进 package.json）。服务端 jar 在 `runtime/minecraft-server/paper-1.20.1-196.jar`（sha256 校验过），`server.properties` 为 offline 模式 + 绑 127.0.0.1。
- 冒烟测试 `test/minecraft-spike.mjs`（手动跑，未接 npm test）：起服→playing→observe→chat→dig→stop→世界落盘全过，约 56s。
- 踩坑记录：① MC 用户名只允许 `[a-zA-Z0-9_]`，默认 Xiaojingyu；② `loadPlugin` 在连接前只入队，`setMovements` 必须等 spawn 后；③ 1.20 登录连发两次 spawn，observe/act 需防 entity 未就绪；④ runner 关机必须等 java 真正退出再退（否则世界不落盘）；⑤ 控制端口 EADDRINUSE 时要直接退出，防止双 runner。
- bot 不需要用户正版账号：作为第二个玩家进本地服；用户用正版客户端连 `127.0.0.1:25565` 围观即可（offline 服收正版客户端）。
- `skills/` 与 `runtime/` 均被 .gitignore 排除（项目惯例），本体只在本地。
- 2026-10-19 追加（皮肤/围观）：皮肤文件默认 `C:\Users\32485\Pictures\肥鱼\DeepSeek大肥鱼.png`（64x64 标准布局，无需转换）；踩坑：① SkinsRestorer 的 URL 输入拒绝内网地址（localhost/LAN 都试过，报 "The skin URL or file format is invalid"），必须走 file 输入；② `createcustom` 生成的纹理 URL 指向 textures.minecraft.net（自定义皮肤 hash 不存在会 404），必须改写成 runner 本地 URL；③ `/skin` 命令只能玩家身份执行，由 bot 自己 chat 触发；④ `applyskin` 只是重应用当前皮肤，不能指定皮肤。
- 2026-10-19 追加：不限于 Paper——任何单 jar 服务端（原版/Paper/Spigot/Purpur）即换即用；版本覆盖 1.8~1.21.11（mineflayer 4.39 范围）；Java 按版本自动选（本机有 8/17/23 三套）。Fabric/Forge 模组服降级可用（prismarine 类库不认模组内容），「对局域网开放」可玩已有存档但需手动开 LAN。
- 以上为 P0 阶段历史；P1 与分享链路后续已完成（2026-10-19 实测）。2026-10-22 起不再有独立工作区，MC 验收一律在主仓实例进行；不能再按“P1 未开始”重复实现。

### 并行 worktree 与「自主摸鱼」方向（2026-10-21）

以下 junction / preserve-symlinks 说明是隔离前历史；隔离方案与两个 worktree 已于 2026-10-22 撤回（见上），此处仅作历史保留。

- 并行开发环境：两个 worktree 均基于 main 671ec01。`E:\\QQRobot\\QQ-agent-memes`（feat/memes）与 `E:\\QQRobot\\QQ-agent-minecraft`（feat/minecraft）。两者的 `skills/`、`plugins/` 都以目录 junction 链接主工作区（扩展单一事实来源；plugins 本体仍由 `E:\\QQRobot\\qq-agent-plugins.git` 管理）；`data/`、`runtime/` 按约定不链接（data 须每实例独立，instance-lock 本就禁止双实例；runtime 含便携 QQ 且双实例并发有进程冲突风险）。minecraft worktree 额外把 `data/config.json` 复制一份当种子（副本非链接）供启动。
- 已实测关键行为（探针）：ESM 加载会把 junction 路径规范化成主工作区真身（import.meta.url 落在 `E:/QQRobot/QQ-agent/skills/`）。因此技能及其 runner 默认跑主工作区的 `src/*`、`data/*`、`runtime/*`：MC 世界与运行时文件仍归主工作区，而 worktree 侧改 `src/` 不会被技能看到。要翻转这个行为，启动时加 `NODE_OPTIONS=--preserve-symlinks`（已实测可保留联接路径），但两套 `src/*` 会同时驻留进程，需懂这层含义再用。
- 「自主摸鱼」（让胖鱼按自己意愿刷视频、看帖子）方向已与用户确认为 A+B：A = 扩 proactive 语义（`src/orchestrator.js` 定时器已在跑——30~90 分钟随机+概率+挑安静群；把“摸鱼”列为可选项即可；群聊档不裁工具，agent-reach 的 bili_search/web_read/rss_read 是现成能力）；B = 事件驱动插件（定时轮询关注源、有更新才唤醒，参照 hot-trend-tracker 的 setInterval+unref 与 after-response 钩子借 sender 的范式，通知不绕过 SendQueue）。
- 安全边界（承接 doc/agent-freedom-security-analysis.md）：agent-reach 走全局 fetch+自带私网拒绝，不在 browseLock 管控内，“自己看”= 任意联网。先行分层：自己看 = safe 无副作用；分享到群 = 走现有发送闸（白名单+限频），将来挂 L1 审批队列。
- 未验证/待核对：① 两个 worktree 同时运行时会话/热重载行为未测（同一物理 skills 目录被两边 fs.watch，可能双触发 reload＋ instance-lock 本身禁止双实例）；② junction 依赖主工作区路径，主工作区目录移动/删除会导致链接失效；③ `--preserve-symlinks` 模式下的实际启动效果未在真实应用里验证。
### 历史确认变更与入口（2026-10-18）

- 本轮核对分支为 `feature/voice-bridge`，HEAD 为 `81dba96`。历史记录称上述早期提交未推送；本轮未检查远程同步状态，不据此断言当前是否已推送。
- 复盘与群梗核心：`src/persona-review.js`、`src/group-memes.js`；服务在 `src/app.js` 挂载 `startPersonaReviewLoop`。
- 提示词与用量：`src/prompt.js` 注入【群内梗】及人设示例；`src/sessions.js` 提供 `addExternalUsage`；`src/util.js` 导出 `normTrigger`。
- 接口与界面：`src/routes.js` 提供复盘触发与群梗 CRUD；`ui/app/07-settings-events.js`、`ui/app/08-modals.js` 及 `ui/style.css` 负责相关设置与编辑交互。
- 当前源码已确认：示例起草、群梗收集的 `maxTokens` 均为 12000；`test/persona-review-test.mjs` 对两路预算均要求不低于 10000。旧记录中的「8000 已足够」已被后续修复取代。
- 本地 `skills/topic-warmup/` 为纯 `promptSections` 注入型技能：取最近 30 条消息，以子串匹配群梗/网络梗知识库，命中后注入提示词，priority 30，缓存 TTL 60 秒。主仓库仅保留其测试。
- 设计与实施背景见 `doc/persona-meme-plan.md`；历史上已更新 P2 与接梗专项进展，本轮未对该文档另作修改。

### 历史配置、示例与排查记录

以下均来自 2026-10-17 的旧交接记录，本轮未读取活配置、聊天存档或运行日志重新核实。

- 复盘配置曾通过 `POST /api/config` 启用：`persona.review.enabled = true`、`hour = 4`、`maxDrafts` 默认 5。
- 终末地反例原 ID 为 `ex_mvab7z8r_1`，丢失后恢复为 `ex_mvc53i34_1`，恢复时为 `pending`、`source: manual`。触发语为「终末地地图线性浏览没问题，来回锄大地是地狱」，反例回复为「那你逛，我看着」「受着」「确实」。当前内容、状态及是否已晋升未验证。
- 旧排查记录认为删除接口可能导致示例清空；UI 删除有确认框，16:02:13 的配置写入仅同步 SnowLuma 令牌。人工删除只是当时的推测，实际删除原因未确认。
- 旧记录称 12:04:11 已加载 `topic-warmup`；当时未发现 `data/persona-review-state.json`，只能说明当时没有观察到复盘状态文件，不能据此确认从未执行过复盘。
- 旧记录称 16:02 启动的实例含返回结构修复，但尚未加载当晚的预算修复和审计日志。该信息仅用于解释历史故障，不代表当前进程状态。
- 历史观察窗口内 `trendy-memes__` 工具调用为 0，且未发现 `data/trendy-memes/`；当前是否开始触发未验证。

### 验证记录

历史验证（保留原结果，本轮未复跑）：

- `node test/topic-warmup-test.mjs`：通过 10，失败 0。
- `node test/test-prompt.mjs`：全部通过。
- `node test/render-test.mjs`：通过 85。
- `node test/coverage-http.mjs`：旧记录引用子代理报告，通过 126、失败 1；失败项为 `POST /api/qq-portable/launch` 期望 400、实际 200，旧记录归因为本机已有便携 QQ。未独立复核该归因。
- 改动文件 `node --check`：旧记录引用子代理报告，全部通过；未保留逐文件清单。
- 旧记录称真实模型探针已确认扁平返回结构，并在当时样本下获得可解析正文；后续活跃大群仍出现 8000 预算不足，因此不能将该探针视为最终预算的完整验收。

本轮核对（2026-10-18）：

- 已读取 isle 规范、完整任务文件、相关源码与测试代码；核对 Git 分支、近期提交及两条最新提交的改动范围。
- 已确认当前两路输出预算为 12000，回归测试含两路预算下限守卫；这是源码核对结果，未执行测试。
- 本轮仅整理 `TASKS.md`；未启动或重启机器人，未调用模型、修改运行配置、运行测试、提交或推送。
- 保存后核对任务分节、交接摘要、工作留痕、next 与日期的一致性。

### 未完成、已知问题与边界

- 未验证：最新代码是否已在运行实例生效、「立即跑一次」的当前效果、自动复盘整晚结果、群梗真实产出、群梗编辑真实交互、热身卡命中效果及反例晋升后的风格改善。
- 旧记录存在 `topic-warmup` 未注册工具的 loader 告警：该技能是纯提示词注入型，是否需要调整告警规则尚未决定，未修复。
- 旧记录存在 `coverage-http` 汇总后不退出的现象，曾怀疑 teardown 或技能定时器未释放；本轮未复现或确认根因。
- `data/config.json` 是运行实例的活配置，含敏感信息，不要整份覆盖或写死。
- `plugins/` 与 `skills/` 不入主仓库：本地插件另由 `E:\QQRobot\qq-agent-plugins.git` 管理；市场技能不因此获得提交授权。
- 本轮读取时 `TASKS.md` 为未跟踪文件；本次整理不包含 Git 提交或推送。

### 接手的第一个动作

单仓（`main`）推进「自主摸鱼」方案 A：改 `src/orchestrator.js:954` 主动机会提示词，把“摸鱼”作为模型可选项，先用小群/私聊低频试，观察成本与发言质量。人设示例库/群梗的实战验收仍未闭环，见待办。并行 worktree 方案已撤回，不要再新建。

## 工作留痕

- 2026-10-19 · lead：模型视角（全过程日记+页签详情面板）；修复三个真 bug：① 日记 t 用 ISO 字符串导致用量游标 NaN（生产环境用量一直没入账）；② 思考模型 reasoning 吃光预算把正文截空——加“空正文自动三倍预算重试”；③ place 动作不认绝对坐标/不放 item——已支持坐标+自动选方块+占位预检。实测：bot 夜战僵尸自主垫泥墙（“石头地上放不了，往旁边堆泥墙”）。
- 2026-10-19 · lead：【游戏】页签完成（页面游戏无关设计，快照/控制全走能力）；修复两处 CRLF 静默替换失败；确认 selftest「未读信息」失败为存量问题（stash 干净基线同样挂，疑运行中真应用干扰）；清理 %SystemDrive% 垃圾目录。
- 2026-10-19 · lead：开工【游戏】页签（需求：只显示当前实况、不要第一人称画面、页签名【游戏】且为多游戏预留）。
- 2026-10-19 · lead：MC 控制台可见性（mc.session 能力 + 存档/用量接入 + 掉线收档）；修复 rt 作用域 bug（同步代码被自己 try/catch 吞掉）。
- 2026-10-19 · lead：MC OP 自动化（ops 设置 + ensureOps + 离线 UUID 算法验证）；处理了测试遗留的孤儿 java 占用端口问题，重启干净服务端。
- 2026-10-19 · lead：MC 事件驱动分享（share 决策/出站箱/轮询投递/转写二审/频率闸）；修复转写调用被思考模型截空（300→1500）和 0 值被 || 吞掉的 bug；端到端实测消息抵达主人私聊并入库。
- 2026-10-19 · lead：MC 游戏循环——loop.mjs + runner 接线 + 动作容错（扁平坐标/绝对坐标/goals 导入/思考模型预算）；游戏内聊天驱动实测通过（Watcher 说话→小鲸鱼游戏内回复）；修复 goto 不动的两个 bug。
- 2026-10-19 · lead：MC 皮肤与围观闭环——SkinsRestorer 集成、URL 本地方案、servers.dat 自动写入（4 处+备份+幂等实测）；冒烟回归通过；未在真实客户端里目验皮肤效果（服务端侧证据齐全）。
- 2026-10-19 · lead：MC 任意版本化——javaPath 自动选择（按 MC 版本选最低满足 Java）+ 服务端/版本/Java 对照文档；冒烟回归通过，世界跨会话持久化确认（背包物品延续）。
- 2026-10-18 · lead：实现 skills/minecraft P0（Paper 1.20.1 服 + mineflayer bot + 5 个工具 + 冒烟测试全过、世界落盘）；修掉用户名/双 spawn/关机落盘/端口占用四类问题；P1 循环与群聊闭环未开始；未在运行实例内验证。
- 2026-10-18 · Codex：规范整理 TASKS.md，补齐任务清单并合并历史交接，核对近期提交及两路 12000 输出预算；文档整理完成，功能实战验收仍进行中；已回读核对文档结构与内容一致性，未运行测试，运行状态与历史验证未复核。
- 2026-10-20 · lead：MC 手感修复（用户反馈“动作一顿一顿、砍掉一个方块就说一句话”）：collect 改为批量采集（默认 8 个/上限 24，单次 15s 预算，第一个目标 32 格内、之后只收 16 格内，采不动/血少/到点自动收工）；attack 改为连续打（自动兑剑、追不上/血少≤8/打死即停，攻击冷却 350ms）；动作超时护罩 20s→30s。话闸：say 从“每轮直发”改为——玩家在说话随时可回、没人说至少慌 45s、与最近 6 句相似度≥0.33 直接吐掉（bigram Dice）；提示词同步改口（闹头采集/赶路/打怪时 say 必须留空）。similarText 单测 9/10；真实对局未目验，需下线→上线生效。
- 2026-10-20 · lead：MC 手感修复第二轮（用户反馋“动作一顿一顿、砍一个方块说一句话”）：① collect 批量采集（默认 8 个，15s 预算，分清“走不过去/挖不动”）、attack 连续打（自动兒剑、追不上/血少≤8 收手）、动作超时 20s→30s、bot.dig 与寻路内部 race。② 话闸：say 从每轮直发改为——玩家在说话随时可回、没人说至少慌 45s、与最近 6 句相似度≥0.33 吓掉（bigram Dice）。③ 修三个真 bug：`{"type":"goto"}` 不被识别（整步动作静默失败，一顿一顿的隐形主因）、place 因 findBlocks 调色板预检喂空 position 块崩 null distanceTo、searchFor 寻路无护罩。④ 提示词补合成账（oak_planks→crafting_table→stick，1 原木就够做工作台）+ dig {dx,dy,dz} 任意方向 + 被围住别死磕 digDown。⑤ data/config.json 的 sessionTokenCap 被设置库存成 0（无限），按设计意图恢复 100 万。验证：话闸单测 6/6；四轮端到端（真实 node 启动，沙箱里 process.execPath 是 Electron 启不动 runner）——6 轮里只发 2 句话（隔 68s，均为情境句）、2 句复读被吞；横向挖挖出石头/煤矿、place 不再崩、无循环出错。未规划：被怪围住时自动兒剑（反射层）未做；模型依然会因“不安全”拒绝合成。
- 2026-10-21 · lead：并行开发环境搭建（工程侧）：fetch --all --prune 后确认 main=671ec01 与 origin/main 同步，创建 worktree `E:\\QQRobot\\QQ-agent-memes`（分支 feat/memes；分支与目录原先均不存在，未覆盖/未强推/未提交/未推送），主工作区保持 main 不动；worktree 的 skills/、plugins/ 以目录 junction 软链接到主工作区（14 skills + 21 plugins 可见、readdir 透传、git status 干净），data/、runtime/ 刻意不链接（实例隔离/体积与进程冲突）。另按案屿 isle 规范回写本文件。未验证：两 worktree 同跑时的热重载双触发、软链接在真实启动实例中的加载效果。同日续（minecraft 方向）：同法创建 worktree `feat/minecraft` → `E:\\QQRobot\\QQ-agent-minecraft`（分支与目录原先均不存在，主工作区保持 main）；延用约定链 skills/+plugins/（junction）、不链 data/+runtime/，但先多建了 data/runtime 两个连接，查到早班会留痕里写明“刻意不链”及理由后按约定回退（rmdir 只删重解析点，主工作区 data 43 条目/runtime/minecraft-server 完好已复核），改为复制 data/config.json 当种子。探针实测：ESM 会把 junction 规范化成主工作区真身（import.meta.url），即技能+runner 默认走主工作区的 src/*、data/*、runtime/*；`--preserve-symlinks` 可翻转。另核对掉 TASKS.md 挂着的一事：MC 事件驱动分享代码确实在当前树（share/outbox/轮询/test-send 四处依次核出），此前“不符”是核对上下文有误。未验证：worktree 真实启动（node_modules 未装）、--preserve-symlinks 模式下的实际效果。
- 2026-10-21 · Codex：修复两个方向 skills/plugins 共享耦合，创建独立技能副本及插件分支、安装依赖，并分流方向任务与 WORKSPACE.md、登记案屿和补齐 isle Skill；环境与记录准备完成；哈希／realpath／Git 顶层检查和两次 npm ci 成功，独立机器人运行未验证，未提交／推送。
- 2026-10-25 · DeepSeek Harness：「莫名插话」整改（用户截图反馈话题没指向它却突然接话）。取证：那次发言的会话记录 `contextReason="随机命中(67%)"`、触发消息 `atMe=false`——唤醒它的是 75% 抽签不是任何人；回测该群近 36h 39 次随机命中发言，约 13% 属插入别人的局，51% 的会话醒来后 noreply（白烧调用）。修法：`src/prompt.js` 的 `speakOrNot()`/`notAQueue()`/`participationText('medium')` 把默认值从「接话」翻成「沉默」（默认不开口 + 白名单例外 + 别人的局不插话），`src/personas.js:28` 同步去矛盾；配置滑条 72.51→30（14.3% 随机）、participation medium→low。**没做本地「别人的局」闸门**：三个候选规则（@别人/引用别人/窗口≤2 人且自己最近没说话）回测精度都不够，拦 8 条只抓住 2 条目标、误伤 6 条合理回复，留在案上等更强信号。验证 test-prompt 全过（新增第 13 节锁新默认值 + 断言旧反向措辞消失）、npm test 55/64（9 项失败经 stash 对照确认为技能清单存量问题）。重启排障：实例 00:49 静默退出（日志无错误、实例锁已释放，原因未能确定）；新实例 OneBot 连不上，`POST /api/qq-portable/launch` 拉起便携 QQ 后约 5 分钟自动登录恢复，未要求扫码。未验证真实群聊效果。同日续：把闲置的「上下文插话判定」（`plugins/context-chime` 的 `reply.interest-judge`）接线进 `src/orchestrator.js`（原生触发全没命中时问一次小模型，要接才排唤醒；1 档/私聊不调、异常 fail-closed），新增 `test/context-chime-wiring-test.mjs` 7/7 并挂进 `npm test`；探针实测两个坑并修掉——`cfg.api.apiKey` 直传会 401（改用 `resolveApiKey`）、本机主模型关不掉思考导致 64 token 被 reasoning 吃光（插件参数改为 maxTokens 768 / timeout 22s，实测 2.2~6.8s 且判定质量正确）；17:24 重启实例（PID 49788）并已走通真实链路。同时按用户要求重写本文件：待办从 17 条压到 5 条（人话版，标明谁做/多久），结清 5 条过期或重复的旧账（已并入交接摘要），更正复盘时间 04:00→20:00。未验证：判定在真实群聊的长期质量。
- 2026-10-23 · DeepSeek Harness：收梗质量闸——针对真实复盘「6 示例 + 13 群梗大多算不上梗」：提示词收紧（定义/正反例/confidence/evidence/why），落盘加闸（可信度 0.72 默认、占位与纯数字、水回复、复读触发句、无 evidence、每群上限 2），示例去重纳入 rejected；设置页加「可信度门槛/每群梗上限」，待审行显示依据与可信度并加「驳回」按钮。验证 persona-review-test 6/6、test-prompt、prompt-anchor、render-test 85、coverage-wiring 5/5；同日 21:33 重启 Electron 实例（PID 57488）加载新代码，控制台 3210 与 OneBot 正常，`/api/config` 已带新阈值；21:40 又用新增的 `scripts/restart-app.mjs` + 项目 skill `qq-agent-restart` 完成一次重启（57488→59712）验证工具可用；未真实跑复盘。已提交 `719bb30` / `c4e72ee`（未推送）。
- 2026-10-23 · DeepSeek Harness：优先级评估 + 示例库「梗解释」——按用户决定把 MC 降级暂缓、meme 先行；给 `config.persona.examples` 加可选 `note`：复盘起草生成并单行化落盘（缺省空串）、提示词渲染「梗解释：」行、capture/POST/PUT 读写、面板折行展示与添加/编辑入口（顺修编辑弹窗未回填 bad 的存量 bug）。验证 persona-review-test 4/4、test-prompt、prompt-anchor、render-test 85、coverage-wiring 5/5、coverage-http 127 过 1 失败（既有 qq-portable 环境项）；未在真实实例跑复盘、未重启、未调用模型。已提交 `719bb30`（未推送）。
- 2026-10-22 · DeepSeek Harness：撤回并行 worktree，并同步回写本文件。核对两处 worktree 与 3 条方向分支均 0 独有提交、skills 与主仓逐文件一致、plugins 工作树无独有提交后：① 归档方向 TASKS/WORKSPACE/baseline 到 `.goal-baseline/isolation-20261021/worktrees/`；② 删除两个 worktree（约 1.2GB）及插件仓库对应工作树、5 条空分支（feat/memes、feat/minecraft、feature/voice-bridge、codex/*-plugins）；③ 本文件更新——七项梗收集待办与 MC 收尾/人设验收收回主线，next 改为单仓推进自主摸鱼 A，交接摘要新增「2026-10-22 撤回并行 worktree（当前有效）」并标注旧隔离段已撤回。环境整理完成，回到单仓 main 开发；未启动实例、未跑测试、未提交／推送。
