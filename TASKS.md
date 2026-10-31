# QQ-agent

status: 进行中
next: 梗候选蒸馏管线 P0 已落地（2026-10-31：插件 `plugins/meme-distiller` + 主仓审查面板/晋升写 user-added.json，见已完成首条），待你验收两件事：① 启动应用后点设置页「立即蒸馏一次」或等 7 点自动跑，审掉候选——把真梗「晋升」、不是梗的「驳回」，这一步是整条管线唯一的质检口；② 晋升 1~2 条后，去群里问「XX 是什么梗」，确认 trendy-memes 能查到（消费端零改动，理论上升级即命中）。之前的观察项继续有效：冷场素材会不会变成资讯播报机、混合搜索兜底命中率、贴吧来源何时恢复（`sourceTieba: true` 一条配置）。P1（nbnhhsh 缩写辅助）/ P2（B站评论区挖掘）按方案暂缓，等一周蒸馏质量数据再定。
updated: 2026-10-31

## 待办

> 怎么读：一条一句话，标了「谁做 / 多久」。历史过程与已结清的账在下面的交接摘要、工作留痕里，不在这一节。

- [ ] 【可代做】盯「工具调用泄漏」是否绝迹：翻 `data/logs` 的 `[发送 -> …] finish` 行；再出现就看漏了哪种形态（裸调用 `name{json}` / 冒号 `finish: …` / 其它包裹），规则在 `src/util.js:looksLikeToolCallText`、`src/orchestrator.js:parseInlineToolCalls` 与 `plugins/reply-guard/`。触发源是备用模型 `step-5-preview`（不返回原生 tool_calls、把调用写进正文），要不要把它从 `api.fallbackModels` 移除由你定（本次没动，只做兜底）。
- [ ] 【你 · 10 分钟】审掉复盘待审：设置页现有 5 条（2 条回复示例 + 3 条群梗），逐条点「晋升」或「驳回」。驳回后同名不会再收，不用删。
- [ ] 【你 · 1 分钟】定插话频率：判定已接线，先按现在的 3 档 14.3% 观察一两天。太闷 → 滑条抬到 45 左右或参与度调回「普通群友」；还吵 → 压到 2 档（只认关键词）。
- [ ] 【可代做】继续盯插话判定（质量 + 失败根因）：翻 `data/logs` 的 `[chime]` 行，确认「该接的接了、别人的局没插」；偏吵调 `confidenceThreshold`，偏静调 `cooldownSec`/`judgeProbability`。**「判定失败」根因仍未坐实**：7 次全挤在 17:29–19:25（正是我反复改插件目录、不停触发热重载的时段），21:06 修完日志重启后 4 次判定 0 失败、21:11 成功判了一次（「他们互相@调侃，没在问机器人」→不接，理由正确）；最像的解释是热重载瞬间插件设置读不到→回落默认 64 token/6 秒超时。日志现已会写明原因，再出现直接看冒号后面。
- [ ] 【可代做】继续盯「回复安全网」的救援质量：已实战 1 次（21:13 群 1103398129，正文「明早没课 那还熬着」→ 救回并发出，会话 `mvnumpvi-4d482baa` 带 `rescued` 标记）。往后翻 `[reply-rescue]` 行，核对救回来的是正经话而不是内心戏（错救=内心戏发群，比漏救严重）。规则在 `plugins/reply-guard/`，设置页可调「最多抢救几条」「单条最长字符」，关掉即恢复原行为。
- [ ] 【可代做】看新表情包是否真的会发：翻日志里 `nekowhale-stickers` 的工具调用。旧技能 whale-memes 在 2591 个会话里只被调用 4 次（10-08 / 10-10），另一个同源的 reply-meme 一次都没有；新技能若也几乎不触达，就调提示词片段权重（`priority 45`）或把 `proactive` 开关策略换个说法。
- [ ] 【你 · 1 分钟】把贴吧来源恢复回来：你说"晚点再把贴吧弄回来"，我这边先关着（`skills['hot-trend-tracker'].sourceTieba=false`，存储只剩 B 站两路 31 条）。恢复只需一条配置 `sourceTieba: true` + 一次抓取；恢复前确认一个已知代价可接受——贴吧热议没有发布时间，所以素材里它不带（今天/昨天）标签，旧帖被顶上来看不出新旧。
- [ ] 【可代做】盯冷场素材的实际观感：会不会从"报时"变成"资讯播报机"、一天几次冷场是否复读同一条（已加 12 条窗口轮换兜着）。翻 `[冷场递素材]` 日志 + 对应会话的正文。
- [ ] 【可代做】盯混合搜索的兜底比例：`provider=hybrid` 下结果会带 `fellBack`/`degraded` 标记；DeepSeek 那端仍无链接、时间锚停在 2026-05（问"今天刚发生"可能答查不到，这类现由 Bing 快路覆盖）。
- [ ] 【你定 · 大】「自主摸鱼」要不要做：让它自己刷视频/看帖、主动开话题。含 4 个子项：① proactive 加"摸鱼"选项；② 事件驱动插件（轮询 UP 主/RSS，有更新才唤醒）；③ 私聊也放开摸鱼；④ 安全分层（自己看=safe，分享才走发送闸）。一行没动，是新一轮开发。
- [ ] 【暂缓】MC 方向收尾：你说过先不玩 MC，代码与既有验证都留着，恢复时再验运行实例（见「进行中」）。

## 进行中

- [ ] 「自主摸鱼」方向：方案 A（proactive 语义扩展）与 B（事件驱动插件）已与用户确认方向，实现未开始（明细见待办最后一条）。
- [ ] 【暂缓·MC 方向】MC 玩家技能收尾核对：P0/P1/皮肤/版本化/事件驱动分享均已完成且已核对确实在当前树；任意版本/Java 选择与自主循环未在运行实例复验。2026-10-23 起降级暂缓（近期不安排 AI 进游戏，优先 meme）；恢复时再验运行实例。

## 已完成

- [x] 【Meme】【工程】梗候选蒸馏管线 P0 落地（2026-10-31）：方案见 `doc/plans/meme-distiller-plan.md`。**生产端** `plugins/meme-distiller/`（插件仓）：每天 7 点经能力 `knowledge.hot-trends` 软依赖读 hot-trend-tracker 的本地热榜（零新增网络请求），一次 LLM 调用蒸馏成新梗候选——闸门四条：`evidence` 必填（无证据=硬编，直接丢）、`confidence` ≥ 门槛（默认 0.7，落盘再夹一次）、标题噪声（纯数字/URL/占位）丢弃、查重（底稿 kb + user-added + 候选库三者，含已驳回）；产物只写 `data/meme-distiller/candidates.json`（status=pending），绝不动梗库本身。**审查端**（主仓）：`src/meme-candidates.js`（原子写、损坏容错、晋升时按归一化标题/别名查重后追加进 `data/trendy-memes/user-added.json`——trendy-memes 的 `loadAll()` 本就合并它，晋升即生效、消费端零改动）、4 个接口（`GET` 列表 / `POST distill` / `PUT` 晋升或驳回 / `DELETE`）、设置页「梗候选库（蒸馏）」面板（待审/已晋升分组、晋升/驳回/删除、立即蒸馏一次）。**验证**：`test/meme-candidates-test.mjs` 47/47（解析闸/查重/晋升写入形状/驳回留痕/清理/待审上限）；`test/coverage-http.mjs` 新增 3D 段 4 项（列表、晋升写盘、409/400/404、驳回+删除）；`test/tools-skill-audit` 报「Skill meme-distiller 清单完整 ✓」（其余 9 项失败是 qukan/qqzone 等存量问题，与本次无关）；`render-test` 85/85。**真实跑了一次**（用真实热榜 + 真实模型）：20 条热点 → 蒸馏出 1 条候选「义父」（别名 义父义母/愿拜为义父，evidence 引的是热榜简介里"感谢所有义父们的支持"，confidence 0.72），已停在 `candidates.json` 待审。**实例部署**：22:22 用 `scripts/restart-app.mjs` 重启（PID 41796，控制台 200、OneBot 已连接），日志确认「✅ 加载成功：梗候选蒸馏」+「梗候选蒸馏已就绪｜每天 7:00」；随后从控制台接口实跑一次 `POST /api/meme-candidates/distill` → 25 条热点产出 2 条新候选（丢弃 1 条）：「丧病」(0.8)、「传统艺能」(0.85)，加之前「义父」(0.72)，待审共 3 条，质量抽样都合理（依据均引热榜原文）。**未验证**：① 每天 7 点的定时器自动触发（明天看 `[skill:meme-distiller]` 日志那一轮）；② 晋升后群里 `查网络梗` 的真实命中（需人工点晋升；消费端逻辑零改动）。P1（nbnhhsh 缩写辅助）与 P2（B站评论区挖掘）按方案未开工。
- [x] 【工程·视觉】图片被误当"在调侃自己"的一组修法（2026-10-31 提交，改动成于 10-30）：**现象**——群友随手发的图/表情，机器人容易当成"在说我"，回怼或脑补画面（10-30 那条"图片回怼"问题）。**修三层**：① `src/llm.js:specializedModelFor` 原来只要配了 `api.visionModel` 就把带图轮次整份切给专用模型（通常是 flash 档），语气和推理明显跑偏——现在主模型自己被探测为 `vision` 时不再切，专用模型只当"主模型明确不支持图片"的兜底；② `src/image-compress.js` 最长边上限 1568→2048，先保住细节再谈降本；③ 提示词两处收紧：`src/prompt.js` 新增"群友发的图大多只是随手分享，只有图上明确出现你/配文调侃你/发图人同时 @ 你才按被调侃回应"，`src/orchestrator.js` 的看图工具回传改成"先看清再自行判断要不要回应，不要脑补画面里没有的东西"。**验证**：语法全过；`test/selftest.mjs` 41/41（本次顺带把 selftest 里会破坏"零历史"前提的 qzone-diary/context-reuse 关掉、并清空启动期请求，否则启动期后台技能会顶掉"群消息触发的第一次运行"）；**新分支`specializedModelFor` 无单测覆盖**（靠 selftest 的 vision 开关与图片输入用例兜）。**未验证**：真实群里图片回怼频率是否下降（需观察）。已提交主仓 `817ee5b` + 插件仓 `460a95b`（detailed-thinking 给注入推理打 `thinkingInjected`，配套心事本过滤），均已推送。
- [x] 【工程·心事本】跨轮携带「没说出口的念头」（2026-10-30，接管上一个会话的 WIP 并把写入端做扎实）：**动机**——无状态架构每轮归零，存档只记得"谁说了什么"，而立场、悬念、想问没问的话会随会话销毁；心事本只补这一层，不复用对话历史，成本恒定（字数上限 + TTL）。**结构**（上半场已完成）：`src/mind.js`（per-chat 文件、路径穿越防护、tmp+rename 原子写、TTL、开关、`formatMind` 渲染）、`config.mind` 默认值、设置页「心事本」卡片、`finish.mind` 参数、orchestrator 收尾落盘、`buildUserPrompt` 注入（放在未读信息之后、【当前时间】之前，不打断缓存前缀）。**接手时的实测问题**：`data/mind` 6 个会话文件 **100% 是兜底产物**（`source=thinking`，主路径「模型主动写 mind」一次都没触发），内容全是垃圾——`finish`、`finish: 已回应阿狗的「？」…`、`finish maybe.</think>`、`【深度思考】他说"好吧"…`，甚至 `…主人身份：3248569738 是主人`（系统提示回声）。根因三条：① 兜底取「本轮最后一段没发出去的 assistant 正文」，恰好是工具调用泄漏残留和 detailed-thinking 注入的原始推理；② `MIN_MEANINGFUL_CHARS=6` 让 `"finish"` 正好过闸；③ 系统提示没有一句教学，模型不知道要写 mind。更糟的是兜底每轮覆盖——用一句 `finish` 冲掉上一轮真实念头。**修法**：新增纯函数 `isMeaningfulMind` / `resolveMind`（拒工具调用语法、原始推理与半截 `</think>`、`【…` 段落头、系统提示回声、纯 ASCII/无汉字、<8 字；主路径优先、兜底次之）；**两路都不合格就不写**，宁可保留旧念头等 TTL 自然过期；`saveMind` 自身也过同一道闸（防止别的调用方绕过）；`loadMind` 读到过期文件顺手删除（此前每会话一个文件永不清理，只增不减）；系统提示 `toolProtocol` 增加第 9 条教学（什么时候用 `finish.mind`、已发到群里的不用写、长期印象走记忆工具）；TTL 代码默认 30 分钟，线上配置 60 → 30（用户拍板）。**验证**：`test/mind-test.mjs` 扩充后全过（9 条真实脏样本全拒、3 组候选决议、过期清理、路径穿越/开关/截断/覆盖写）；清理 6 个脏文件（备份 `data/mind.bak-20261030/`）；`data/config.json` 已改为 30 分钟并经 `POST /api/config` 生效；实例重启（PID 24728）后 mind-test 与 `test:leak` 全过。**selftest 本次未通过**（卡在「等待第一次 LLM 调用」5 秒超时）：加临时计时诊断查明，阻塞发生在 `#runAgent` 组装提示词**之前**的 `runHook('before-context')` 段（`cross-chat-people-group` 的钩子计时落在阻塞窗口内，但其函数体是纯内存逻辑，没有 IO）——实为启动期事件循环被插件/技能后台任务占住约 5~8 秒，与心事本改动无关；诊断代码已全部还原。**未验证**：真实群里是否开始出现 `source=finish`（需观察几天）；心事注入对发言质量的长期影响。
- [x] 【工程·工具调用泄漏】群里刷屏 finish{"summary":…} / finish: …（2026-10-30 事故，用户两次报障）：**现象**——提瓦特群（group:592931715）连续发 `finish{"summary":"接话完成"}`，一度 10+ 条连发；19:38 又在 van♂游群出现 `finish: 回应阿狗关于兑换码的疑问…`。**取证**：会话 JSON（`data/sessions/mvug0wht-9278719f.json`）显示模型 `step-5-preview`（api.stepfun.com，`api.fallbackModels` 第三顺位）把工具调用写成正文 content（finish_reason=stop、无原生 tool_calls）；核心内联解析只认 `<tool_call>` 包裹，这段正文于是落进回复安全网 `reply-rescue`，被 `reply.loose-send` 当"成稿"抽出来合成 send_message 发进群；更糟的是它随后作为 self 发言进【已读信息】，教模型模仿自己 → 连发循环。日志口径：10-30 `finish{` 52 次（11:09–12:12 全在提瓦特群）+ `finish:` 2 次（19:38），10-23~10-29 为 0——今天新出现。**修三层**：① 核心 `parseInlineToolCalls` 增加裸调用形态解析（`name{json}` / `name({json})` / `finish: 理由`，只认已知工具名），把泄漏文本还原成真实调用（finish 正常收尾、send_message 正常发送，而不是当正文）；② `src/util.js:looksLikeToolCallText` 扩到冒号形态（含全角），`src/sender.js` 发前拦截、`src/reply-rescue.js` 整段否决 + 逐条过滤、`plugins/reply-guard` 的 `isPlanningText`/`isSendableLine` 同步否决；③ 历史卫生：`buildPastState` 与 `get_recent_messages` 过滤"自己 + 工具调用语法"的脏历史（上午前一段工作已落地花括号形态，本次补齐冒号形态）。**验证**：新增 `test/inline-tool-call-test.mjs` 27 项（裸调用 8、误判反例 8、兜底口径 11）、`test/reply-rescue-test.mjs` 9/9（补 finish 三形态 + 多行混合只丢调用行）、`test/sender-send-path-test.mjs` 冒号/全角/反例全过；selftest 41/41、preload check 全过。`npm run test:audit` 报 9 项失败，逐条核对为其它技能/插件清单存量问题（qukan 能力未实现、qqzone category 非法、nekowhale-stickers required 空数组等），与本次改动无关。**部署**：13:19–13:47 的改动一直没重启（实例 07:39 起、跑旧代码，这也是用户"还在发"的直接原因），19:47:33 用 `scripts/restart-app.mjs --electron` 拉起新实例（PID 38960，控制台 3210 返回 200、OneBot 已连接），重启后日志 0 次 finish 泄漏。**未验证**：真实群再遇 step-5-preview 时的实际表现（需等自然流量/降级发生）；`step-5-preview` 是否该从 fallback 链移除（它不支持原生 tool_calls，是本次触发源，留给用户定）。
- [x] 【Meme】【方案】梗库"蒸馏管线"评审件定稿（2026-10-29）：用户反馈"识别梗的能力不够强"，调研后拍板自建。**生态结论**：小鸡词典已停服，无活跃维护、可直接接入的中文热梗词典服务（Jikipedia 存档 / astrbot-rag-kb 语料库 / nbnhhsh 免费缩写 API / dsh-bili-see「云端模型刷B站看评论」先例，全部只当数据源或思路参考，见方案 §二）。**方案**：`plugins/meme-distiller`（插件仓）每天 7 点读 `data/hot-trends.json`（软依赖 hot-trend-tracker），一次 LLM 蒸馏产出新梗候选（evidence/confidence 必填、不许无证据硬编）→ `data/meme-distiller/candidates.json` pending → 设置页待审面板人工晋升/驳回 → 晋升条目追加写 `data/trendy-memes/user-added.json`——**消费端 trendy-memes 零改动**（其 `loadAll()` 本就合并自学习文件）。关键决策：闸门照抄群梗库 pending/active/rejected；LLM 未核实的解释不进任何提示词注入。文档：新建 `doc/plans/` 分类与 `doc/README.md` 索引（分类约定：plans/ 放方案评审件、features/ 启用、extend_development/ 已明细；存量三篇因代码注释硬编码路径原地保留）。Git：主仓此前不干净——「心事本(mind)」WIP（另一会话，未触碰）+ untracked `.dsh-ops/`（已收录 .gitignore）；插件仓 clean。全部提交用明确 pathspec，避开 mind WIP。
- [x] 【工程·冷场素材】让它冷场时有话可说（2026-10-26）：用户反馈 AI-Hub 群里"大肥鱼只会报时"。**先取证再动手**：该群近 14 次主动发言 13 次在说"两点半了/快八点了/周一下午两点最难熬/三点多了"；176 次主动唤醒里只有 13 次（7%）调用过任何联网工具。根因不是懒也不是没权限——主动机会只在群里安静时触发，那一刻提示词里**唯一会变的信息就是【当前时间】**（未读空、已读空、无任何材料），它手上没有可说的东西。修法：`plugins/hot-trend-tracker` 的 `before-llm-messages` 钩子在 `ctx.proactive` 为真时，把知识库 4 条热点塞到提示词末尾（本地读、不联网、游戏优先、可关 `injectOnProactive`），措辞里明确"别再用几点了开场"；同时补上**压根不存在的 `hot-trends` 技能**（提示词一直写着"先用 hot_brief 查"，实测 98 个工具里没有任何 `hot_*`，知识库只有触发词一条窄门能进）——新增 `skills/hot-trends/`，`hot_brief`/`hot_query`/`hot_status` 三个只读工具，走能力 `knowledge.hot-trends` 软依赖插件。验证：`test/hot-trends-test.mjs` 17/17（后扩到 26/26）；生产实测 4 次冷场——GAMEEE「绝区零那个星徽骑士EP出了 有人听了吗」、AI-Hub「刷到星铁新出了个动画短片 叫那安息的长夜」并在发前自己调 `web_search`+梗库查证、查不到就明说"不确定别编"、van游「今天世界赛IG打HLE啊，有人蹲吗」、GAMEEE「影之刃零游民打9.8 这分数给得有点狠啊」。全部不再是报时。验证方法说明：为把冷场逼出来，两次把 `proactive.probability` 临时调到 1（15 秒必触发），验完已还原 0.325。
- [x] 【工程·旧闻】B 站游戏接口是冻结快照，机器人把去年的 PV 当"新出的"发进群（2026-10-26，事故）：用户 16:50 指出"拿到的信息是老的，去年的信息在群里分享"。**根因不是我猜的那种**——`ranking/v2?rid=4`（游戏分区榜）返回的是**冻结在 2025-04-01 的快照**：96 条 pubdate 全是 1743xxx，即 572~577 天前；而我的代码根本没存发布时间，于是把去年的 PV 打上"今天网上的事"递给了模型。修法三层：① 换源：游戏这一路改用 `popular`（当前热门）按分区名（游戏/电子竞技/GMV）筛，翻 3 页，实测 0~2 天；② 发布时间入库 + **双闸**：抓取时丢超过 `maxAgeDays`（默认 3 天）的，查询时再按 `pubAt` 卡一次（老视频今天再被抓进来时 `lastSeenAt` 是新的，只看它必漏，事故正是这么漏的），来源回来全是旧内容则判失败、连续失败自动停用；③ 素材每条标（今天/昨天/N天前），提示词硬性写明"N 天前不许说成新出的、无日期更不许加新"。旧库清理 258→129 条（含所有无时间戳的老条目）；bili-only 重建后 31 条、0 条无日期、最老 2 天。验证：`test/hot-trends-test.mjs` 26/26（新增全旧判失败、无时间戳迁移清理、查询双闸、日期标签四类断言）。
- [x] 【工程·搜索】改成混合搜索（Bing 优先 + DeepSeek 兜底，2026-10-26）：用户先要"其他靠网络搜索"，实测出问题的不是模型而是 provider——Bing 网页解析对**多词中文**查询会静默降级（把查询拆成首字去搜），「绝区零 星徽骑士EP」连续三次返回「绝（汉语文字）_百度百科」，而单词「绝区零」正常；换成 DeepSeek 原生搜索后又暴露另一端：可核实范围停在 2026-05，问今天的赛果一律答"还没开赛"，但解释类问题答得不错。两者缺陷互补，于是新增 `provider=hybrid`：Bing 先上，用 token 命中数判"答非所问"（只判命中 0，阈值一抬高会把"半退化但相关"的也赶去 fallback），退化才 fallback DeepSeek（结果带 `fellBack`/`degraded`）。工具描述、系统提示词、verify-first 规则三处同步改口径：没链接就直接用总结，不许拿空 url 去 web_fetch、不许声称看过原文。控制台新增"混合"选项并复用 DeepSeek 字段（顺手修字段组切换互相覆盖）。验证：`test/web-search-hybrid-test.mjs` 8/8（退化判定用实测真样本 + 4 个不许误判的反例）；实跑「S16 瑞士轮 IG HLE 结果」Bing 334ms 带 6 条链接、「绝区零」457ms、「绝区零 星徽骑士EP」退化→DeepSeek 9.9s 答对；selftest 41/41、test-prompt 全过。已提交主仓 `c7e482b` + 插件仓 `29ff3d1`，均已推送。

- [x] 【工程·回复安全网】补上「正文成稿抢救」一直缺席的零件（2026-10-25）：用户问「这次会话为什么没发消息」，查到那次（`mvnrvtmh-94139ee6`，被 @ 问「这个图片是谁」）模型其实写了两句「这不是我吗／蓝毛鲸尾女仆 特征全对上了」，但写在**正文**里——正文按设计不发 QQ；同一轮它只调了 `sticker-memory__remember_image`，思考里还写着 "I already sent…"（误以为发出去了）。顺查发现不是个例：扫 2591 个会话，**904 个**出现过"正文有成稿但没走 send_message"，**581 个**整轮一条没发出去，其中 **57 次是被艾特却一声没吭**。根因：核心 `src/reply-rescue.js`（专门为这种情况写的安全网）依赖 5 个能力提供方，而运行时**一个都没有**——`cap()` 永远拿到 null，于是每次都返回"什么都不发"，等于从装上那天起就没工作过。修法两条：① 新增 `plugins/reply-guard/`（确定性插件）提供 `reply.is-planning-text`（否决计划腔/内心戏/收尾旁白）与 `reply.loose-send`（正则抽取成稿原句、支持 JSON 数组形态、去 Markdown 痕迹），刻意不实现需要模型裁判的三个能力（零成本可回放）；② `src/orchestrator.js` 把安全网从"只有完全没工具调用时才试"扩到"这一轮有工具调用但没调 send_message"（追加进 toolCalls 并回填 assistant 消息的 tool_calls，保证工具结果能对上 id），覆盖"正文+别的工具"那 44 个会话。三条规则是靠**历史回放**磨出来的：第一版会把「话发齐了，收工。」「这轮就先这样。」当成人话救出去（约一半误救），补了收尾旁白规则后，40 条抽样里没有一条内心戏。验证：`test/reply-rescue-test.mjs` 8/8（含用真核心函数+真插件导出跑的集成用例：能合成 send_message，内心戏不救），`node test/reply-rescue-test.mjs --replay` 回放 988 个历史会话 → 693 个可救回、842 条消息；20:35 重启（PID 24512）加载，`/api/skills/capabilities` 确认两个能力已有提供方。**实战已验证（当日 21:13）**：群 1103398129 触发消息「ZLOONG：明早没课」，模型把回话「明早没课 那还熬着」写在正文里没走工具，安全网合成 send_message 发出（`[reply-rescue]` 日志 + 会话 `mvnumpvi-4d482baa` 带 `rescued` 标记），救的是一句正经群聊话、没夹带内心戏 —— 这正是用户截图里那个 bug 的同一形态。
- [x] 【Meme·表情包】用「大肥鱼表情包」替代「梗鲸表情包」（2026-10-25）：用户刷到 [Loping151/dsh-nekowhale-stickers](https://github.com/Loping151/dsh-nekowhale-stickers)，问能不能接进来顶掉 whale-memes（"现有那个都没怎么主动触发过"）。**先验证了旧技能为什么不用**：2591 个会话里 `whale-memes` 只被真正调用 4 次（10-08 / 10-10）；同源的 `reply-meme`（回复配图·梗鲸，v1.0.1）**一次都没被调用过**；它的数据源 `aigengtu.com/gallery-index.json` 是 1.36 MB，本机三次探测两次 12 秒超时（只下到 90~118 KB），而每次调工具都得先拿这份索引 —— 不是模型不想用，是这条路走不通。**再验证新数据源可用**：kiriyuki.com 的索引仅 160 KB，322 张逐张标了情绪(25 类)/场景标签/用途/画面描述/梗出处/双人方向；单张 GIF 0.6~1.7 MB，只有 GIF（webp/png/jpg 变体都 404）。**没有移植那个 TS 插件**（它是 DSH/cordis 插件，需要 tsc 构建 + cordis 服务 + 字体/gif 编码器，与 QQ-Agent 的 skill API 不是一回事），而是把它最有价值的一半 —— 标注索引 + 检索 —— 做成原生技能 `skills/nekowhale-stickers`：索引随技能落盘（`catalog.json`，搜索零网络，72 小时可选联网刷新且"条目变少就不替换"）、按命中位置加权打分（情绪 120 / 图上文字 34 / 名字 30 / 标签 26 / 用途 16 / 梗出处 9 / 描述 6）、发过的图降权到 0.15（不硬排除，全库才 322 张硬排除会挑空）、3 个工具（`send_sticker`/`list_stickers`/`sticker_credit`）、下载后校验魔数防 HTML 错误页、每会话 4 张/小时 12 张/天。旧技能在配置里关掉（`skills['whale-memes'].enabled=false`），代码保留可回滚。**验证**：新增 `test/nekowhale-stickers-test.mjs` 12/12（索引解析/URL 拼接/词元展开/检索命中/打分层次/情绪限定/去重降权/魔数嗅探/额度换算/清单自洽）并挂进 `npm test`；全链路探针实测「委屈」→ 正确选中「委屈哭哭（哭，「受了委屈，想让对方哄哄自己时」）」并走完 下载→校验→落盘→sendImage，467ms / 996KB；热重载已加载（18:42，无需重启），`/api/tools/availability` 确认旧工具"Skill 未启用"、新工具 3 个全部 enabled。未移植上游的 `meme_render` 本地模板（想/举牌/葱卷/对联/抱），需要字体与 gif 编码器。
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

### 2026-10-26 冷场素材 / 旧闻事故 / 混合搜索（当前有效）

- **起点是用户的三个提问**：①「AI-hub 群的大肥鱼总是只会报时，能不能放开权限让它自己写技能、自己去看游戏资讯？」②「它拿到的信息是老的，去年的信息在群里分享」③「其他可以靠网络搜索吧？可以改为混合」。
- **报时的真因（有数据）**：AI-Hub 群近 14 次主动发言 13 次在报时间；全部 176 次主动唤醒里只有 13 次（7%）调用过联网工具。冷场主动唤醒那一刻，提示词里唯一会变的信息就是【当前时间】——未读空、已读空、没有任何材料，所以只能拿时钟当话题。**不是权限问题**：读网页/搜B站/RSS 这些工具一直都在（98 个工具），只是没有理由去用。
- **顺手挖出的两个真缺陷**：① 提示词写着"先用 hot_brief 查本地知识库"，而 `hot_brief` 这个工具**从来不存在**（98 个工具里没有任何 `hot_*`），插件天天抓 200+ 条热点却只有一个窄门（群里出现"什么梗"这类触发词）能进模型；② 游戏工具（明日方舟那 6 个）被 skill-guard 卡着，冷场（没被 @）时全部不可用——就算想聊游戏也没工具。
- **旧闻事故的机理（重要，别再犯）**：`ranking/v2?rid=4` 不是"游戏区最新"，是**冻结在 2025-04-01 的快照**（96 条 pubdate 全 1743xxx ≈ 573 天前）。我选了这个接口、又没存发布时间，于是机器人把去年的 PV 说成"新出了"。**教训两条已落进代码**：任何来源必须带发布时间并按新鲜度过滤；"抓成功但全是旧内容"要按失败处理，否则它会安静地永远喂垃圾。另一个更隐蔽的点：老视频今天再被抓进来时 `lastSeenAt` 是新的，**只看 lastSeenAt 必漏**，所以查询时也要按 `pubAt` 再卡一道。
- **现在的搜索口径**：`webSearch.provider = hybrid`。Bing 先上（快、带链接、实时），用查询 token 命中数判"答非所问"（只判命中 0），退化才 fallback DeepSeek（慢、无链接，但能解释）。两端的已知短板：Bing 多词中文会降级；DeepSeek 时间锚停在 2026-05、无链接、偶尔自相矛盾。
- **当前生效配置**：`proactive.probability=0.325`（验证时临时调到 1，已还原）、`store.contextSliderPos=55.07`、`webSearch.provider=hybrid`、`skills['hot-trend-tracker']={sourceTieba:false, sourceBaidu:false}`（贴吧按用户要求先关，待恢复）、`maxAgeDays=3`。知识库 31 条（B 站热门 20 + 游戏区 20，去重后 31），0 条无日期，最老 2 天。
- **实例状态**：PID 52448（`node scripts/restart-app.mjs` 重启两次：17:55 载入 deepseek 口径、18:29 载入 hybrid），控制台 200，OneBot 已连。便携 QQ 未重启、未要求扫码。
- **提交**：主仓 `c7e482b`（hybrid 搜索 + 三处口径 + 两个测试）、插件仓 `29ff3d1`（hot-trend-tracker v1.2.0）。都已推送。工作区仍留着他人的「心事本（mind）」WIP（`src/mind.js`、`src/config.js`、`src/tools.js`、`ui/app/06-settings-render.js`、`ui/app/08-modals.js`、`ui/index.html`、`package.json`、`test/selftest.mjs`、`test/mind-test.mjs`），本轮提交用 hunk 级暂存把它们排除在外，未触碰。
- **未验证**：连续几天的观感（会不会从"报时"变成"资讯播报机"、同一条会不会复读）；混合搜索的长期兜底比例；贴吧恢复后无日期条目会不会再引入"旧帖当新鲜"的风险。
- **接手的第一个动作**：用户要求"晚点把贴吧弄回来"——恢复时把 `sourceTieba` 打开（一条配置，无需重启，抓取时生效），并顺手确认无日期条目在素材里不带（今天/昨天）标签这件事可接受。


### 2026-10-25 回复安全网：补上一直缺席的零件（当前有效）

- **症状**：用户截图里那次会话（19:56，群 908707163，被 @ 问「这个图片是谁」）一个字都没发出去。
- **直接原因**：模型把要发的两句话「这不是我吗／蓝毛鲸尾女仆 特征全对上了」写在了**正文**里。正文按设计不发 QQ，只有 `send_message` 工具调用才会发。它的思考里甚至写着 "I already sent…" —— 它以为自己发出去了。
- **为什么没被兜住**：核心早有 `src/reply-rescue.js` 专治这个（注释写着"群友什么都收不到"），但它依赖 5 个能力提供方（`reply.is-planning-text` / `reply.loose-send` / `reply.salvage-lines` / `reply.salvage` / `reply.grounded-select`），**运行时一个提供方都没有** → `cap()` 恒为 null → 恒返回"不发"。等于这个网装好了、线没接。
- **规模**（扫 2591 个会话）：904 个出现过"正文有成稿但没走 send_message"；581 个整轮零发送；**57 次被艾特却一声没吭**。另外 44 个是"正文 + 调了别的工具"，安全网当时根本不覆盖这种形态。
- **修法**：① `plugins/reply-guard/` 提供前两个能力（纯正则、零 IO、可回放）；② 调用点多一个分支：本轮有工具调用但没有 `send_message` 时也抢救，抢救结果**追加**在原调用之后并回填 assistant 的 `tool_calls`（否则工具结果对不上 id，下一轮请求会被判非法）。
- **规则怎么定的**：不是拍脑袋 —— 拿 988 个真实会话回放，看它到底救出什么。第一版约一半误救（「话发齐了，收工。」「这轮就先这样。」「等他接招」这类自我旁白），补了三轮规则（收尾旁白 / 道具旁白 / 格式化聊天行）后 40 条抽样干净。**判错方向不对称：漏救只是少说一句，错救是把内心戏发进群**，所以规则一律从严。
- **可调 / 可关**：设置页「回复安全网」可改「最多抢救几条」（默认 2）、「单条最长字符」（默认 40）；关掉后行为与没装完全一致。
- **实战结果（21:13，上线 40 分钟后撞上同形态）**：群 1103398129 触发消息「ZLOONG：明早没课」，模型把「明早没课 那还熬着」写在正文、没走工具 → `[reply-rescue] … 已抢救成 1 条` → `[发送 -> group:1103398129] 明早没课 那还熬着`。救出来的是正经群聊话，没有内心戏。日志行加了 `[reply-rescue]` 前缀便于事后核对。
- **顺带修掉的观测黑洞（影响面比本 bug 更大）**：插件拿到的 `api.log/warn` 原走 `console.log/warn`，而应用是 detached + `stdio:'ignore'` 启动的 —— stdout 直接丢弃。**36 个技能的运行期日志（含故障原因）一进应用就人间蒸发**，所以插件明明 warn 了原因、日志文件里只剩核心那句笼统的「判定失败」。已改为走 `logger`（落盘 + 控制台），并让 context-chime 把失败原因随 `skipped` 返回给核心。这是本次能定位问题的关键前提。
- **仍未验证**：多轮会话里"先抢救再自己发"是否会造成重复（理论上有，末见实例）；插话判定那 7 次「判定失败」的根因（见待办）。

### 2026-10-25 表情包换血：梗鲸 → 大肥鱼（当前有效）

- **为什么换**：`whale-memes` 的数据源 `aigengtu.com/gallery-index.json` 是 1.36 MB 单文件，本机三次探测两次在 12 秒超时（只下到 90~118 KB）；每次调工具都要先拿它，所以 2591 个会话里 whale-memes 只被真正调用 4 次（10-08 / 10-10），同源的 reply-meme 一次都没有 —— 属于"看起来装着、实际走不通"。
- **换成什么**：`skills/nekowhale-stickers`，数据源自 [Loping151/dsh-nekowhale-stickers](https://github.com/Loping151/dsh-nekowhale-stickers)。索引 160 KB 随技能落盘（搜索零网络），322 张、25 类情绪、每张带场景标签/用途/画面描述/梗出处/双人方向。**没有移植那个 TS 插件本体**（DSH/cordis 插件，要 tsc + cordis 服务 + 字体/gif 编码器），只把它最有价值的"标注索引 + 检索"做成原生技能。
- **落点**：`skills/nekowhale-stickers/{index.js,skill.json,SKILL.md,catalog.json}`（`skills/` 被 .gitignore，属本地技能，不入库）+ `test/nekowhale-stickers-test.mjs`（入库，技能未安装时跳过）。运行时产物在 `data/nekowhale-stickers/`（刷新索引、额度与已发记录、`tmp/` 待发图）。
- **回滚方法**：`POST /api/skills/whale-memes {"enabled":true}` 即可把旧技能打开，两者互不冲突（只是别同时开，会各发各的）。
- **关键口径**：发图只能走 `ctx.sender.sendImage`（进发送队列）；下载后校验魔数（kiriyuki 对不存在的图返回 HTML 错误页）；同会话每小时 4 张 / 每天 12 张；发过的图降权 0.15 而非硬排除。
- **顺带发现（旧技能也中招）**：`manager.getPromptSections` 会**同时**收 `manifest.prompt.sections` 和导出的 `promptSections()`，只按 id 去重 —— 旧 `whale-memes` 两段 id 不同（`-playbook` / `-library`），所以它的提示词被塞了两份（约 1200 字冗余，实测 2322 个会话都带着）。新技能改成：行为指引只在 playbook（priority 45），动态片段只报"当前库大小 + 额度"（priority 40），不重复。
- **验证**：单测 12/12；全链路探针「委屈」→「委屈哭哭」467ms；热重载已加载（18:42，未重启）；`/api/tools/availability` 确认旧 2 个工具"Skill 未启用"、新 3 个工具 enabled。
- **未验证**：群里是否真的会发（这是换掉旧技能的初衷，得看真实聊天）；上游 `meme_render` 本地模板未移植。
- **授权**：元数据 Apache-2.0、表情 CC BY-NC 4.0（非商用）；被问来源必须转述作者（B 站 可以叫我云大人 / kiriyuki.com），技能里已带 `sticker_credit` 工具。
- **统计口径更正（重要）**：本文件早先写的"2588 个会话只用过 17 次"是**数错的** —— 那个脚本把 `inputMessages` 里嵌的**工具定义**当成了调用。按 `messages[].tool_calls[].function.name` 重算（2591 个会话）：`whale-memes__send_meme` **4 次**（2026-10-08 / 10-10）、`whale-memes__list_memes` **0 次**、`reply-meme__find_meme` **0 次**。结论比原来更硬：这三个表情包技能里真正跑通过一次的只有 whale-memes，一共 4 次。
- **2026-10-25 19:30 追加**：按用户确认，把同源的 `reply-meme`（回复配图·梗鲸表情包 v1.0.1，作者 nuoxi4n，用的还是同一个 `aigengtu.com/gallery-index.json`）也关掉了（`skills['reply-meme'].enabled=false`）。它从装上到现在一次都没被调用过，`data/` 下连缓存目录都没建出来过（说明那 1.36 MB 索引一次都没拉完）。现在三个表情包技能里只剩 `nekowhale-stickers` 是开的。

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
- 2026-10-25 · DeepSeek Harness：「莫名插话」整改（用户截图反馈话题没指向它却突然接话）。取证：那次发言的会话记录 `contextReason="随机命中(67%)"`、触发消息 `atMe=false`——唤醒它的是 75% 抽签不是任何人；回测该群近 36h 39 次随机命中发言，约 13% 属插入别人的局，51% 的会话醒来后 noreply（白烧调用）。修法：`src/prompt.js` 的 `speakOrNot()`/`notAQueue()`/`participationText('medium')` 把默认值从「接话」翻成「沉默」（默认不开口 + 白名单例外 + 别人的局不插话），`src/personas.js:28` 同步去矛盾；配置滑条 72.51→30（14.3% 随机）、participation medium→low。**没做本地「别人的局」闸门**：三个候选规则（@别人/引用别人/窗口≤2 人且自己最近没说话）回测精度都不够，拦 8 条只抓住 2 条目标、误伤 6 条合理回复，留在案上等更强信号。验证 test-prompt 全过（新增第 13 节锁新默认值 + 断言旧反向措辞消失）、npm test 55/64（9 项失败经 stash 对照确认为技能清单存量问题）。重启排障：实例 00:49 静默退出（日志无错误、实例锁已释放，原因未能确定）；新实例 OneBot 连不上，`POST /api/qq-portable/launch` 拉起便携 QQ 后约 5 分钟自动登录恢复，未要求扫码。未验证真实群聊效果。同日续：把闲置的「上下文插话判定」（`plugins/context-chime` 的 `reply.interest-judge`）接线进 `src/orchestrator.js`（原生触发全没命中时问一次小模型，要接才排唤醒；1 档/私聊不调、异常 fail-closed），新增 `test/context-chime-wiring-test.mjs` 7/7 并挂进 `npm test`；探针实测两个坑并修掉——`cfg.api.apiKey` 直传会 401（改用 `resolveApiKey`）、本机主模型关不掉思考导致 64 token 被 reasoning 吃光（插件参数改为 maxTokens 768 / timeout 22s，实测 2.2~6.8s 且判定质量正确）；17:24 重启实例（PID 49788）并已走通真实链路。同时按用户要求重写本文件：待办从 17 条压到 5 条（人话版，标明谁做/多久），结清 5 条过期或重复的旧账（已并入交接摘要），更正复盘时间 04:00→20:00。未验证：判定在真实群聊的长期质量。同日续（表情包换血）：查实 `whale-memes` 在 2591 个会话里只被真正调用 4 次（`reply-meme` 一次都没有）（数据源 1.36 MB 索引本机十秒下不完，工具走不通），按用户要求用 [dsh-nekowhale-stickers](https://github.com/Loping151/dsh-nekowhale-stickers) 的知识库重做一个原生技能 `skills/nekowhale-stickers`（322 张带情绪/标签/用途/梗出处，索引随包落盘、搜索零网络，3 个工具、下载校验魔数、按会话限额），配置里关掉旧 `whale-memes`（代码保留可回滚）；新增 `test/nekowhale-stickers-test.mjs` 12/12 并挂进 `npm test`，全链路探针「委屈」→「委屈哭哭」467ms 走通，热重载 18:42 生效未重启。未移植上游本地模板 `meme_render`；未验证群里是否真的开始发表情。同日再续（统计更正 + 关掉第三个）：发现原先"2588 会话 17 次"是脚本把提示词里的**工具定义**当成调用数错了，按 `tool_calls` 重算（2591 个会话）——`whale-memes__send_meme` 4 次（10-08/10-10）、`reply-meme__find_meme` 0 次；并按用户确认把同样依赖 aigengtu 1.36 MB 索引的 `reply-meme`（回复配图·梗鲸 v1.0.1）也关了，现在只剩 `nekowhale-stickers` 开着。同日再续（回复安全网）：用户问「那次会话为什么没发消息」，查到模型把两句话写在正文里没走 `send_message`；顺查发现核心安全网 `src/reply-rescue.js` 依赖的 5 个能力提供方一个都不存在，等于从未生效（2591 个会话里 581 个整轮零发送、57 次被艾特没吭声）。新增 `plugins/reply-guard` 提供 `reply.is-planning-text` / `reply.loose-send`，并把调用点扩到「有工具调用但没发消息」的形态（追加而非替换，且回填 tool_calls 保证 id 对得上）；规则靠 988 个历史会话回放磨出来（第一版约一半误救自我旁白，补三轮规则后 40 条抽样干净）。新增 `test/reply-rescue-test.mjs` 8/8（含真核心函数 + 真插件的集成用例），已挂进 `npm test`，20:35 重启（PID 24512）加载。未验证：真实群里第一次救援的表现。同日再续（排查插话判定失败）：7 次真实判定全挂但独立探针一直正常，于是逐条排假设——并发 3 路（2.9~3.7s 全成功）、16 条大会话上下文（4.1~4.6s）、密钥与配置同源、加载全量 36 个技能后仍成功、Node 与 Electron-Node 两种运行时都成功、失败时刻无会话在跑（不是争抢）——全部排除。**却顺带挖出一个真 bug**：`plugin-loader` 给插件的 `log/warn` 走的是 `console.log/warn`，而应用以 detached + `stdio:'ignore'` 启动，stdout 直接丢弃 —— 36 个技能的运行期日志（含"为什么失败"）一进应用就没了，所以插件明明 warn 了原因、日志文件里只剩笼统一句「判定失败」。改成走 `logger`（落盘+控制台），并让 context-chime 把失败原因随 `skipped` 返回给核心。重启（PID 55492）验证：`[skill:context-chime]` 等插件日志已出现在 `data/logs/`。**收工前拿到了判定样本**：21:11 插话判定成功一次（「他们互相@调侃，没在问机器人」→ 不接，理由正确），21:06 重启后 4 次判定 0 失败；7 次失败仍无铁证，但全部落在 17:29–19:25 那段频繁热重载的窗口，最像"热重载瞬间设置读不到 → 回落默认 64 token / 6 秒"。另外确认：**安全网 21:13 在真实群里救回一句「明早没课 那还熬着」并发出**（首次实战）。提交：主仓 `933cad2` / `29f5614` / `9d44b94` / `c9a859a`，插件仓 `a7ec353` / `63f1617`，均已推送。另注：重启时旧实例残留锁没清干净，新实例抢不到锁自退，应用空了三分钟；清锁后恢复（这是 `scripts/restart-app.mjs` 可改进之处）。
- 2026-10-23 · DeepSeek Harness：收梗质量闸——针对真实复盘「6 示例 + 13 群梗大多算不上梗」：提示词收紧（定义/正反例/confidence/evidence/why），落盘加闸（可信度 0.72 默认、占位与纯数字、水回复、复读触发句、无 evidence、每群上限 2），示例去重纳入 rejected；设置页加「可信度门槛/每群梗上限」，待审行显示依据与可信度并加「驳回」按钮。验证 persona-review-test 6/6、test-prompt、prompt-anchor、render-test 85、coverage-wiring 5/5；同日 21:33 重启 Electron 实例（PID 57488）加载新代码，控制台 3210 与 OneBot 正常，`/api/config` 已带新阈值；21:40 又用新增的 `scripts/restart-app.mjs` + 项目 skill `qq-agent-restart` 完成一次重启（57488→59712）验证工具可用；未真实跑复盘。已提交 `719bb30` / `c4e72ee`（未推送）。
- 2026-10-23 · DeepSeek Harness：优先级评估 + 示例库「梗解释」——按用户决定把 MC 降级暂缓、meme 先行；给 `config.persona.examples` 加可选 `note`：复盘起草生成并单行化落盘（缺省空串）、提示词渲染「梗解释：」行、capture/POST/PUT 读写、面板折行展示与添加/编辑入口（顺修编辑弹窗未回填 bad 的存量 bug）。验证 persona-review-test 4/4、test-prompt、prompt-anchor、render-test 85、coverage-wiring 5/5、coverage-http 127 过 1 失败（既有 qq-portable 环境项）；未在真实实例跑复盘、未重启、未调用模型。已提交 `719bb30`（未推送）。
- 2026-10-22 · DeepSeek Harness：撤回并行 worktree，并同步回写本文件。核对两处 worktree 与 3 条方向分支均 0 独有提交、skills 与主仓逐文件一致、plugins 工作树无独有提交后：① 归档方向 TASKS/WORKSPACE/baseline 到 `.goal-baseline/isolation-20261021/worktrees/`；② 删除两个 worktree（约 1.2GB）及插件仓库对应工作树、5 条空分支（feat/memes、feat/minecraft、feature/voice-bridge、codex/*-plugins）；③ 本文件更新——七项梗收集待办与 MC 收尾/人设验收收回主线，next 改为单仓推进自主摸鱼 A，交接摘要新增「2026-10-22 撤回并行 worktree（当前有效）」并标注旧隔离段已撤回。环境整理完成，回到单仓 main 开发；未启动实例、未跑测试、未提交／推送。
- 2026-10-26 · DeepSeek Harness：让它在冷场时有话可说 + 旧闻防线 + 混合搜索（用户三个提问带出来的一串）。**报时取证**：AI-Hub 群近 14 次主动发言 13 次在报时间、176 次主动唤醒里仅 13 次（7%）用过联网工具；冷场唤醒时提示词里唯一会变的只有【当前时间】，未读/已读/素材全空——不是没权限（98 个工具都在），是没东西可说。**修**：`plugins/hot-trend-tracker` 在 `ctx.proactive` 时把 4 条热点递到提示词末尾（本地读、游戏优先、可关）；补上压根不存在的 `skills/hot-trends`（提示词一直承诺 `hot_brief`，实测工具表里没有任何 `hot_*`，三个只读工具走 `knowledge.hot-trends` 软依赖）。**旧闻事故**：`ranking/v2?rid=4` 是冻结在 2025-04-01 的快照（96 条 pubdate 全 1743xxx ≈ 573 天前），我又没存发布时间，于是去年的 PV 被说成"新出了"——换源为 `popular` 按分区筛（0~2 天）+ `pubAt` 入库 + 抓取/查询双闸 + 素材标（今天/昨天/N天前）+ 提示词禁止把 N 天前说成新出，清库 258→129→31（B 站两路，0 条无日期）。**搜索**：Bing 多词中文会静默降级（「绝区零 星徽骑士EP」三次都返回「绝（汉语文字）」百科），DeepSeek 时间锚停在 2026-05 但解释类答得好，于是做 `provider=hybrid`（token 命中 0 判退化才 fallback），工具描述/系统提示/verify-first 三处同步改"没链接就用总结、不许假装看过原文"，控制台加"混合"选项（顺修字段组互相覆盖）。**验证**：hot-trends 26/26、web-search-hybrid 8/8、selftest 41/41、test-prompt 全过；生产实测 4 次冷场全部不再报时（含 AI-Hub「刷到星铁新出了个动画短片…」，它自己调 web_search 查证、查不到就明说不确定）；hybrid 实跑 334ms 带链接 / 457ms / 退化后 9.9s 答对。实例重启两次（PID 52448），控制台 200、OneBot 已连。已提交主仓 `c7e482b` + 插件仓 `29ff3d1` 并推送（推送需 `GCM_INTERACTIVE=never`）；用 hunk 级暂存把工作区里他人的「心事本（mind）」WIP 排除在外、未触碰。**未验证**：连续多日的观感（会不会变成资讯播报机）、hybrid 长期兜底比例；贴吧按用户要求先关，待恢复（无发布时间是它的已知代价）。
- 2026-10-30 · DeepSeek Harness：修「群里刷屏 finish{"summary":…} / finish: …」。取证到模型 `step-5-preview`（`api.fallbackModels` 第三顺位）把工具调用写成正文，核心内联解析只认 `<tool_call>`，于是被回复安全网当"成稿"救进群，再作为 self 历史自我强化（10-30 日志 52+2 次，提瓦特群与 van♂游群）。修三层：内联解析认裸调用形态（`name{json}` / `finish: 理由`，只认已知工具名）、发送链路与安全网按窄口径拦截（含全角冒号）、历史注入过滤脏 self 发言。新增 `test/inline-tool-call-test.mjs` 27 项，reply-rescue 9/9、sender 冒号用例全过，selftest 41/41；`test:audit` 的 9 项失败逐条核对为其它技能存量问题。13:19–13:47 的改动此前一直未重启（实例 07:39 起跑旧代码，是"还在发"的直接原因），19:47 用 `scripts/restart-app.mjs --electron` 拉起 PID 38960 生效（3210 返回 200、OneBot 已连），重启后 0 次泄漏。未验证：真实群再遇该模型时的表现。已提交主仓 `56a0998` + 插件仓 `fd1bb22`（未推送）。
- 2026-10-30 · DeepSeek Harness：接手「心事本（mind）」WIP 并做扎实。取证：`data/mind` 6 个文件全是兜底垃圾（`source=thinking`，内容为 `finish` / `finish: …` / `【深度思考】…` / `主人身份：…` 系统回声），主路径从未触发。修法：`isMeaningfulMind` + `resolveMind` 统一质检（两路都不合格就不写，不再用垃圾覆盖真念头）、`saveMind` 同闸、过期文件读取即删、系统提示补第 9 条教学、TTL 60→30 分钟；清理 6 个脏文件（备份 `data/mind.bak-20261030/`）。mind-test 扩充后全过、`test:leak` 全过；selftest 因启动期事件循环被后台任务阻塞 5~8 秒而超时（诊断确认阻塞在 runHook 段、与本次改动无关，诊断代码已还原）。同时把此前未入库的 `src/mind.js` 一并提交，修复 HEAD「引用 mind.js 但文件不存在、拉下来起不来」的既存问题。
