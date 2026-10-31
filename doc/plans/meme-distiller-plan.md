# meme-distiller：让梗库自己跟上时代的「蒸馏管线」方案

状态：**P0 已实现**（2026-10-31，主仓 `src/meme-candidates.js` + routes + 设置页面板；插件仓 `plugins/meme-distiller`）。
P1（nbnhhsh 缩写辅助）/ P2（B站评论区挖掘）未开工，等一周蒸馏质量数据再定。实现落点与验证记录见文末 §八。

---

## 一、背景：现有什么、缺什么

### 已有（不用重做的）

| 件 | 位置 | 现状 |
|---|---|---|
| 梗库"先查再用"底稿 | `skills/trendy-memes/kb/memes.json` | 手工整理的静态底稿，会过时 |
| 梗库自学习文件 | `data/trendy-memes/user-added.json` | 机器人查明白新梗后**自己写进来**；trendy-memes 的 `loadAll()` 每次都合并读取 |
| 热榜抓取 | `plugins/hot-trend-tracker` → `data/hot-trends.json` | 每天 6 点抓 B 站热门/游戏区，落盘带简介与发布时间（v1.2.0 已加旧闻防线） |
| 群内自产梗 | `src/group-memes.js` + `src/persona-review.js` | per-chat 隔离，pending → 人工审批 → active，已有完整待审 UI |
| 查梗工具链 | `skills/trendy-memes/index.js` 三个工具 + 提示词规则 | 模型**被动查**：群里有人用了才查，查不到才联网 |

### 缺口

自学习文件只在"群里撞到新梗、恰好被问了"时才会更新——**库的生长速度取决于被提问的频率**。
群里没出现过的当周新梗、以及出现了但没人追问的新梗，永远进不来。热榜数据躺在
`hot-trends.json` 里只有标题 + 简介，没有被提炼成"可复用的梗知识"。

目标一句话：**让 `user-added.json` 自己流起来**——每天自动从热榜蒸馏新梗候选，
人工一秒过审，晋升后 trendy-memes 检索立刻可用（消费端零改动）。

---

## 二、外部生态调研结论（2026-10-29）

**结论：没有一个"活跃维护、可直接接入"的中文热梗词典服务。** 都只能当数据源参考：

| 项目 | 状态 | 评语 |
|---|---|---|
| 小鸡词典（Jikipedia） | 已停服 | 曾经最灵的全量梗百科 + 更新流，必须放弃"现成词典服务"这条路 |
| [JikipediaArchive](https://github.com/Ayx03/JikipediaArchive) | GitHub 存档 | 停服快照，可当一次性底料导入，不能提供"与时俱进" |
| [NooBlock/astrbot-rag-kb](https://github.com/NooBlock/astrbot-rag-kb) | GitHub | 中文梗/黑话 RAG 语料库（4544 chunk）+ AstrBot 导入工具；**语料形态与分层思路都值得参考**，但绑定 AstrBot 导入流程 |
| nbnhhsh（能不能好好说话） | [免费 API 在线](https://lab.magiconch.com/nbnhhsh/) | 拼音缩写解码（yyds/xswl/bdjw…），无 Key；NoneBot 有成熟插件实现在先。**缩写类候选的辅助解释源，P1 接入** |
| [Riroaki/Meme-Crawler](https://github.com/Riroaki/Meme-Crawler) | 停止维护 | 小鸡词典/B站/微博爬虫，仅当爬取思路参考 |
| [dsh-bili-see](https://github.com/aba3345/dsh-bili-see) | GitHub | "云端模型刷 B 站看评论"的先例——证明这条路线可行，但没有做成即插即用插件 |

自建是唯一符合"与时俱进 + 每群语感"诉求的路。不 fork 它们而自建的原因：
我们的消费端（trendy-memes 检索 + 待审 UI）已经成型，自建只需加"生产端"。

---

## 三、总体架构

```
采集（每天定时）        蒸馏（一次 LLM 调用）              审查                    消费
───────────────      ──────────────────────           ──────────             ─────────────
data/hot-trends.json →  提取"正在被大家玩"的梗候选   →   candidates.json →      晋升条目写入
（B站热门/游戏区，        （排除纯热点事件）逐条：           pending → 人工晋升/驳回  user-added.json
 已有旧闻防线）            name/aliases/meaning/          （复用待审 UI 模式）    → trendy-memes
                          usage/tone/freshness/                                 检索立刻生效
                          evidence/confidence
```

关键设计决策（与现有系统的契合点）：

1. **晋升直接写 `user-added.json`**，不新建一套"梗库2"——trendy-memes 的 `loadAll()`
   已经合并自学习文件，条目形状 `{title, aliases, meaning, usage, tone, era, freshness, tags}`
   对齐它 `entriesOf()` 的惯例，晋升零迁移成本。
2. **候选 → 人工 → 生效** 的闸门照抄群梗库的 pending/active/rejected 模式（`src/group-memes.js`）：
   蒸馏是 LLM 产物，**硬编一个错解释比不认识更尴尬**（trendy-memes 提示词规则第 3 条的同款风险），
   所以无人值守的产物永远只进待审。驳回不删除，只参与去重。
3. **插件型而非技能型**：定时蒸馏 + 落盘是"能写死的确定性任务"（plugin-development.md 的判据），
   放 `plugins/meme-distiller/`、进**插件独立仓**（E:\QQRobot\qq-agent-plugins.git；主仓 .gitignore
   刻意不入库 plugins/）。审查面板与 routes 是控制台功能，放主仓。
4. **不注入提示词**：pending 候选不进任何提示词路径（区别于 hot-trend-tracker 的冷场递素材——
   那是已核实的资讯，这是未核实的解释）。模型永远只见晋升后的正式条目。

---

## 四、组件与数据明细

### 4.1 `plugins/meme-distiller/`（插件仓）

- `plugin.json`：category knowledge，无 requires，capabilities: [`knowledge.meme-candidates`]
- `index.js`：
  - 定时器骨架照抄 `hot-trend-tracker`（`checkIntervalMin` 轮询 + `distillHour` 整点 + `catchUpOnStart` 补跑）
  - 采集：经 `api.capability('knowledge.hot-trends')` 软依赖读当天条目（没装/没数据 → 如实跳过，绝不空跑烧 token）
  - 蒸馏：`import { chatCompletion } from '../../src/llm.js'`（照 persona-review 的用法），一次调用：
    system"只输出 JSON" + user 塞当天热点标题/简介 + 蒸馏规则
  - 落盘：`data/meme-distiller/candidates.json`（tmp + rename 原子写，照 group-memes.js）
- 提示词要点（蒸馏那一次调用）：
  - 定义对齐 group-memes 收梗提示词：反复出现、有固定说法与含义、**外部能查到的通用网络梗**（与群内梗互补）
  - 不收：纯热点事件（是新闻不是梗）、一次性的谐音玩笑、色情擦边（trendy-memes 同款拦截）、标题党口号
  - 每条必填 `evidence`（热榜简介里凭什么判断在玩这个）+ `confidence`，低于阈值不输出
  - `meaning/usage` 必须以证据为界：证据里看不明白的就写"出处：XX，含义待人工确认"，**不许编**
- 配置项：`enabled` / `distillHour`（默认 7，紧跟抓取 6 点之后）/ `maxTopicsPerRun`（默认 25）/
  `minConfidence`（默认 0.7）/ `maxOutPerRun`（默认 5）/ `keepDays`（待审保留天数）

### 4.2 主仓改动（小）

| 文件 | 改动 |
|---|---|
| `src/routes.js` | 候选库接口：列表 / 晋升(POST) / 驳回(DELETE) / 手动触发一次蒸馏 |
| `ui/app/06-settings-render.js` | 「梗候选库」面板：照抄群梗库面板的三处（06/07/08） |
| `src/meme-candidates.js`（新） | 候选文件读写 + 晋升时**追加**写 `user-added.json`（读取–合并–按 title 去重–原子写；格式对齐 trendy-memes `entriesOf`） |
| `.gitignore` | 收录 `.dsh-ops/`（Harness 会话产物，本次一并提交） |

### 4.3 数据形态

`candidates.json`：`{ "candidates": [{
  id, title, aliases[], meaning, usage, tone, freshness, era,
  evidence, confidence, tags[],
  status: 'pending'|'active'|'rejected', source: 'distill',
  createdAt, decidedAt? }] }`

晋升时映射为 user-added 条目：`{title, aliases, meaning, usage, tone, era, freshness, tags}`
——字段一一对应，多余字段丢弃（与 trendy-memes `entriesOf` 的宽容解析吻合）。

---

## 五、里程碑

- **P0 最小闭环（本次开工内容）**：定时蒸馏 → candidates.json → 待审面板 → 晋升写 user-added.json。
  验证：新测试 `test/meme-candidates-test.mjs`（去重 / JSON 容错 / 晋升写入形状 / 原子写）挂进 `npm test`；
  手动真实跑一次蒸馏，人工审 1~2 条，确认 trendy-memes `查网络梗` 能命中。
- **P1 补充源**：nbnhhsh 缩写辅助解释（无 Key）；观察一周蒸馏质量再决定要不要放宽 `maxOutPerRun`。
- **P2 B 站评论区挖掘（用户原始设想）**：对当天热门视频抽样抓评论区 → 出现频次统计 → 新梗候选。
  风控前提：评论 API 走 wbi 签名 + 低频（参考 bilibili-API-collect 社区文档），做成 `sourceBiliComments`
  （默认关）的实验开关。**P2 另开方案补充本文档，不在 P0 排期里**。

## 六、成本与风险

- Token 成本：每天 1 次 LLM 蒸馏调用，输入约 1.5~3k token（25 条标题+简介）+ 输出 ≤1k，可忽略量级。
- 风控：P0 只读 `data/hot-trends.json` 本地文件，零新增网络请求；P1 一个 POST；P2 有独立开关与频控。
- 质量：LLM 解释错误是最大风险。靠 evidence 必填 + 人工闸兜底；观察指标 = **晋升率**（审出晋升 / 总候选）
  与候选无效率。
- 边界重复：所有待审/驳回状态、面板交互逻辑与群梗库同构，不做第二套语义。

## 七、Git 管理约定（本方案落地时的提交切分）

- 主仓现状：main 与 origin/main 同步；工作区有「心事本（mind）」WIP（**另一会话的工作，TASKS.md 注明
  "别动"，本方案不碰**）与 untracked `.dsh-ops/`（已收录进 .gitignore 一起提交）。
- 本方案的文档提交走主仓（doc/、.gitignore、TASKS.md）；实现阶段的插件代码提交走插件独立仓
  （`plugins/.git` → E:\QQRobot\qq-agent-plugins.git，当前 clean），主仓只提交 routes/UI/test。
- 每次提交用明确 pathspec（`git add <具体文件>`），绝不 `git add -A`——防止顺手动到 mind WIP。
- 推送：文档提交推 origin/main；插件仓同样推 origin（TASKS.md 历史惯例：主仓/插件仓都推送留痕）。

## 八、实现记录（P0，2026-10-31）

### 落点

| 层 | 文件 | 说明 |
|---|---|---|
| 生产端（插件仓） | `plugins/meme-distiller/plugin.json` / `index.js` | 定时调度（distillHour + checkIntervalMin + catchUpOnStart）、能力 `knowledge.meme-candidates`（distill/status）、蒸馏 prompt、四道落盘闸、`trimPending` 上限 |
| 存储/晋升（主仓） | `src/meme-candidates.js` | 候选读写（原子写、损坏容错）、`buildCandidates` 之外的晋升查重、写 `user-added.json`、清理 |
| 接口（主仓） | `src/routes.js` | `GET /api/meme-candidates`、`POST /api/meme-candidates/distill`、`PUT /api/meme-candidates/:id`（active/rejected）、`DELETE /api/meme-candidates/:id` |
| 面板（主仓） | `ui/app/07-settings-events.js` | 设置页「梗候选库（蒸馏）」：待审/已晋升分组、晋升/驳回/删除、立即蒸馏一次 |
| 测试（主仓） | `test/meme-candidates-test.mjs`、`test/coverage-http.mjs` 3D 段 | 47 项单测 + 4 项 HTTP 覆盖 |

### 与原方案的两处偏差

1. **插件没有自己再实现一份存储**：直接 `import` 主仓的 `src/meme-candidates.js`（与 hot-trend-tracker
   import `src/config.js` 同口径）。好处是候选文件 schema 只有一处定义，插件与审查端不会各写各的。
2. **蒸馏不内置联网核实**：只靠 `evidence` 必填 + 人工闸。原方案里"P1 用 nbnhhsh 校验缩写"仍然有效，
   但 P0 不加任何网络请求（热榜读的是本地文件）。

### 验证记录

- `node test/meme-candidates-test.mjs` → 47/47。
- `node test/coverage-http.mjs` → 131 通过 / 1 失败（`POST /api/qq-portable/launch`，与本改动无关：
  本机装了便携 QQ，期望 400 实际 200），新增 3D 段 4 项全过，接口覆盖率 92%。
- `node test/render-test.mjs` → 85/85；`node test/tools-skill-audit.mjs` → 新插件清单完整 ✓（存量 9 项失败无关）。
- 真实蒸馏一次：20 条热榜 → 1 条候选「义父」（别名 义父义母/愿拜为义父，evidence 引热榜简介原文，
  confidence 0.72），停在 `data/meme-distiller/candidates.json` 待审。
- **实例部署验证（2026-10-31 22:22）**：`node scripts/restart-app.mjs` 重启（PID 41796，控制台 200、OneBot 已连接）；
  日志「✅ 加载成功：梗候选蒸馏」+「梗候选蒸馏已就绪｜每天 7:00（北京时间）」；
  `GET /api/meme-candidates` 200（返回候选 + 插件状态）、`POST /api/meme-candidates/distill` 实跑成功：
  25 条热点 → 2 条新候选（「丧病」0.8、「传统艺能」0.85），加此前「义父」0.72，待审 3 条，evidence 均引热榜原文。
- 未验证：每天 7 点的定时器自动触发（次日观察日志）；晋升后群里 `查网络梗` 的实际命中（需人工点晋升）。

### 后续增补：候选可编辑（2026-10-31）

用户看过面板后提出：候选只有晋升/驳回/删除，解释写歪时没有修正通道。
已实现「编辑」按钮 + `openMemeCandidateModal`，`PUT /api/meme-candidates/:id` 不带 `status`
时走编辑分支（`updateCandidate`），保存不改变状态；**已晋升的会同步改写 `user-added.json` 里的对应条目**
（按编辑前标题归一化定位），避免"面板改了、机器人查到的还是旧的"。测试见 `test/meme-candidates-test.mjs`（62 项）
与 `test/coverage-http.mjs` 3D 段。
