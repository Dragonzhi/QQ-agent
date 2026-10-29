# doc/ 目录索引

> 2026-10-29 起文档分类：**新文档按下面的分类落位**；存量文档凡代码注释里有路径引用的
> （如 `doc/persona-meme-plan.md` 在 src/、ui/、test/ 有 20+ 处硬编码），**留在原位不动**，
> 只在索引里登记。别为一时的整洁做大面积移动——会砸掉一批注释引用。

## 分类约定

| 目录 | 放什么 | 现有内容 |
|---|---|---|
| `doc/plans/` | **方案/规划评审件**：开工前列明现状、架构、里程碑、Git 约定 | [meme-distiller-plan.md](plans/meme-distiller-plan.md) |
| `doc/extend_development/` | 扩展（插件/Skill）开发文档，对外开发者文档 | 9 篇（见下方明细） |
| `doc/features/`（启用中） | **功能专题/复盘记录**：设计定稿、踩坑长文、事故复盘 | （暂空，从下一篇起启用） |
| `doc/` 根 | 存量历史文档（有代码注释引用，不迁移）+ 本索引 | 3 篇 + README |

## 存量文档一览（根目录，原地保留）

| 文档 | 一句话 | 备注 |
|---|---|---|
| [persona-meme-plan.md](persona-meme-plan.md) | 回复示例库 + 群内自产梗 + 每晚复盘（P0/P1/P2）总方案 | src/ ui/ test/ 20+ 处注释引用其路径 |
| [agent-freedom-security-analysis.md](agent-freedom-security-analysis.md) | Agent 自由度安全治理分析（授权分层、SSRF、发送闸） | TASKS.md 引用 |
| [voice-bridge.md](voice-bridge.md) | 语音桥功能的设计与运维长文（含插件仓附录） | src/app.js 注释引用 |

## extend_development/ 明细

| 文档 | 一句话 |
|---|---|
| [plugin-development.md](extend_development/plugin-development.md) | 确定性型插件（plugins/）开发指南 |
| [skill-development.md](extend_development/skill-development.md) | LLM 型 Skill（skills/）开发指南 |
| [skill-reference.md](extend_development/skill-reference.md) | 扩展共同机制完整参考 |
| [skill-system.md](extend_development/skill-system.md) | 扩展系统架构总览 |
| [skill-guide-for-beginners.md](extend_development/skill-guide-for-beginners.md) | 零基础入门指南 |
| [prompt-pipeline.md](extend_development/prompt-pipeline.md) | 提示词组装流水线说明 |
| [multi-instance.md](extend_development/multi-instance.md) | 多实例并存说明 |
| [snowluma-capabilities.md](extend_development/snowluma-capabilities.md) | SnowLuma 协议端能力清单 |
| [video-modes.md](extend_development/video-modes.md) | 视频模式说明 |
