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

### B 案（v0.2 落地版）：免费单电缆 + WASAPI 回环（本机已跑通）

本机只有一对 VB-CABLE（基础版），一个方向一根线不够用，所以：

- 小鲸鱼说话 → 走「电缆」→ QQ 麦克风
- 听对方说话 → 走 **WASAPI 回环**（采 QQ 扬声器所在端点）

| 角色 | 设备 | 说明 |
|---|---|---|
| **采集源** | QQ 语音「扬声器/听筒」所在端点的 **WASAPI 回环** | 共享模式：不独占、可多进程同开、跟随端点，端点变了自动重开 |
| QQ 扬声器（听筒） | `扬声器 (网易虚拟音频设备)` | 虚拟声卡 = 电脑这边完全静音、无回声。想顺便听到对方就换成 `扬声器 (2- Realtek(R) Audio)` 并在设置里同步改 `captureDevice` |
| QQ 麦克风 | `CABLE Output (VB-Audio Virtual Cable)` | 把 TTS 送进通话，对方才听得到小鲸鱼 |
| TTS 播放目标 | `CABLE Input (VB-Audio Virtual Cable)` | → CABLE Output → QQ 麦克风 |
| 管理员自己的声音（可选） | 物理麦「侦听此设备」→ CABLE Input | 与 TTS 混合，管理员也能在通话里说话 |

优点：零成本、全虚拟、电脑侧静音无回声；回环是共享模式，不会像 WDM-KS 那样独占、也不会「关流就废设备」。
**唯一的硬约束**：`captureDevice` 必须和 QQ 里选的扬声器指向**同一个端点**，不一致就一句都采不到——2026-10-11 那次「自测无转写」就是这个原因。

### ❌ 本机被否掉的采集方案（踩过的坑，别再走）

| 方案 | 结果 |
|---|---|
| WDM-KS `立体声混音 (Realtek HD Audio 2nd output with SST)` | 能打开，但**一帧回调都不来**（它挂的端点是没插耳机的 2nd output，端点没在跑）；且 WDM-KS 引脚独占、强杀会留坏设备，要重启电脑 |
| `耳机 (2- Realtek(R) Audio)` 端点 | 该端点当前是「未插入」状态：WASAPI 回环直接 `0x8889000A`，MME 播放也等于扔进黑洞。**旧自测脚本正是往这里播测试语音**，所以怎么测都白测 |
| PortAudio 的内置回环 | 这一版 PortAudio 的 `WasapiSettings` 没有 `loopback` 参数，做不了回环 |
| `CABLE In 16ch` 当第二根线 | 实测它和 `CABLE Input` 是**同一根电缆**（往任一个播，`CABLE Output` 都响），分不出两个方向 |

### 通用

- VB-CABLE 安装：`E:\QQRobot\tools\VBCABLE_Base\VBCABLE_Setup_x64.exe` 管理员运行，**装完重启**。A+B 包需在 vb-audio 商店捐赠后从 "My Download" 获取。
- ⚠️ **从自动化/沙箱启动 QQ-Agent 的坑**：若环境变量里有 `ELECTRON_RUN_AS_NODE=1`（部分 agent 沙箱会注入），electron 会被当纯 Node 跑，主进程 link 阶段崩在 `Cannot read properties of undefined (reading 'exports')` 且不写 boot-diag。启动前先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。用户双击 bat 不受影响。
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

### M1 实施状态（2026-10-11 凌晨，v0.2 回环版）

已完成并在 feature/voice-bridge 分支提交：

- `src/voice-bus.js`：总线 WS 服务端（3211）、门控、空闲/口令挂断、状态广播、**重复 worker 拒连（回 bye）**
- `src/app.js`：总线实例化 + `ingestVoiceMessage`（合成入站，chatKey=`call:private:<target>`）
- `src/sender.js`：`call:*` 会话路由到语音桥（不发 QQ）
- `src/orchestrator.js`：`isPrivate` 放行 `call:`（1v1 全接）
- `plugins/voice-bridge/`：plugin.json + index.js（worker 看护、pid 单例门闩、控制连接、3 个工具）+ voice_worker.py
- 已验证：总线启动、worker 自动拉起、**回环采集端点枚举/试读/连续 8 秒无卡顿**、播放设备解析、edge-tts + ffmpeg 转码路径

v0.2 相对 v0.1 的改动（2026-10-11 排障后重构）：

1. 采集从「PortAudio WDM-KS 立体声混音」换成「**soundcard 的 WASAPI 回环**」，`captureDevice` 语义变成「QQ 扬声器所在渲染端点的名字」；
2. worker **设备缺失不再退出**（每 10 秒重试），从根上掐掉「秒退→重启」churn；
3. 采集常开 + 软件门控不变，但回环是共享模式，**不再需要「永不关流」保命**，端点消失会自动重开；
4. 采集线程独立（soundcard 的 `record()` 阻塞式），VAD 在采集线程算，凑够一句才丢给 asyncio 转写；
5. `[统计]` 心跳改成「无条件每 5 秒一条」（v0.1 只在采集时打，导致「有帧没有」看不出来）：帧数/峰值/噪声底/阈值/采集中/播放中；
6. 插件加 **pid 文件单例门闩** + `PYTHONUTF8=1`（否则中文日志全变乱码）+ 日志 2MB 轮转；
7. 自测脚本 `E:\QQRobot\tools\e2e_full.py` 改成**从 worker 日志读它实际打开的回环端点，播到同一个端点**，并给出 PASS/PARTIAL/FAIL 判定。

**首通真实通话验证（2026-10-11 中午）**：上行链路全通——手机说话 → 回环采集（峰值 3000-9000）→ 转写（`小鲸鱼。`/`鲸鱼娘。`，1.4s）→ 会话注入（chatKey=`call:private:3248569738`）→ 小鲸鱼回复（`在呢`/`怎么啦`/`鲸鱼娘来啦~`）。
暴露并已修的问题：① 下行**完全听不到**（见踩坑 14，MME 静默丢音）；② 幻觉转写（踩坑 15）；③ 忙时丢段（踩坑 16）。

**待验证**：修好播放通道后的第二通电话（下行是否真的送进 QQ 麦克风）。

### 实施踩坑记录（已写进代码注释）

1. **设备名 mojibake**：「立体声混音」等中文设备名是 GBK/UTF-8 错位字节，中文子串匹配不可靠 → 默认采集关键词用 ASCII 锚点 `Realtek HD Audio 2nd output`
2. **`f'max_{kind}channels'` 少下划线**：字典键是 `max_output_channels`，少一个下划线导致永远匹配不上（自检全 FAIL 的根因）
3. **WDM-KS 设备只能回调式打开**：RawInputStream / 无 callback 的 InputStream 报 `Blocking API not supported yet`，必须带 callback
4. **WDM-KS 立体声混音「开」不坏、「关」才坏**（2026-10-11 二次实测）：流一旦 close 就变 Invalid device 直到重启电脑；本机网易虚拟音频设备也不是直通声卡（输入输出不互通）。对策：worker 采集流**只开一次永不关闭**（软件门控替代开关流）+ 打开失败退避重试；**长期稳定方案仍是 VB-CABLE A+B（A 案）**——MME 设备无此毛病
5. **VAD 噪声底会被启动瞬间的语音污染**：阈值飙高永远检测不到 → 持续慢速跟踪 + 封顶 1200
6. **setup() 里读不到自己的配置**：技能此时还没进 registry，`api.config()` 返回 `{}` → 读配置和拉 worker 延后到 `activate()`
7. **StepFun ASR/TTS 暂不可用**：ASR 402 quota_exceeded、TTS 400 schema 不明 → M1 用 faster-whisper + edge-tts 免费本地栈，StepFun 留待在 profile 里换回
8. **沙箱启动 QQ-Agent 的坑**：`ELECTRON_RUN_AS_NODE=1` 会让 electron 静默崩溃，启动前删掉该变量
9. **「能打开」≠「有数据」**：WDM-KS 混音设备 `InputStream` 打开成功、`start()` 不报错，但回调一次都不来。判据只能是**帧计数**——所以 v0.2 的 `[统计]` 心跳无条件每 5 秒打一条（v0.1 只在采集中打，看起来像「设备没动静」，实际是「压根没帧」）
10. **测试语音播到了一个死端点**：`耳机 (2- Realtek(R) Audio)` 是没插耳机的插孔，MME 播放不报错、声音进黑洞。自测脚本必须**播到 worker 正在采的那个端点**（v0.2 的 e2e 从日志里读端点名再播）
11. **插件 reload 会泄漏 spawn 循环**（一晚上 1753 次 spawn、11 个 python 进程）：旧模块实例的 `restartTimer` 不会随 reload 停，各自拉一个 worker；worker 又因为「设备不全」秒退 → 5 秒一轮。两头堵：worker 不退出 + pid 文件单例门闩 + 总线拒连重复 worker
12. **worker 的中文日志会变乱码**：Python 子进程按 GBK 输出，Node `String(buf)` 按 UTF-8 解 → 文件里全是 `�`，排障时一个字都读不出。spawn 时给 `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`
13. **同一条总线不能有两个 worker**：总线原来是「新连接踢掉旧的」，旧 worker 3 秒后重连又把新的踢掉 → 乒乓重连。改成拒收新来的（回 `bye`，worker 收到即退出）
14. **PortAudio 的 MME/DirectSound 通道会「静默丢音」**（真实通话里「对方完全听不到小鲸鱼」的根因）：播放 `CABLE Input` 原来用 `sounddevice.RawOutputStream(device=7)`，`write()` 不报错、不抛异常、字节数也对，但电缆里**一点波形都没有**。同一段音频换 WASAPI 通道立刻有波形：

    | 播放通道 | 录 CABLE Output 的 rms |
    |---|---|
    | sounddevice MME `CABLE Input` | 0.0000 |
    | sounddevice DirectSound `CABLE Input` | 0.0000 |
    | sounddevice WASAPI `CABLE Input` | 0.1869 |
    | soundcard（WASAPI）`CABLE Input` | 0.1568 |

    对策：**播放也统一走 soundcard/WASAPI**，并在 `--check` 里加「播放回路实测」（播 1kHz → 录 CABLE Output，rms<0.01 判 FAIL）。这类故障只有实测能发现——日志层面一切正常（`播放: xxx` 照打）。
15. **whisper 在中文语境下的幻觉**：铃声/噪声被转成 `噔噔噔噔噔噔`、`MING PAO CANADA MING PAO TORONTO`。对策：转写里一个汉字都没有（`[\u4e00-\u9fff]`）直接丢弃；VAD 绝对门限 80 → **200**（本机实测噪声/铃声峰值 300-700、人声 3000-9000）
16. **转写慢会丢整句话**：`_asr_busy` 忙时直接丢段（实测漏 3 段）→ 改成 `asyncio.Queue(maxsize=2)` 排队 + `beam_size=1` 贪心 + `condition_on_previous_text=False`（后者既复读又慢一倍）
17. **QQ 通话里设备选择是「即时生效」的**：通话界面齿轮里选麦克风/扬声器即可，不用退出通话（实测）。麦克风必须选 `CABLE Output`，扬声器必须选插件 `captureDevice` 指定的那个端点，两者不一致就一句都听不到

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
