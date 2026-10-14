# 人设示例库 + 群梗学习 实施计划

> **状态**：进行中（2026-10-14）｜ **进度**：P0 已完成 ✅ → P1 已完成 ✅（含 6 项 HTTP 用例）→ P2 待开工
> **关联文档**：[README 扩展机制](../README.md) ｜ [skill-reference](extend_development/skill-reference.md) ｜ [prompt-pipeline](extend_development/prompt-pipeline.md)
> **目标**：让机器人说话越来越像真人群友——① 一键把实战好回复沉淀进人设示例（A 路线）；② 每晚 LLM 复盘自动起草候选示例 + 收集群内自产梗（B 路线），人工只做审批。

---

## 0. 已完成的前置项

| 项 | 状态 | 备注 |
|---|---|---|
| reply-meme 目录嵌套修复 | ✅ 2026-10-14 | `skills/reply-meme/reply-meme/` 内容上移一层，内层空目录已删。该技能此前静默失效，修复后待扩展页确认加载 |

## 1. 背景事实（方案依据）

| 事实 | 位置 | 影响 |
|---|---|---|
| 存档含机器人自己发的消息（`self: true`，递增 `id`） | `src/store.js` appendSelf | 「收进人设」挂存档页，上下文直接切片 |
| 提示词段落按「稳定→易变」排序，角色设定最前 | `src/prompt.js` buildUserPrompt | 示例区插【角色设定】之后，保住前缀缓存 |
| 通话模式人设只截 900 字（`CALL_PERSONA_CHARS_DEFAULT`） | `src/prompt.js` L244 | 示例区只注入普通会话，通话不带 |
| 分钟级定时器先例（telemetry） | `src/telemetry.js` L111 | 复盘定时器照此模式 |
| 一次性 LLM 调用 + 用量记账现成 | `src/llm.js` chatCompletion / addUsage | 复盘起草复用，成本进用量页 |
| 路由风格 `method + pattern` 平铺 | `src/routes.js` | 新端点照抄现有风格 |
| 网络梗闭环已有（trendy-memes：查库→web_search→自学习收录）；每日热梗已有（hot-trend-tracker） | `skills/trendy-memes/`、`plugins/hot-trend-tracker/` | 本计划只补**群内自产梗**，不重造网络梗链路 |

## 2. 观察任务（与开发并行，不占开发量）

| 编号 | 内容 | 判定 |
|---|---|---|
| O1 | 观察 trendy-memes 是否真的触发：会话页搜 `trendy-memes__` 工具调用；`data/trendy-memes/user-added.json` 是否出现 | 一周内零触发 → 排查（提示词 priority / trigger 条件），必要时微调规则措辞 |
| O2 | 人肉翻 `skills/trendy-memes/kb/memes.json` 底稿（现 14KB），觉得太薄就补一批常用梗 | 纯人工编辑，存盘即生效 |

## 3. 数据结构（P0 定稿，P1/P2 共用）

```js
// config.persona.examples[] —— 人设回复示例
{
  id: 'ex_1728...',            // 生成即可
  status: 'active'|'pending'|'rejected',
  trigger: '华莱士不敢吃 吃一次拉一次',   // 群友原话，不含昵称（防模型学会喊名字）
  good: ['草 勇士', '完了 已经点了'],
  bad:  ['每个人的肠胃情况不同……'],
  tags: ['吐槽'],
  source: 'capture'|'manual'|'review',   // capture=存档页收藏 / manual=面板手填 / review=复盘起草
  createdAt: 0, usedAt: 0
}

// data/group-memes/<chatId>.json —— 群内自产梗（per-chat）
{ memes: [{ id, name, meaning, example, status, source, createdAt }] }

// 设置项（config）
persona.examples.maxActive: 30        // active 示例硬上限
persona.review: { enabled: false, hour: 4, maxDrafts: 5, groupMemes: true }
```

## 4. 批次

### P0 数据结构 + 提示词注入（基础）

**改动**：`src/config.js`、`src/prompt.js`、`test/test-prompt.mjs`

1. config 默认值 + 兼容迁移（老配置无 `persona.examples` → 视为空数组）
2. `renderExamples()`：渲染成小鲸鱼卡第七节同款格式（`群友：X / 你不要：… / 你可以：… / 或者：…`）；
   - 注入点：【角色设定】之后、【表情包】之前；仅普通会话路径（通话路径不注入）
   - 首行固定加一句「示例是风格参考，禁止原样复读」
   - 只渲染 `status === 'active'`；超 `maxActive` 按 createdAt 淘汰最旧
3. **验收**：手改 config.json 加 2 条示例 → 新会话提示词里出现示例区；状态过滤与上限淘汰有单测

### P1 一键收藏 + 示例库面板（A 路线主体）

**改动**：`src/routes.js`、`src/store.js`（加一个切片查询）、`ui/app/04-archive-usage.js`、`08-modals.js`、`06-settings-render.js`、`07-settings-events.js`

1. 端点 5 个：
   - `POST /api/persona/examples/capture`：`{chatKey, localId}` → 存档取该 self 消息 + 前面最多 2 条非 self 消息 → 返回预填数据（前端弹窗可改）→ 建 pending
   - `GET /api/persona/examples` ／ `POST /api/persona/examples`（手动添加）／ `PUT /api/persona/examples/:id`（编辑/晋升/驳回）／ `DELETE /api/persona/examples/:id`
   - 晋升时：trigger 规范化查重 + 强制 maxActive（超限淘汰最旧 active）
2. 存档页：机器人自己发的消息 hover 出「收进人设」按钮 → 弹窗预填 trigger/good/bad → 保存 pending
3. 设置页人设编辑区下方「示例库」面板：active/pending 分组、晋升/删除/编辑、手动添加表单
4. **验收**：翻存档 → 一键收 → 审批 → 下一场会话生效，全链路走通

### P2 每晚复盘（B 路线，含群梗收集）

**新增**：`src/persona-review.js`；**改动**：`routes.js`（review 开关端点）、`06/07-settings-*.js`（开关/时间/上限）、`prompt.js`（群梗注入段）、`08-modals.js`（面板加「群梗」分区）

1. 分钟级定时器对表，到 `review.hour` 触发一次：
   - **任务一（示例）**：当天各群 self 消息 + 各自后续 2~3 条群友反应（「草」「哈哈哈」、接话 = 正信号）→ LLM 挑 3~5 条最像真人的 + 1~2 条最 AI 味的 → 结构化 JSON → 去重后写 pending（source: review）
   - **任务二（群梗）**：当天存档里反复出现、但库里没有的内部黑话/绰号/事件梗 → 连含义和用例一起写 `data/group-memes/<chatId>.json`（status: pending）
   - 校验失败/LLM 报错 → 静默跳过并记日志，不影响主流程
2. 群梗注入：`prompt.js` 在记忆段附近加【群内梗（本群黑话）】段——每群上限 20 条、最近优先、只注入当前会话对应群；变化频率低，属稳定前缀
3. 用量走 addUsage（复盘成本在用量页可见）；设置页：开关、触发时间、每日上限、群梗开关
4. **验收**：mock LLM 单测起草解析；真实跑一晚 → 次日面板出现待审示例与群梗，审批后生效

### P3 可选增强（跑顺再说，不排期）

- 群友反应信号加权评分；示例 usedAt 统计 + 超龄淘汰建议
- 复盘完成后私聊通知 owner 待审数量（先确认 owner-identity 插件暴露的能力形态）
- 复盘顺带输出「旧示例过拟合，建议删除」清理建议
- 群梗支持群友直接教（「记住：XX 的意思是……」→ 模型调工具记录）

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 示例膨胀推高每会话成本 | maxActive 硬上限 + 晋升时强制淘汰；复盘每日上限 5 条 |
| 模型复读示例原话 | 反例格式 + 每条多「或者」变体 + 渲染区首行禁复读 |
| 复盘自嗨（把平凡的回复当宝） | 只进 pending，人审后才生效；source 标记可追溯 |
| 群梗注入泄露到别的群 | per-chat 文件 + 按会话注入，天然隔离（与工具绑定会话同一原则） |
| 前缀缓存失效 | 示例/群梗均低频变更，处于稳定段，可接受 |
| capture 抓错上下文 | 弹窗预填可改可删；触发句不含昵称 |

## 6. 批次依赖

```
P0 ──→ P1 ──→ P2 ──→ (P3)
```

严格串行：P1 依赖 P0 的结构与渲染；P2 复用 P1 的 pending 通道与面板分区。观察任务 O1/O2 随时可做，与开发互不阻塞。
