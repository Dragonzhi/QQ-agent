# 小鲸鱼声桥（VoiceBus）设计文档

> 状态：设计中 · 2026-10-10 · 作者：管理员（与 DeepSeek Harness 协作整理）
> 目标：让小鲸鱼能"打电话"——QQ 语音通话实时对话，并保留扩展到游戏语音、浏览器热线的能力。

---

## 零、决议记录（2026-10-10 对账后锁定）

| # | 议题 | 决议 |
|---|---|---|
| 1 | 管理员自己要在通话中说话 | **要**。Windows"侦听此设备"把物理麦混入 CABLE-B（零代码，延迟约 200ms） |
| 2 | 群通话响应策略 | **点名才接**（喊"小鲸鱼"/@）；1v1 全接 |
| 3 | 1v1 会话绑定 | **绑对方 QQ 号**，印象/记忆按真人走 |
| 4 | 通话内容记忆 | 进会话存档（本地）；长期记忆由人格自主判断，不强制 |
| 5 | 挂断判定 | 手动"挂断"指令 + **空闲 15 分钟自动睡** |
| 6 | 无声纹陌生人 | 人格层自然处理（"你谁啊"），不特殊编码 |
| 7 | ASR | **StepFun 双向流式 ASR（`asr-stream`）**，与 LLM 同厂商同余额；edge-tts 同级不涉及。Python worker 维护 WS 长连 |
| 8 | ffmpeg | 装 CLI：`winget install -e --id Gyan.FFmpeg`（TTS mp3→PCM 转码；EdgeTTS 若直出 raw PCM 则兜底） |
| 9 | QQ 设备选择 | **已确认**：QQ 语音通话中可切换麦克风/听筒（管理员 2026-10-10 实测），通话内选设备即可，不动系统默认。另发现本机有**立体声混音**，可用免费单电缆方案（见第四节 B 案） |
| 10 | 音频 IO 实现 | **Python worker**（sounddevice+faster-whisper 备胎+requests），零编译、崩溃隔离；项目已有 jm_worker.py 的 IPC 先例 |
| 11 | TTS | **EmotionTTS（IndexTTS 系，UP 主服务，有余额）主选**；edge-tts 免费兜底；StepFun 音色复刻/本地 CosyVoice（4060 可跑）为 M2 音色升级路线 |
| 12 | 回声处理 | 实测暂未出现，仍做：TTS 播放期间采集门控 + 朋友端建议耳机；必要时上 WebRTC AEC（speexdsp） |

**验证路径（先于真通话）**：QQ 里放视频/语音（扬声器=CABLE-A）→ bridge 采集→ASR→小鲸鱼→TTS→CABLE-B→耳机听全链路，通过后再拉群友。

---

## 一、背景与目标

群友已经对机器人产生感情，"给小鲸鱼打电话"是当前最优先需求。约束与既有决策：

1. **手动接听**：管理员在 QQ 客户端手动接通话，不做 UI 自动化/模拟器自动接听（脆弱且触发风控）。声桥只负责**音频的采集与播放**。
2. **不碰协议**：不做 AVSDK/协议逆向，封号风险为零。全部通过 Windows 音频设备路由实现。
3. **大脑不变**：人格、记忆、工具、上下文判定全部复用 QQ-agent 现有引擎，声桥只提供"耳朵和嘴"。
4. **可扩展**：同一套总线支持未来的游戏语音（MC 联机）、浏览器热线、自动接听模块。

## 二、总体架构

```
                    ┌────────────────────────────────────────┐
                    │            QQ-agent（大脑）              │
                    │  人格 / 记忆 / 84 工具 / 会话编排 / LLM   │
                    └───────▲───────────────────┬────────────┘
                            │ 转写事件           │ 回复文本
                    ┌───────┴───────────────────▼────────────┐
                    │          VoiceBus 声桥（插件）           │
                    │  ┌─────────┐  ┌─────┐  ┌─────────┐     │
                    │  │ VAD端点 │→│ ASR │  │   TTS   │     │
                    │  └─────────┘  └─────┘  └─────────┘     │
                    │  声纹归属（群通话）   门控/打断管理        │
                    └───────▲───────────────────┬────────────┘
                            │ 采集               │ 播放
              虚拟声卡 A (CABLE-A Input)   虚拟声卡 B (CABLE-B Input)
                            ▲                       │
                    ┌───────┴───────────┐   ┌───────▼────────┐
                    │ 便携QQ 扬声器      │   │ 便携QQ 麦克风  │ ← 管理员手动接听
                    └───────────────────┘   └────────────────┘
```

**关键简化**：不用进程级 loopback 等 exotic API。QQ 的扬声器直接输出到虚拟声卡 A，声桥用普通设备采集即得通话原声；TTS 播进虚拟声卡 B，QQ 麦克风设为 B，对端即听见小鲸鱼。

## 三、核心抽象：Profile

一份 Profile = 一套完整音频路由配置。声桥所有功能都是"切换 Profile"，核心代码零改动。

```js
// plugins/voice-bridge/lib/profiles.js
{
  id: 'qq-call',
  capture:  { device: 'CABLE-A Input', monitor: true },  // monitor=同时外放给管理员
  playback: { device: 'CABLE-B Input' },
  asr:      { engine: 'media.transcribe' },              // 复用现有 whisper 能力
  tts:      { engine: 'edge-tts', voice: 'zh-CN-Xiaoyi' },
  session:  { mode: 'private', bindTo: '<对方QQ号>' },
  echoGate: true,                                        // TTS播放期间静音采集
}
```

| Profile | 用途 | 采集 | 播放 | 状态 |
|---|---|---|---|---|
| `qq-call` | QQ 语音通话（1v1 / 群通话） | CABLE-A Input | CABLE-B Input | M1 实现 |
| `mc-voice` | MC 联机语音（Simple Voice Chat 走系统默认设备） | 默认播放（CABLE-A） | 默认录音（CABLE-B） | M3，仅配置 |
| `hotline` | 浏览器热线（全双工，可插话打断） | WS 客户端 | WS 客户端 | M3，新 source/sink |
| `auto-answer` | 来电自动接听（adb/模拟器模块，挂接在 qq-call 上） | 同 qq-call | 同 qq-call | 远期，可选 |

**控制面**：WS/HTTP API + 托盘菜单 + QQ 群指令（`接听` / `挂断` / `静音` / `上麦` / `谁在说`）。

## 四、Windows 音频接线（实施步骤）

### A 案：双虚拟声卡（VB-CABLE A+B，需小额捐赠，采集最干净）

1. 装 VB-CABLE A+B（vb-audio 官网捐赠流程，自行定价），重启音频应用。
2. QQ 通话内：**扬声器 = CABLE-A Input，麦克风 = CABLE-B Output**（QQ 语音可切设备，已实测）。
3. 声桥：采集 CABLE-A Output（朋友原声，无系统杂音）；TTS 播放到 CABLE-B Input；同时把采集外放到管理员耳机（监听）。
4. 管理员戴耳机（防自己的声音绕回采集端）。

### B 案：免费单电缆 + 立体声混音（本机可用，M1 先用）

本机已确认有**立体声混音**采集设备 + 已装免费 VB-CABLE（基础版）：

| 角色 | 设备 | 说明 |
|---|---|---|
| QQ 扬声器 | 系统默认播放（耳机） | 管理员直接听到朋友 |
| **采集源** | **立体声混音** | 默认播放的混音 = 朋友的声音（TTS 不在默认播放上，采不到自己） |
| QQ 麦克风 | CABLE Output | 接机器人的声音 |
| TTS 播放目标 | CABLE Input | → CABLE Output → QQ 麦克风 |
| 管理员自己的声音 | 物理麦“侦听此设备”→ CABLE Input | 与 TTS 混合，管理员也能在通话里说话 |

优点：零成本；TTS 不会被自己采集到（无自激）。缺点：立体声混音会混入其他系统声音（微信提示音等），通话时需静音其他应用；要干净采集时再升级 A 案（A+B）。

### 通用

- VB-CABLE 安装：`E:\QQRobot\tools\VBCABLE_Base\VBCABLE_Setup_x64.exe` 管理员运行，**装完重启**。A+B 包需在 vb-audio 商店捐赠后从 "My Download" 获取。
- 回声策略（决议 12）：TTS 播放期间采集端门控静音（它说话时不听）；朋友端建议戴耳机。
- 管理员手动接听 → 群/托盘发「接听」→ 声桥按当前 Profile 开始工作；「挂断」结束。

## 五、处理管线

```
CABLE-A 采集(PCM 48k) → VAD(能量+静音, 400ms 端点, 最短1s/最长15s)
  → [声纹归属]（仅群通话，见第六节）
  → ASR（复用 media.transcribe / 升级阿里云实时ASR）
  → 构造消息事件 { senderId, senderName, text }
  → 注入会话（等同群消息入站）
  → 小鲸鱼生成回复（send_message 同链路）
  → TTS(edge-tts → ffmpeg → PCM) → CABLE-B 播放
```

**延迟预算（级联方案，目标 < 2s）**：

| 环节 | 延迟 |
|---|---|
| VAD 端点检测 | ~300ms |
| ASR（StepFun 双向流式，首包） | ~300-500ms |
| LLM 首 token | ~400ms |
| TTS 首包（EmotionTTS/edge-tts 流式） | ~300-500ms |
| **合计** | **~1.3-1.7s** |

升级路径：阿里云实时 ASR（流式，300ms）+ CosyVoice 本地流式 → 可压到 ~1s。**不上 S2S 黑盒模型**：工具调用、人格控制、记忆在小鲸鱼的大脑侧，S2S 作为可选"嘴耳"模块未来以 source/sink 形式挂接（人格桥接），不替换大脑。

## 六、群通话：说话人分离（声纹注册方案）

### 6.1 问题

QQ 群通话中，客户端把所有远端语音**混音**后输出到扬声器（CABLE-A）。声桥拿到的是混合流，需要回答："这句话是谁说的"。

### 6.2 方案选型

| 方案 | 代表 | 结论 |
|---|---|---|
| 通用 diarization（聚类） | pyannote、3D-Speaker | 输出"说话人1/2/3"，无身份；还需二次映射到人；CPU 实时性差 |
| 云转录产品 | 通义听悟、小米录音 | **异步**（上传整段），适合会议纪要（可考虑给 forward-summary 用），不适合实时通话 |
| **声纹注册 + 实时匹配** | WeSpeaker / CAM++ / ERes2Net | ✅ **本方案**：直接输出"这是 XX（QQ号）"，与群友身份库天然对齐 |

### 6.3 核心思路：声纹库 = 群友身份库

这群人机器人**本来就认识**（记忆里有 QQ 号、群名片、印象）。所以不做匿名聚类，直接做"实名声纹库"：

- **被动注册**：群友在群里发的每条语音消息（`record` 段，media.transcribe 已经在下载这些音频）都是注册素材。累计 ≥3 条、总时长 ≥15s 即自动注册，无需专门录音。
- **存储**：`data/voiceprints/<QQ号>.json`——多段 embedding 质心 + 注册时间 + 样本数。仅本地。
- **匹配**：每段 VAD 语音提取 embedding → 与库内所有声纹算余弦相似度 → 最高分 ≥ 阈值（初值 0.75，按误识率调）→ 归属该群友。
- **模型**：WeSpeaker ERes2Net / CAM++（中文友好、CPU 可跑、单段 30-80ms），FunASR 的说话人模块同源可复用。

### 6.4 管线（插入第五节 ASR 之前）

```
VAD 段(1-3s) → embedding(WeSpeaker, ~50ms) → 声纹库匹配 → {qq, confidence}
   ├─ 命中      → senderId=qq, senderName=群名片（记忆库取）
   ├─ 未命中    → senderId='unknown', senderName='陌生人'
   └─ 多人重叠  → 取能量主导者 + 文本标注 "(可能多人同时说)"
```

实时性增量约 100ms，可接受。

### 6.5 兜底与边界

- **陌生人**：未注册声纹 → 会话里显示"陌生人"，小鲸鱼可自然问"你谁啊"（人格自然处理）。
- **重叠语音**：混音无解，取主导说话人并标注，不假装分清。
- **低置信**：0.6-0.75 区间 → "好像是 XX？"，让人格自己处理不确定性。
- **删除权**：群友说"删除我声音"→ 删声纹文件 + 确认，生物特征数据必须可删。
- **告知义务**：群通话中小鲸鱼应主动说明"我在听哦"（人格化处理，而非法律文本）。

## 七、会话模型

| 场景 | chatKey | 消息结构 |
|---|---|---|
| 1v1 通话 | `call:private:<对方QQ号>` | senderId 固定为对方 |
| 群通话 | `call:group:<群号>` | 每条转写 = { senderId: 声纹归属, senderName: 群名片, text } |

群通话直接复用**现有群会话架构**：@ 判定、群友印象、burst-merge（等他说完）、上下文插话判定全部原样生效。等于给引擎换了一副耳朵和嘴。

## 八、与现有代码的集成点

```
plugins/voice-bridge/
├── index.js         # 工具注册、capability、profile 切换、QQ 指令
└── lib/
    ├── profiles.js  # Profile 定义（见第三节）
    ├── audio.js     # naudiodon 采集/播放/监听外放（编译失败退 python sounddevice worker）
    ├── vad.js       # 端点检测 + 说话门控
    ├── asr.js       # StepFun 双向流式 ASR 客户端（asr-stream，决议7）
    ├── voiceprint.js# 声纹注册/匹配（群通话）
    └── tts.js       # edge-tts → ffmpeg → PCM 流
```

- **ASR**：StepFun 双向流式 ASR（`asr-stream`，决议 7）——Python worker 维护 WS 长连，VAD 段直接进流。本机无 speech-to-text 插件（`media.transcribe` 无提供者），故挂云不自带替换；`media.transcribe` 能力留给语音条场景未来启用。
- **TTS**：EmotionTTS（IndexTTS 系，决议 11）主选、edge-tts 兜底；mp3 经 ffmpeg CLI 转 PCM 播放（EdgeTTS 直出 raw PCM 时免转码）。音色升级路线：StepFun 音色复刻 or 本地 CosyVoice 3（RTX 4060 Laptop 可跑）。
- **音频 IO**：**Python worker**（`voice_worker.py`，sounddevice，决议 10）——采集 CABLE-A / 播放 CABLE-B / 管理员物理麦侦听混音；与 QQ-agent 经 WS 或 stdin/stdout JSON 通信（参照 jm_worker.py 模式）。零编译、音频侧崩溃不拖垮机器人。
- **回复出口**：hook `session-reply`（或等价点）把 `send_message` 的文本镜像到 `voice.say(text)`，由当前 Profile 的 TTS 播出。

## 九、扩展路线

1. **mc-voice（M3）**：MC 装 Simple Voice Chat，Windows 默认播放/录音设为 CABLE-A/B，切换 Profile 即可，零代码。群友联机时小鲸鱼"在语音里"。
2. **hotline（M3）**：浏览器 WS source/sink，全双工 + 可插话（WebRTC AEC）。群里用 `send_ark_share` 发带一次性 token 的"小鲸鱼热线"卡片链接。
3. **auto-answer（远期，可选）**：模拟器 + adb uiautomator 自动接听模块，作为 source 挂接，仅白名单来电 + 随机延迟接听。架构不变。
4. **会议纪要增强**：forward-summary 可接通用 diarization / 通义听悟（异步场景无所谓延迟）。

## 十、风险与合规

| 项 | 评估 |
|---|---|
| 账号安全 | 不碰协议、无 UI 自动化 → 风险≈日常使用。虚拟声卡是普通音频设备 |
| 内容合规 | 通话内容本地处理；用云 ASR/TTS 时过服务商审核；敏感词过滤在声桥出口 |
| 隐私 | 声纹属生物特征：仅本地存储、仅群内白名单、群友可随时删除并得到确认 |
| 成本 | ASR 本地 whisper 免费；edge-tts 免费；升级阿里云实时 ASR 按量计费约 ¥1-2/小时通话 |

## 十一、里程碑

| 阶段 | 内容 | 工期 |
|---|---|---|
| M1 | qq-call 全链路：VB-Cable 接线、采集/VAD/ASR/外放/TTS/会话注入、接听挂断指令 | 3-5 天 |
| M2 | 体验：门控、打断指令、音色、通话记忆（通话内容可按需 memory_append） | 2-3 天 |
| M3 | 声纹库（群通话说话人归属）+ mc-voice profile + hotline WS source | 按需 |

---

## 附录 A：本仓库现有本地核心补丁（fork 基线）

上游 `K0nd1us/QQ-agent` 更新会覆盖 `src/`，以下补丁需在 fork 中固化为提交，丢失时按此重打：

| # | 文件 | 内容 | 日期 |
|---|---|---|---|
| 1 | `src/onebot.js` | `case 'json'` 渲染卡片（动态加载 `plugins/share-card/lib/card.js` 的 `cardToText`，插件缺失退回占位符） | 2026-10-09 |
| 2 | `src/tools.js` | `get_message_images` 库存 URL 过期时经 `get_msg` 拉新 rkey 重试并回写存档 | 2026-10-10 |
| 3 | `plugins/share-card/index.js` | `read_share` 支持 `#消息编号` 反查 | 2026-10-10 |

另：`src/app.js`、`src/store.js`、`ui/index.html`、`package-lock.json` 有未提交改动（来源含早期改造），fork 前先 `git diff` 逐项确认归属再提交。

## 附录 B：Fork 操作备忘

```bash
# GitHub  fork K0nd1us/QQ-agent → 自己的账号（已完成：Dragonzhi/QQ-agent）
git remote rename origin upstream                                    # 原项目变 upstream
git remote add origin https://github.com/Dragonzhi/QQ-agent.git      # 自己的 fork 变 origin
# .gitignore 已加入 plugins/ 与 skills/（个人内容不进公开仓库）
git checkout -b feature/voice-bridge
git add src/ doc/voice-bridge.md .gitignore
git commit -m "core: 卡片渲染/图片URL刷新补丁 + share-card #编号 + VoiceBus 设计文档"
git push -u origin feature/voice-bridge
# 上游更新：git fetch upstream && git rebase upstream/main（补丁按附录A核对）
# 注意：src/app.js / src/store.js / ui/index.html 有来源待确认的改动，提交前先 git diff 审查
```

## 附录 C：调研结论（2026-10-10）

### C.1 类似项目 / 先例

| 项目 | 相关点 | 结论 |
|---|---|---|
| [chatgpt-mirai-qq-bot](https://github.com/Artsizi/chatgpt-mirai-qq-bot) | QQ+多平台 AI 机器人，插件生态+工作流，支持语音对话 | 生态最全的同类，但语音是"语音消息"级，非通话；其插件/工作流编排思路可参考 |
| [astrbot_plugin_self_open_llm_vtuber](https://github.com/murphys7017/astrbot_plugin_self_open_llm_vtuber) | AstrBot 插件：免手持语音交互 + **语音打断** + Live2D | **打断（barge-in）管线的现成参考**，VAD/打断/TTS 编排逻辑可直接借鉴到声桥 |
| LINUX DO《把 harness 接入微信电话来实现语音对话》 | 微信电话 + harness 语音对话 | 与本需求同构的民间验证（OS 级音频桥接路线走得通），非 QQ 场景 |
| [AsLive](https://github.com/Asstar-X/AsLive) | 实时交互语音项目 | 全双工交互参考 |
| AstrBot + MaiBot 联合部署 | 活人感/人格侧 | 人格与记忆的对照参考（本仓库已有更完整实现） |
| [LangBot](https://github.com/langbot-app/langbot) | 另一 QQ bot 框架 | 平台适配层可对照 |

**结论**：没人做过"人格+记忆+工具大脑 × OS 音频桥 × QQ 通话 × 声纹归属"这个组合——**架构层面没有现成轮子，但零件全部现成**：打断管线借 vtuber 插件，ASR/TTS/声纹用开源模型或云 API。属于组装，不是造轮子。

### C.2 STT（语音识别）选型

| 方案 | 延迟 | 成本 | 适用 |
|---|---|---|---|
| 现有 `media.transcribe`（whisper） | ~0.5-1s/句 | 免费（本地） | M1 起步，复用现成能力 |
| **FunASR paraformer-zh-streaming**（流式两遍式） | 流式，~300ms 首包 | 免费（本地） | M2 主力：中文流式、精度/延迟平衡 |
| SenseVoiceSmall | 极快 | 免费（本地） | 备选，多任务（情感/事件） |
| **阿里云百炼 qwen3-asr-flash** | 流式 | **0.00022 元/秒 ≈ 0.79 元/小时，送 10 小时** | 不想占本地 CPU 时的云选项，性价比极高 |
| 浏览器 `webkitSpeechRecognition` | 流式 | 免费 | 仅 hotline profile |
| 阿里云「实时 ASR + 声纹检索」（AnalyticDB） | 流式 | 按量 | 群通话声纹的云替代方案（本地方案优先） |

**推荐（已定稿，决议 7）**：**StepFun 双向流式 ASR（`asr-stream`）**——与 LLM 同厂商同余额，流式首包快；本地 whisper/faster-whisper 仅作断网备胎。百炼 qwen3-asr-flash（0.79元/小时+10小时免费）为云备选。

### C.3 TTS（语音合成）选型

| 方案 | 首包延迟 | 音色 | 成本 |
|---|---|---|---|
| **edge-tts** | ~300ms 流式 | 中文自然（晓晓/云扬等） | 免费 |
| **CosyVoice 3**（v3-flash 低延迟） | 流式 | 好，**可克隆小鲸鱼本尊音色** | 开源免费（本地 GPU）/ 百炼 API 按量 |
| IndexTTS2 | 流式（有 GPU 加速 PR） | 零样本克隆强 | 开源免费，需 GPU |
| GPT-SoVITS | 慢 | 克隆老牌 | 开源免费，工程重 |
| 火山豆包语音 / 百炼 CosyVoice API | 低 | 商业级音色多 | 按量，便宜 |
| QQ 原生 AI 语音（`send_group_ai_record`） | 群内场景 | 30+ 固定音色 | 免费，但 silk 解码成本高 |

**推荐（已定稿，决议 11）**：**EmotionTTS（IndexTTS 系，UP 主服务，有余额）主选**；edge-tts 免费兜底；M2 音色升级走 StepFun 音色复刻 or 本地 CosyVoice 3（RTX 4060 Laptop 8G 可跑，克隆小鲸鱼本尊音色）。

### C.4 S2S 实时语音 API（备用挂件，不替换大脑）

| 服务 | 备注 |
|---|---|
| **StepFun StepAudio 3 Realtime** | 当前模型供应商就是 StepFun，同平台开通最顺 |
| 火山引擎豆包端到端实时语音（RTC 方案） | 中文场景成熟，按分钟计费 |
| 阿里百炼 qwen-audio-3.1-realtime-plus | 多模态实时 |
| OpenAI Realtime API | 海外，贵 |

定位不变：S2S 只作为可选"嘴耳"模块以 source/sink 形式挂接（人格桥），**不替换文本 LLM 大脑**（工具调用/人格/记忆在黑盒侧会残废）。

### C.5 风险参考

- [QQ机器人开发防封号技术指南（OSCHINA）](https://my.oschina.net/emacs_8003976/blog/19443981)：本方案不碰协议、无 UI 自动化，虚拟声卡是普通音频设备，风险≈日常使用；对比之下协议逆向/自动化操作是风控重灾区。
- 声纹属生物特征：仅本地、白名单、可删除（见 6.5）。
