# meme-learning-upgrade：借 MaiBot 的学习管线，升级群梗与未知词闭环

状态：已批准，实施中（2026-10-31）。
上游方案：`doc/plans/meme-distiller-plan.md`（网络梗蒸馏 P0，已上线）。
本文档对应"群内学习"侧：把每晚复盘从"一次性判定"升级为"频次驱动 + 证据可回溯 + 未知词观察"。

---

## 一、目标与成功标准

**目标**：把 MaiBot 验证过的两件事落到我们已有的群梗链路上——

1. **频次信号**：群梗候选不再由"每晚一轮、一次定生死"决定，而是"在群里真实出现 N 次"才成立，并记录可回溯的证据消息 id；
2. **未知词观察**：群里反复出现、但梗库/网络梗库都没有的说法，在**被提到时**提示模型去查，查明白后经现有「收录网络梗」进网络梗库——把"群内信号"和"网络梗库"两条目前互不相通的链路接上。

**成功标准**：

- 一轮复盘后，新进待审的群梗都带 `count`（≥3）和 `evidenceMids`（真实消息 id）；
- 出现次数不够的候选被本地闸拦下，不再进入待审；
- 未读消息里出现观察词时，提示词里出现对应小段；没出现时不出现（不唠叨）；
- 不新增任何 LLM 调用次数、不新增网络请求；
- 现有面板/接口/数据结构向后兼容（旧群梗文件照常可读）；
- 全部相关测试通过、实例重启后正常；两个仓库最终干净，提交已推送。

---

## 二、借了什么、为什么（对照 MaiBot 源码）

| MaiBot 里的做法 | 我们落地的形态 | 不照搬的部分 |
|---|---|---|
| `jargon_miner`：证据消息 id + 出现次数 4/8/25/100 渐进重推含义 | 群梗条目加 `count`/`evidenceMids`/`inferredCount`；新候选当日 ≥3 次；**仅 pending** 在 8/25/100 次时允许修正含义 | 不搬它的 SQL 表与 Hook 体系 |
| `expression_review_store`：AI 审查 + 人工捞回日志 | 我们已有 pending/active/rejected 与面板，本轮只补字段与闸门 | 不引入第二套审查语义 |
| `jargon_context_matcher`：词在消息里出现才召回 | 用在**未知词观察表**（提及才注入），不挪动现有 20 条群梗静态块 | 不把群梗改成检索式（见 §七） |

许可证提醒：MaiBot 是 **GPL-3.0**，只借设计与阈值，不复制其代码进本仓库。

---

## 三、设计：频次信号（M1）

### 3.1 群梗条目新增字段（向后兼容）

`data/group-memes/<gid>.json` 的条目增加：

| 字段 | 含义 |
|---|---|
| `count` | 累计出现次数（只数非 self 的消息）|
| `lastSeenAt` | 最近一次在群里出现的 ts |
| `evidenceMids` | 证据消息 id，最多 3 个（QQ mid 可为负数，统一存字符串）|
| `inferredCount` | 上次做「含义修正」时的 count（仅 pending 使用）|

旧条目缺字段按 0/空处理，不做批量迁移；下一次复盘自然补齐。

### 3.2 纯函数（新建 `src/meme-learning.js`）

- `countOccurrences(messages, names)`：只数 `!self` 的消息；归一化（小写、去空白）后子串匹配；**每条消息最多计 1 次**；同时收集命中的 mid 与原文样例（≤3）。
- `nextInferenceThreshold(inferredCount, count)`：阈值 `[8, 25, 100]`，返回该不该修正。
- `mergeEvidenceMids(old, added)`：去重、保留最近 3 个。
- 常量：`MIN_DAY_OCCURRENCES = 3`、`INFER_THRESHOLDS = [8, 25, 100]`、`EXISTING_NAMES_MAX = 15`。

### 3.3 接线（`src/persona-review.js` 群梗任务，仍是每群一次调用）

1. 提示词补两块上下文：① **本群已收录的梗名**（≤15 条，减少重复提案）；② **可修正的 pending 条目**（名字 + 当前含义 + 当前次数，仅在越过阈值时给）。
2. 模型输出扩展为 `{"memes":[...], "updates":[...], "unknown":[...]}`（后两个可空）。
3. 候选落盘前：本地算当日非 self 出现次数，**<3 次直接丢**；通过者写 `count/evidenceMids/lastSeenAt`。
4. 已有条目：每晚累加 count、刷新 lastSeenAt、合并 evidenceMids；对越过 8/25/100 的 **pending** 条目应用 `updates`（更新 meaning、`inferredCount=count`，仍保持 pending）。
5. **active 条目永不自动改**：人工审定过的解释不能被模型夜间漂移。

不新增配置项：阈值写常量（设置页面板已经够长，等有数据再决定要不要做成可调）。

### 3.4 面板

`ui/app/07-settings-events.js` 群梗行 meta 增加「出现 N 次」；其余交互不变、不新增接口。

---

## 四、设计：未知词观察表（M2）

- 模型任务加一问："列出记录里反复出现、但你看不懂或不确定含义的说法（可能是不认识的新词/黑话/网络梗）"，输出 `unknown: [{term, evidence}]`。
- 本地校验：2~20 字、非噪声（复用 `looksLikeNoise` 口径）、不在群梗名/网络梗已收录名单、当日非 self 出现 ≥2。
- 存储：`data/meme-watch/<gid>.json`

  ```
  { "terms": [ { "term": "...", "count": 5, "firstSeenAt": 0, "lastSeenAt": 0,
                 "samples": [{ "mid": "123", "text": "原话" }] } ] }
  ```

  上限 15 条/群、TTL 14 天；原子写（tmp+rename）、损坏容错为空、gid 纯数字防路径穿越（照抄 group-memes.js）。
- 注入（`src/prompt.js`）：仅 `group:` 会话，且**本轮未读消息文本命中某个 term** 时，在【未读信息】/【新加入成员】之后、【心事本】之前插入一段（动态区，不打断前缀缓存）：

  > 【本群新说法】群里最近反复出现这些你还没搞懂的说法：X（7 次）、Y（5 次）。如果上下文正在用、你确实需要接，可以先用「查网络梗」或 web_search 查一下；查明白后可以用「收录网络梗」记下来。不确定就别装懂，也别每次都查。

  无命中则不注入；主动机会（`triggerEntries` 为空）不注入；私聊不注入。
- 不新增网络请求；查不查、查哪个，仍由模型按需决定。

---

## 五、文件级改动清单（全部主仓）

| 文件 | 改动 |
|---|---|
| `src/meme-learning.js`（新） | 计数/阈值/证据合并 + watch 文件读写与匹配 |
| `src/persona-review.js` | 群梗提示词扩展、`validateMemes` 接频次闸、updates/unknown 处理、watch 落盘 |
| `src/prompt.js` | 未读命中时注入【本群新说法】段 |
| `ui/app/07-settings-events.js` | 群梗行展示出现次数 |
| `test/meme-learning-test.mjs`（新） | 计数/阈值/证据合并/watch 存取与 TTL |
| `test/persona-review-test.mjs` | 扩：频次闸、updates 只改 pending、unknown 落盘 |
| `test/test-prompt.mjs` | 增：命中注入、无命中不注入、私聊不注入、位置在未读之后 |
| `TASKS.md` | 回写落地与验证 |

**不改**：`plugins/`（插件仓零提交）、`skills/`（不入库，继续用现有查/收录工具）、`src/routes.js`（无新接口）、`data/`（运行数据）。

---

## 六、里程碑与提交切分

| 里程碑 | 内容 | 提交 |
|---|---|---|
| M0 | 删根目录误建的 `nul`、删 `.dsh-ops/meme-distill-verify.mjs`；写本方案 | `docs(plans)：梗学习增强方案（频次信号 + 未知词观察）` |
| M1+M2 | `src/meme-learning.js` + 频次闸/证据 id + watch + prompt 注入 + 面板 + 测试 | `feat(memes)：群梗频次信号与未知词观察表（借 MaiBot 学习管线）`（实际合并为一个提交：两半共用同一批文件与同一段复盘逻辑，硬拆只会把同一函数切碎） |
| M3 | 重启实例（PID 41796）→ 手动跑一轮复盘 → 验收 → 回写 | `docs(TASKS)：回写梗学习增强落地与验证` |

全部用明确 pathspec（绝不 `git add -A`）；M3 结束时 `git push origin main`。插件仓本轮无提交。

---

## 七、风险、边界与明确不做

- **子串误计**：梗名可能是别人昵称的一部分 → 只数非 self、每条消息计 1、≥3 阈值 + 人工闸；必要时后续加昵称排除。
- **提示词变长**：已收录名列表限 15 条、观察段仅命中时出现，单轮增量 <200 字。
- **观察词噪声**：只提示"去查/问一句"，绝不直接给含义；TTL 14 天自然淘汰。
- **缓存前缀**：观察段只在未读之后的动态区，不动稳定段。
- **active 不自动改**：人工审定内容不漂移；修正只作用于 pending。
- **明确不做**：向量索引/加权采样（内容量不足）、引入数据库、每天自动联网查观察词（成本与幻觉）、把群梗改成检索式注入（当前每群 ≤20 条，挪位置换不来收益还破坏缓存）、移植 MaiBot 代码（GPL-3.0）。

---

## 八、验证与验收

- 单测：`node test/meme-learning-test.mjs`、`node test/persona-review-test.mjs`、`node test/test-prompt.mjs`。
- 回归：`node test/selftest.mjs`、`node test/render-test.mjs`、`node test/tools-skill-audit.mjs`（与存量 9 项失败基线比对，不得新增）。
- 实例验收：重启后 `POST /api/persona/review/run`，检查 `data/group-memes/*.json` 是否出现 `count/evidenceMids`、`data/meme-watch/*.json` 是否生成、待审面板是否正常。
- 观察 1~2 天的候选质量（晋升率、误收率），再决定阈值是否要做成配置。

---

## 九、实施记录（2026-10-31）

### 落点

| 层 | 文件 | 说明 |
|---|---|---|
| 纯函数 + 观察表 | `src/meme-learning.js`（新） | 计数/阈值/证据合并/修正/watch 读写与匹配 |
| 复盘接线 | `src/persona-review.js` | 群梗任务一次调用产出 memes/updates/unknown；频次闸；watch 落盘；summary 增加 `memesRefined/watchAdded` |
| 提示词 | `src/prompt.js` | 未读命中观察词时注入【本群新说法】（动态区） |
| 面板 | `ui/app/07-settings-events.js` | 群梗行显示「出现 N 次」（active 也显示） |
| 测试 | `test/meme-learning-test.mjs`（新，53 项）、`test/persona-review-test.mjs`（9 用例）、`test/test-prompt.mjs`（观察词 6 项） | — |

### 验证

- `test/meme-learning-test.mjs` 53/53；`test/persona-review-test.mjs` 9/9；
  `test/test-prompt.mjs`、`test/selftest.mjs` 41/41、`test/render-test.mjs` 85/85、`test/meme-candidates-test.mjs` 47/47。
- `test/tools-skill-audit.mjs` 仍是 9 项存量失败（qukan/qqzone 等），无新增。
- 实例重启（PID 51524）后手动跑一轮真实复盘：4 个群、0 错误；
  summary 已出现 `memesRefined/watchAdded` 字段；频次闸拦下 1 条低频候选；
  现存群梗文件开始出现 `count`（如 `好吃懒做的干饭肥鱼嘤鲸` rejected count=2、`飞雷神送餐` pending count=1）。

### 观察项（尚未定论）

- **日窗口 ≥3 次是否过严**：本次真实复盘只产出 1 条候选且被频次闸拦下。若连续几天仍几乎无候选，
  优先调 `MIN_DAY_OCCURRENCES`（2）或把统计窗口从"当天"放宽到"最近 N 天消息"（后者要解决跨晚重复计数）。
- **观察词未出现**：模型本次未产出 `unknown`；若长期为空，检查群聊文本里是否真有"看不懂的词"，
  或把 unknown 的提示写得更具体（给正反例）。
- 阈值/窗口目前是常量（`src/meme-learning.js` 顶部），有数据后再决定是否做成配置项。
