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

## 十二、通话延迟账本（2026-10-11 实测，首字延迟 = 转写进来 → 第一段音频开口）

M1 跑通后最大的体验问题是"回复慢"。逐环节量了一遍（每行都是实测，不是估算）：

| 环节 | 优化前 | 优化后 | 手段 |
|---|---|---|---|
| 聚批等待 `wakeDelayMs` | 2000ms | **200ms**（通话专属） | 电话里人是一句一句说，不需要"防抖聚批" |
| LLM 轮数 | 2 轮（第 2 轮只调 `finish`） | **1 轮** | 第 1 轮强制 `toolChoice=send_message` + 首批发出即收尾 |
| LLM 模型 | step-5-preview（**连 43 token 输入都要 4.86s**，重型推理模型） | **step-3.5-flash**（同提示词 2.69s vs 4.27s） | 插件设置 `callModel` |
| 工具数量 | 89 个（每轮两万多 token 的 schema，还劝模型"先查后答"） | **2 个**（send_message / finish） | 通话会话白名单 |
| system prompt | 17501 字符（20+ 个无关技能段） | **10652 字符** | 通话精简：剔除工具优先/空间日记/禁漫/方舟/梗库/表情包/分享卡片 |
| user prompt | 12385 字符（全量历史+记忆+表情包） | **1159 字符** | 人设截断 900 字 + 最近 6 句对话；不再读全量 store/memory |
| TTS | 整段 mp3 收完再 ffmpeg 再播 | **流式边合成边播** | 但首块仍是 edge-tts 云端 **1.22s**（本地怎么改都突破不了） |
| 播放启动 | — | **~120ms** | soundcard/WASAPI 共享模式（实测与 sounddevice WASAPI 持平） |
| ASR（whisper small int8） | 1.3-1.5s | 1.3-1.5s（未动） | 想更快只能换 `base`（~0.6s，精度略降）或云 ASR |

**结果**：LLM 单轮 5054-6093ms → **1214-1620ms**；首字延迟 6433-7508ms → **1519ms**。
剩下的地板 = ASR 1.3s + TTS 1.5s；再压需要换本地 TTS 或云 ASR。

### 通话档配置（全在插件设置界面，改完 15 秒内自动同步，不用重启）

| 设置项 | 默认 | 说明 |
|---|---|---|
| `callModel` | `step-3.5-flash` | 通话专用模型；留空=用主模型。本机 stepfun key 可用：step-3.5-flash(2.7s)/step-3.7-flash/step-router-v1 |
| `callProviderId` | 空 | 该模型的渠道 id；留空=跟随主模型渠道 |
| `slimPrompt` | true | 通话精简提示词（system + user 两条路径） |
| `callMaxRounds` | 2 | 通话最多几轮 LLM |
| `callWakeDelayMs` | 200 | 通话聚批等待 |
| `bargeIn` | false | 允许打断（TTS 播放期也放行上行）。**默认关**：对方手机外放时 TTS 会从对方麦克风绕回来，自己跟自己聊起来 |
| `asrModel` | small | whisper 模型；`base` 更快但精度略降 |

## 十三、语音输出卫生（emoji / 幻觉）

- **emoji / 颜文字**：模型会输出（实测 `我是小鲸鱼呀🥺`、`…好不好qwq`、`(≧▽≦)`），TTS 要么念出来要么吞掉。
  两头治：① 通话提示词明确禁止；② worker 合成前 `clean_for_tts()` 剥掉 emoji、颜文字、markdown 符号
  （`（笑）` 这种带汉字的括号内容保留）。
- **whisper 幻觉**：`initial_prompt` 里**绝不能写具体名字/口头禅** —— 写了"机器人叫小鲸鱼，群友常叫它鲸鱼娘"之后，
  它会对噪声/铃声反复吐「小鲸鱼娘。」（实测一分钟 15 次）。提示词只给语种和风格。
  另外用 segment 自带的 `no_speech_prob`/`avg_logprob` 过滤低置信段，并对「字幕by…」这类字幕套路做黑名单。
- **自激回环**：对方外放时自己的 TTS 会绕回采集端 → 用字符集合相似度比对最近 4 句，丢掉重合度 > 0.7 的。

## 十四、本地 GPU ASR（SenseVoice-Small）—— 2026-10-11 接入

**动机**：whisper-small 在 CPU 上 1300-1500ms/句，是首字延迟里最大的一块；实测社区结论也是"中文场景国产模型强于 whisper"。

**方案**：本地 **SenseVoice-Small（234M，FunASR）跑 GPU**，独立 venv + 常驻 sidecar 进程。

| 项 | 值 |
|---|---|
| 环境 | `E:\QQRobot\voice-engines\venv`（Python 3.12 + `torch 2.9.1+cu128` + `funasr 1.4.16`），**与 worker 那套 Python 完全隔离** |
| 模型 | `iic/SenseVoiceSmall`（892MB，ModelScope 缓存，离线可用） |
| 架构 | `voice-engines/asr_service.py` 常驻进程，stdin/stdout JSON 行协议；worker 启动即预热 |
| 实测 | 6.84s 音频 **首帧 352ms / 后续 68-78ms**（whisper 1300-1500ms，**约 18 倍**）；模型加载 3.7-4.3s |
| 显存 | 常驻 **约 1.1GB**（整机占用 1.97GB / 8GB） |
| 附加能力 | 每句带**情绪标签**（HAPPY/SAD/ANGRY/NEUTRAL…）与**声学事件**（Speech/BGM/Applause/Laughter…） |
| 韧性 | sidecar 起不来或中途崩 → **自动退回 whisper**（`--asr-engine sensevoice` 默认值不会让通话哑掉） |

**收益**：首字延迟 **2500-3000ms → 1537-1611ms**（2026-10-11 实测，私聊 + 2 人群通话）。

### 踩坑（都已修）
1. **Windows 上 `select()` 读不了管道**：`OSError WinError 10038`（只认套接字）→ 改「读线程 + `queue.Queue` + timeout」。
2. **协议流被库日志污染**：funasr/ModelScope 会往 stdout 打下载进度 → 客户端读到非 JSON 首行直接崩。做法：sidecar 启动时 `os.dup(stdout)` 复制一份专供协议，再把 `sys.stdout` 重定向到 stderr。
3. **ModelScope 锁互锁**：客户端超时被杀但子进程还活着 → 互相 "Still waiting to acquire lock" 卡死。做法：启动失败必 `kill` 子进程；必要时清 `~/.cache/modelscope/.lock`。
4. **`rich_transcription_postprocess` 会把情绪/事件渲染成 emoji 塞进正文**（实测正文变「🎼我。😊」）→ 改成自己剥标签，情绪/事件单独取；worker 侧再按事件过滤（非 `Speech` 直接丢，噪声/BGM 不再被"听"成文字）。
5. **专有名词误听**：两家 ASR 都把「小鲸鱼」听成「小金鱼」→ 结果层做 `NAME_FIXES` 修正（比加提示词可靠，提示词还会诱导幻觉）。

### 下一步可用的能力
- **情绪入戏**：`transcript` 消息已带 `emotion` 字段，总线可以据此写进会话上下文（"对方现在是笑的语气"）。
- **群通话说话人分离（M3）**：现在是"对方说什么都能听见"（混音），要做"谁在说"需要声纹库（见第六节）。

---

## 十五、「从 QQ 数据层拿说话人」调研结案：走不通（2026-10-11）

**背景**：用户提出"QQ 语音通话时说话人头像会亮，能不能从数据层拿到"。本地声纹聚类已放弃
（过度分裂），这是最后一条路。调研对象是 QQNT 客户端插件生态（LiteLoaderQQNT）。

### 结论：**不划算，结案。** 通话里的"逐人音频/说话状态"锁在原生 PPAPI 插件进程里。

| 事实 | 证据 |
|---|---|
| 通话媒体链路是 **PPAPI 原生插件**：`avsdk\AVSDKPlugin.dll`（内含 NTRTC + GroupVideo + BroadCast-Core），跑在**独立插件进程**，视频走 `PPB_Graphics3D` 共享纹理原生绘制 | 本地实测进程命令行有 `--register-pepper-plugins="…\avsdk\AVSDKPlugin.dll;application/x-ppapi-avSDK"`；腾讯 QQ 音视频团队官方技术文 |
| JS 插件（LiteLoaderQQNT 的 main/preload/renderer 三入口）**注入不进 PPAPI 插件进程**（那边跑的是 C++，不是 V8）→ **拿不到逐人 PCM** | 同上 |
| 引擎层**确实知道**"谁在说话"（`OnSDKEventProcess user start/stop speaking`、`NotifyPeerChatStates(is_mic_open)`），但这些事件从原生进程回传到渲染层的通道**无公开资料** | strings 命中；全网无文档 → 只能逆向 |
| LiteLoaderQQNT 官方仓库**已归档**（最后 push 2026-05-09，最新 1.4.1）；Windows 必须**绕过 QQ 完整性校验**（`application.json` 是对 `application.asar`/`wrapper.node`/`package.json` 的签名清单；asar 载荷整体加密）→ 需要**未开源的 `dbghelp.dll`**（Telegram 分发）或 patch `QQNT.dll` | 仓库元数据 + 本地 asar 头解析（`app_launcher/index.js` 只有 80 字节密文） |
| **官方 README 自己警告**："QQ 安全中心可能会将 LiteLoaderQQNT 当作非法外挂工具并**下线您的设备**，还有可能**封禁您的账号**"；社区有被踢下线/社交限制的实例（#1032 219 评论，未装插件也复现） | 仓库 README + issue |
| 全生态 94 个插件，**没有一个**碰通话/通话状态/STT/声纹 | 官方 Plugin-List 逐个扫描 |

### 唯一真正做过"QQ 语音通话接 AI"的开源项目

**`ClaudiaGardner/maibot-qq-voice-call`**（GPL-3.0，已被 MaiBot 官方文档收录）——
和我们的架构几乎一样：**Hook QQ Loader → 另起一个 Electron 进程加载 `libAVSDKPlugin.so` 当 AV Host → 虚拟声卡（PulseAudio）→ 实时 ASR + LLM + 克隆 TTS 灌回麦克风 → 挂断后写回记忆**。

差别与结论：
- **Linux-only**（PulseAudio/PipeWire + `pactl/parec/xvfb-run`），Windows 要自己换 WASAPI 虚拟声卡 —— 而**这正是我们已经在跑的方案**；
- 它拿到的也是**混音**，同样没有逐人音轨；
- 作者自己标注"Loader Hook 与 AVSDK 属版本敏感集成"，QQ/NapCat 升级后要重跑安装脚本。

**所以：我们的路线=社区唯一可行路线的 Windows 版**；而"逐人音轨"在任何平台都**没有开源先例**（空白领域）。

### 现状（已落地）
- `useSpeaker=false`（默认）：`ASR_SPK=0`，连 CAM++ 都不加载；`src/app.js` 的 `voiceSenderName()` **一律返回「通话对方」**，删掉了"说话人1/2/3"的分支。
- 想重开：插件设置「声纹说话人分离」+ `ASR_SPK=1`（代码保留，但已知会过度分裂）。

---

## 十六、打断（barge-in）—— 2026-10-11 从占位做成真功能

**背景**：原来 `bargeIn=true` 只是"播放期也把转写直接送上去"，**并不会让小鲸鱼闭嘴**；关闭时又要等它说完（插话那句被攒住）。这次做成真正的打断。

### 难点：播放期的声音有两个来源，电平分不开

① 对方真的插话；② 我们自己的声音从对方手机外放绕回来（对方麦 → QQ → 回环端点）。
实测对方的回声**足以被 ASR 转写出"自己刚说过的话"**，所以单纯定个能量门限必然误判。

### 方案：停住 → 观察 → 定夺（`BargeProbe`）

```
播放中听到开口（300ms 滑窗里 160ms 有声）
   → 立刻停在当前音频块边界（对方听感 = 小鲸鱼马上闭嘴，≤200ms）
   → 观察期（≤4s）：
        · 能量还在（累计 900ms）  → 真人 → 清空待播队列 + 停播 + 丢掉上一轮残留回复
        · 安静下来（累计 800ms）  → 是回声 → 从断点接着播（管道里的 PCM 没丢）
        · 转写进来且不是自激回环  → 直接判真人（文本比能量更可信）
```

几个关键设计：
1. **暂停期间必须继续读 ffmpeg 管道**（攒进缓冲），否则 4 秒不读会把 ffmpeg 堵死、进而堵死 edge-tts。
2. **回声电平自适应**：判过一次"这是回声"就把 `echo_rms` 记下来，下次要 2× 这个电平才触发，
   再加 2 秒冷却 —— 否则对方外放时会"停一下、接着播、又停一下"地抖。
3. **打断后 1.6 秒丢弃窗**：插话发生时上一轮那句转写触发的 LLM 可能刚跑完，回复会在几百毫秒后
   到达；不拦就成了"用户刚插话，小鲸鱼又接着把旧话说下去"。用户插话自己触发的新回复至少
   1.3 秒后才到（LLM 1.2s + TTS 首块），所以这个窗口只吞残留、不误伤新回复。
4. **播出真正收尾前不再开新观察期**（真机踩坑：那几百毫秒里对方还在说，会重复触发）。

### 真机踩坑（都修了）

| 现象 | 根因 | 修法 |
|---|---|---|
| 打断**从来没触发过** | 原来是"连续 10 帧超门限"，门限定 1200；实测对方语音 RMS 大部分时间在 600-1500 之间抖（词间会掉下去），峰值 4497 但连续 10 帧 1200+ 凑不齐 | 改**滑窗计数**（300ms 里 160ms 有声）+ 门限降到 600（虚拟声卡空闲时 RMS≈0） |
| 打断成立后又吐一遍"回声/真人"判定 | 播放收尾有几百毫秒延迟，期间对方还在说话 → 又开一次观察期 | 等待新转写期间不再开新观察期 |

### 群里实测的第二轮问题（2026-10-11 晚，都已修）

用户进群通话实测后反馈两条：「音量偏大」「人多的时候它好像一直在等、不出声」。

**① TTS 音量偏大 → 加「说话音量」设置（默认 70%）**

- 设置项 `volume`（百分比，100 = 原始），真机实测 edge-tts 原始音量在 QQ 通话里偏吵，默认给到 **70**。
- 实现：`apply_volume()` 在写声卡前按倍数缩放（>1 削顶防爆音），`say_streamed()` / `play_pcm()` 都走它。
- **可热调**：音量是要反复试的参数，走 `--volume` 每改一次都得重启 worker（还要重载 ASR sidecar 十几秒）。
  所以插件把值写进 `data/voice-bridge-runtime.json`，worker **每次开口前现读**（`runtime_volume()`），
  设置页改完下一次开口就生效。文件缺失/写坏/值离谱一律回落启动参数。
- 真机验证：同一条语音按 100% 与 40% 各播一遍，从 CABLE Output 录回量 RMS —— **比值 0.400**（`tools/test_volume.py`）。

**② "一直在等、不出声" → 两个真问题**

| 问题 | 根因 | 修法 |
|---|---|---|
| **新回复被自己吞掉** | 打断后原本按"1.6 秒内的回复都算上一轮残留"丢弃。群里你一句我一句时，插话那句很短（"哎""等等"），转写很快就上去，它的回复约 1.3 秒后就到 —— 正好落进 1.6 秒窗口被丢掉 → 表现为"它一直不出声" | 改成按**轮次**判断：打断后必须先收到一句**新转写**，之后的回复才算这一轮的（`_await_new_turn`）。兜底 8 秒：一直没等到新转写（那段只是噪声）就不再压着 |
| **抢着说然后被砍** | 大家都在聊的时候，回复一到就立刻开口 → 立刻被插话打断 → 只吐出半个字，听感就是"它一直在等" | 开口前先等一个说话间隙（`_wait_for_gap`：最近 0.6 秒没人声才开口，最多等 8 秒）。此刻自己还没出声，所以回环端点上出现的只可能是对方 |

**关于"堆着的话怎么释放"**（用户问的）：其实**不堆积**。打断时 worker 会 `drain` 掉还没播的批次并丢弃上一轮残留回复 ——
这是标准打断语义（人被打断也不会接着把刚才那句说完），所以听感上就是"只回最后一条"。
新的一句话进来 → 立刻走一轮 LLM → 等一个间隙说出来。真正会"堆积"的只有转写队列（`seg_queue`，满了丢最旧），
那是防"转写比说话慢"的，与打断无关。

### 自测

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `tools/test_barge_in.py` | 状态机（不需要声卡）：真插话 / 自激回声 / 文本定夺 / 开关关闭 / 新回复不被吞 / 等间隙 | 22 项全过 |
| `tools/test_say_gate.py` | 流式播放门控：无 gate 播完、gate 返回 stop 就地停 | 全过（整句 10.95s，打断后 2.53s 停） |
| `tools/test_barge_live.py` | **真机**：往采集端点播合成语音假装"对方插话" | 全过 —— 开口 200ms 停住，观察 2.2s 判真人停播，整句 10s+ 只播了 4.8s |
| `tools/test_volume.py` | **真机**：100% vs 40% 从 CABLE Output 录回量 RMS + `runtime_volume` 兜底 | 全过（实测比值 0.400） |

真机日志（一次完整打断）：
```
播放中听到开口（rms=645，门限 600）→ 先停住看是不是回声
插话判定：停播后能量持续 900ms → 真人
插话成立 → 停播（停顿 2161ms）
这句被打断，剩下的不再播
```

### 开关与调参

| 设置 | 生效方式 |
|---|---|
| 允许打断（barge-in） | `--barge-in`（worker 启动参数）。关闭时 `gate=None`，行为与改造前逐字节一致 |
| 说话音量（%） | **热生效**：写 `data/voice-bridge-runtime.json`，worker 每次开口前现读，改完下一次开口就变 |
| 采集/播放端点、ASR 引擎等 | worker 启动参数，需重启 worker |

⚠️ **重启 worker 的可靠做法是「禁用再启用技能」**，不是等它自己重启。2026-10-11 实测踩坑：
插件被 reload 后，子进程 `exit` 回调仍是**旧模块实例**的闭包，它调用的 `startWorker()` 用的是旧的
参数拼装代码 —— 于是"杀掉 worker 让它自动重启"会得到一个**参数没更新**的新 worker
（日志里 `--volume` 就是不来）。禁用再启用走的是新模块的 `activate → boot → startWorker`，
参数才会按当前设置重新拼。

---

## 十七、语音里的"轮次"：不再排队念旧答案（2026-10-11 群里实测第三轮）

用户实测原话："只要不打断，它识别到的几条信息在转录好语音后，就会排队一步步输出来。
但这样可能会出现它回复的是比较早之前说的事情……大家叽里咕噜说了一大堆后安静了一会儿，
这时候才开始把要回复的都念出来。"

### 诊断：三个机制叠在一起

| 机制 | 位置 | 后果 |
|---|---|---|
| **逐句生成** | `orchestrator.scheduleWake` 通话聚批窗口 `callWakeDelayMs=200ms`（为 1v1 低延迟调的） | 群里 10 秒七嘴八舌 → 每句一轮 → **生成 4-6 批回复** |
| **串行播放** | worker `say_queue` + `_say_consumer` | 天然排队 |
| **开口门控** | worker `_wait_for_gap()`（十六节加的） | 热闹时每批都等 → 队列越积越长；一安静就**连着把旧答案念出来** |

**根因**：「什么时候说」跟着对话走了，但**「说什么」没跟着走** —— 内容还是那一刻生成的。
人类不会这样：想说的话过期了就不说了，或者开口前重新组织。

### 三个修法（用户选定 ②+③ 优先，再做 ①）

**② 热闹时把连续几句合成一轮**（`orchestrator.js` + `voice-bus.js`）

- `onIncoming` 里为通话记节奏（`#noteCallPace`：最近 10 秒的转写时刻）；
- 最近 10 秒 ≥3 句 = 热闹 → 聚批窗口从 `callWakeDelayMs`（200ms）切到
  `callWakeDelayBusyMs`（默认 1200ms）→ 连续几句进同一轮 → **只生成一条回复**，
  这条天然对应"最近这一段"，而且模型看到完整上下文，不会对半句话作答；
- 安静时仍用 200ms（1v1 的响应速度不变）。两个值都在插件设置里。

**③ 回复时效 + 门控降级**（`voice-bus.js` + worker）

- 总线在 `say` 里带上 `inputTs`（这批回复回应的是哪一刻的对话）；
- worker 播放前检查：超过 `replyMaxAgeSec`（默认 10 秒）就不念了，日志记一笔
  （`⏱ 回复已过期`）。老核心不给 `inputTs` 时一律不丢，绝不误杀；
- `_wait_for_gap` 从"**只要**有人在说就等（上限 8 秒）"降级为"**刚被打断过**
  （20 秒内）才等，上限 2.5 秒" —— 原来人一多就等于永远在等，正是"安静后集中念旧事"的推手。

**① 群通话降发言欲**（`orchestrator.js` + `prompt.js`）

- 插件设置「群通话降发言欲」（**默认关**）：三人以上闲聊时，没点名、没提问 → 允许它不出声；
- 实现：热闹 + 未点名 → ① 第 1 轮**不强制** `toolChoice=send_message`（否则等于逼它说点什么）；
  ② 系统提示**末尾**补一段"没人点名就直接 finish"（`CALL_GUIDE_QUIET_SECTION`，priority 1）；
- ⚠️ **为什么不默认开**：协议层拿不到"这通电话有几个人"。1v1 里对方讲一段三句话，
  「10 秒 ≥3 句」照样成立 → 默认识别成群聊会让它在**正常电话里装死**。所以必须手动标。
- ⚠️ 为什么补的那段放**末尾**（priority 1）而不是并进通话指引：通话指引在系统提示靠前位置，
  而"热闹/不热闹"每几轮翻一次 —— 并进去会让系统提示字节布局来回变，前缀缓存（token 大头）
  直接归零。实测安静版是基础版的**严格前缀**（首个不同处在 4662 = 基础版长度）。

### 生效方式

① ② 在 `src/`（核心），**必须重启 QQ Agent**（会掉线重登 QQ）；③ 的 worker 部分是 Python，重启 worker 即可。

---

## 十八、M2 通话记忆（2026-10-11 晚）

### 计划 vs 实际

| 阶段 | 原计划 | 实际 |
|---|---|---|
| M1 | 全链路 | ✅ 完成 |
| M2 | 门控、打断指令、音色、通话记忆 | 门控/打断**超额完成**（十六、十七节）；**通话记忆：本次做完**；**音色：等 emotionTTS** |
| M3 | 声纹库 + mc-voice profile + hotline WS source | 声纹已结案（十五节）；**M3 重定为「稳定性与可运维」** |

### 问题：通话和文字是两个会话

通话会话是 `call:private:<QQ号>`，文字私聊是 `private:<QQ号>` —— 消息各存各的、
记忆也各记各的（`data/memory/` 里根本没有 `call_*`）。用户的实际感受：
"文字里刚交代过的事，一打电话它就完全不知道"、"打完电话它也不记得"。

实测数据：通话转写**有落盘**（`data/messages/call_private_3248569738.json`，133 条 42KB），
但 `data/memory/` 里只有 `private_3248569738` 和两个群 → 通话内容从不进记忆。

### 修法一：通话中能看到刚聊过的私聊（`prompt.js`）

- `buildCallUserPrompt` 在【通话对方】之后补一段
  **【打电话之前，你们在文字里聊过】**：取 `private:<QQ号>` 的最近若干条；
- 默认 **1 小时内、最多 12 条**（`callPrompt.priorChat` 默认开、`callPrompt.priorChatMax` 可调）；
- 只走通话精简路径，群聊/私聊那条路径**逐字节不受影响**（自测里专门验了这一条）。

### 修法二：挂断后把这通电话压成摘要写进记忆（`src/call-memory.js`）

链路：`voiceBus.hangup()` → `onCallEnd({target, startedAt, reason})` →
`summarizeCall()` → `memory.append('private:<QQ号>', 'memberImpression', 摘要, { userId })`。

| 决策 | 取值 | 理由 |
|---|---|---|
| 写哪 | `private:<QQ号>`，**不是** `call:*` | 只有私聊的记忆会在文字聊天时被检索/渲染（`formatForPrompt`） |
| 写什么 | **只写摘要**（1-3 条，每条 ≤40 字） | 用户选的；以后它引用到的是"我们电话里聊过X"，不是逐字复述 |
| 多短不记 | <4 句跳过 | 试音、误触发的电话没什么可记 |
| 什么时候跑 | 挂断后**后台**跑（实测约 10 秒） | 不影响通话；失败只记日志 |

实测（真机一次完整链路，2026-10-11 21:2x）：
```
5 句转写 → 电话里聊到：可可周末可能要去杭州出差。；可可今晚加班到挺晚，还没吃饭准备点外卖。
```
写入 `private:3248569738` 的 `3248569738.json`（memberImpression）。

### 真机踩坑（两个，都值得记）

1. **`chatCompletionWithRetry` 的返回形状不是 OpenAI 原样**：
   它是 `{ message, finishReason, usage, model, raw }`，**没有**顶层 `choices`。
   我按 `res.choices[0].message.content` 取值 → 永远拿到空字符串 → 每次归档都"静默成功跳过"。
   （离线自测用的假返回值也照着错的形状写，所以**离线全绿、真机全空** —— 这个教训是：
   替身要照**真实签名**写，否则测试只证明"我实现了自己的误会"。）
2. **思考模型会把 max_tokens 吃在推理上**：`maxTokens: 220` 时
   `finishReason=length`、`content` 全空（220 token 全花在思考），摘要被静默丢掉；
   700 时长转写仍不够；**1500 稳定**。并且现在把这种情况单独记成 `truncated`（可诊断），
   不再和"本来就没什么可记"混为一谈。

### 开关

| 设置 | 位置 | 生效 |
|---|---|---|
| 通话结束写进记忆（摘要） | 插件设置 `callSummary`（默认开） | 走总线 profile，**热生效** |
| 通话中带私聊上下文 | 核心配置 `callPrompt.priorChat` / `priorChatMax` | 下次重启后生效 |

⚠️ 这两个功能都在 `src/`（核心）→ **需要重启 QQ Agent**。已和 emotionTTS 一起排在同一次重启里。

---

## 十九、可插拔 TTS 后端（换音色不用改代码）—— 2026-10-11 晚

**动机**：要给机器人换音色（音色克隆类云端 API / 本地角色模型）。这类服务商接口五花八门，
但"接进来"的工程部分是**一样的** —— 所以先把跟服务商无关的那半边做好，选定服务后只需填一份 JSON。

### 结构

```
data/voice-bridge-tts.json   ← worker 每句开口前现读（改完下一句就生效，不用重启）
{
  "engine": "edge" | "http",
  "url": "https://.../v1/tts",        // http 用
  "method": "POST",
  "headers": { "Authorization": "Bearer sk-..." },
  "body": "{\"text\":\"{text}\",\"voice\":\"{voice}\"}",   // {text}/{voice} 占位，自动做 JSON 转义
  "audioField": "",                    // 留空=响应体就是音频；填 "data.audio"=从 JSON 里取 base64
  "voice": "音色 id",
  "fallback": "edge"
}
```

- `engine=http` 走 **aiohttp 流式**（chunked 响应边收边喂 ffmpeg），所以服务商的流式能力
  能被完整利用；一次读完的接口（base64 字段）也支持。
- **韧性两条**（都有自测）：
  1. 云端连不上 → 整句**退回 edge-tts**，这通电话不会哑；
  2. 云端**吐了一半才断** → **不**退回（两段音频接在一起会变成两个声音），本句报失败。
- 为什么走文件而不是启动参数：换音色是**反复试**的事，每次重启 worker 都要重载
  ASR sidecar（十几秒），根本没法试。跟音量（`runtime_volume`）同一套思路。

### 配套工具（`E:\QQRobot\tools\`，不在 git 仓库里）

| 工具 | 作用 |
|---|---|
| `set_tts.py` | 写配置 / `--show` 看当前 / `--try "你好"` **试听**（不用打电话就能听效果） |
| `test_tts_latency.py` | **首包延迟测量**：`--runs N`，含一个**不依赖外网**的本地假服务（`--stub`）验证 http 后端 |
| `test_tts_fallback.py` | 韧性：连不上要回退、吐一半不能回退 |

### 基准数（2026-10-11 实测，同一台机器同一个网络）

| 后端 | 首包延迟（中位） | 说明 |
|---|---|---|
| edge-tts（现状） | **1346ms**（1058-2534ms，3 次） | 免费、零配置，但**是当前"首字延迟"的地板** |
| 本地假服务（http 流式） | 422ms | 验证链路本身没有额外开销（假服务固定 300ms 延迟） |
| 本地假服务（JSON+base64） | 532ms | 一次性读完的接口会慢一点（要等整个响应） |

**结论**：换音色的硬指标是**首包 ≤ 1500ms**（否则通话听感明显变钝）；流式接口优先。
另外实测踩到 edge-tts 的 Bing 端点**返回过一次 503**（`WSServerHandshakeError`）——
免费服务的可用性没有保证，这也是"要有个能回退的后端"的现实理由。

---

## 二十、音色落地：本地千早爱音（GSV-TTS-Lite + 你训练的 V2 模型）—— 2026-10-11 深夜

**结果**：小鲸鱼现在用**爱音的声音说中文**，首包延迟从 edge-tts 的 **1346ms** 降到 **中位 350ms**，
显存多占 **1.4GB**（+SenseVoice 1.1GB = 2.5GB / 8GB）。

### 音色包（`E:\QQRobot\爱音`）

| 文件 | 作用 |
|---|---|
| `千早爱音V2-e30.ckpt`（148MB） | **GPT** 权重（韵律/语气） |
| `千早爱音V2_e20_s460.pth`（81MB） | **SoVITS** 权重（音色） |
| `AnonV2/`（89 个 wav，32kHz 单声道，5-8 秒） | 参考音频 |
| `AnonV2.list`（90 行） | **带官方日文台词的转写** —— 正好是 GPT-SoVITS 的 `prompt_audio_text` |

⚠️ 这是 **V2** 模型（能用！）。之前调研里提到 B站那个 MYGO 包是 **V4**，V4 **没有真流式**
（源码原话"SoVits V3/4模型不支持流式推理模式，已自动回退到分段返回模式"）——两者别搞混。

**跨语言**：GPT-SoVITS 把音色（SoVITS 权重）和语言（`text_language`）解耦，所以
**日语训练的爱音模型说中文完全正常**：`text_language='zh'` + 参考音频的 `prompt_language='ja'`。

### 实测（都在本机 4060 Laptop，`tools/bench_anon_real.py`）

| 场景 | 首包 | 说明 |
|---|---|---|
| **新句子**（机器人的真实情况） | **中位 350ms**（145-611） | 8 句各说一遍 |
| 重复同一句 | 中位 143ms | 说明有文本级缓存，别拿这个数当体验 |
| 整句合成总时长 | 320-896ms | RTF ≈ 0.1 |
| 对比 edge-tts | 1346ms | 快约 **4 倍** |
| 显存 | 1.08GB 常驻 / 1.33GB 峰值 | |
| 冷启动 | **10-18 秒**（模型加载 + 8 种长度预热） | 所以必须常驻 |

### 三个踩坑（都值一顿饭）

1. **`boost_first_chunk=True` 是个陷阱**（名字骗人）：参数扫描（`tools/_sweep_gsv.py`）
   显示 chunk=25 + boost=True 时**短句首包 605ms**，boost=False 只要 191ms；
   chunk=12 + boost=False → 最稳（128-141ms/首块 0.38s）。默认值是 True，**必须手动关**。
2. **推理必须固定在同一条线程上**：实测（`tools/_probe_thread.py`）主线程首包 133ms，
   换一条**新线程**第一次要 557ms（第二次才 110ms）—— 每条新线程都要付一次 ~450ms 的
   CUDA Graph / stream 初始化代价。而 `ThreadingHTTPServer` 是**每个请求开一条新线程**，
   于是每个请求都在付这笔钱 → 服务稳定卡在 540ms。
   **对策：单条常驻推理线程 + 队列**，HTTP 线程只转发（流式照样成立）→ 146ms。
3. **预热要覆盖多种句长**：捕获代价跟文本长度相关，只热一句短的，第一通电话里
   每冒出一个新句长就卡一下。现在启动时跑 8 种长度（4~40 字）预热，约 8 秒。

### 架构（复用了十九节的可插拔后端，worker 侧零改动）

```
gsv_service.py（常驻，独立 venv）  ←HTTP(GET, 裸 PCM 32k 单声道)—  声桥 worker
   千早爱音 V2 模型 + 单推理线程         inputFormat: s16le/32000/1     ffmpeg → CABLE
```

| 设置 | 值 |
|---|---|
| `ttsEngine` | `anon`（本地爱音）/ `edge`（云端兜底） |
| `ttsServicePython` | `E:\QQRobot\voice-engines\gsv-lite\Scripts\python.exe`（独立 venv，**没动 SenseVoice 那个**） |
| `ttsServiceScript` | `E:\QQRobot\voice-engines\gsv_service.py` |
| `ttsServicePort` | 9880 |

插件负责拉起/看护这个服务（pid 文件 + 掉线 8 秒重拉 + 禁用时一起停）；
`data/voice-bridge-tts.json` 由插件按设置生成，worker 每句现读。
**本地服务挂了会自动退回 edge-tts**，通话不会哑。

试听：`python tools/demo_anon.py` → `tools/爱音试听.mp3`。

---

## 二十一、切段与延迟二次排障：不再被"嗯。"和"4的。"带着跑（2026-10-12）

### 起因（真机反馈）

> "语音的回复慢了很多，而且识别那一块很容易识别到噪声和听不完全话，
> 比如这次通话的什么'嗯。'还有'4的'，都是没听全的。"

### 一、实测账本（先量再改，13:10–13:33 三通电话）

| 环节 | 今天 | 昨天（同链路） | 结论 |
|---|---|---|---|
| ASR | 90–220ms | 同 | 不慢 |
| **LLM round1** | 1255–6846ms，中位 **1.9s**、p90 3.6s | 944–2433ms，中位 1.7s | **延迟主导项，且抖动变大** |
| 聚批等待 | 200ms（1200ms 今天没触发） | 同 | 无变化 |
| TTS 首包 | 345–894ms | 250–870ms | **没退化**，但高于空闲态 |
| `promptChars` | 12139–12359 | 12257–12352 | **没变大 → M2 通话记忆不是元凶** |
| 首字延迟 | 1.5–7.1s，中位 2.6s | 中位 1.9s | 差的 0.7s 全在 LLM |

> 记一笔方法论：**"感觉慢"要拆成 ASR/LLM/TTS 三段看**（`data/logs/*.log` 的
> `round1 llm=` 与 `首字延迟`、`voice-bridge-debug.log` 的 `[gsv] 首包`）。
> 这次拆完才发现该修的是 LLM 抖动 + 碎片轮次，不是 TTS。

### 二、切段的三个病根（`plugins/voice-bridge/voice_worker.py`）

日志原文：`转写(0.22s): 后期。` / `转写(0.09s EMO_UNKNOWN): 嗯。` / `转写(0.22s): 4的。`

1. **「最短语音」判据形同虚设**：段缓冲 = 前滚 300ms + 语音帧 + 挂起期 700ms 静音，
   所以哪怕只有 **1 帧（20ms）**越线，段长也有 ~1.02s > 老门槛 400ms →
   键盘、碰桌面这种脉冲被当成"一句话"（「嗯。」就是这么来的）。
   → 现在按**真正超阈值的帧数**算语音时长（`VAD_MIN_SPEECH_MS=320`）。
2. **挂起期固定 700ms**：口语里 0.7–1.5s 停顿极常见 → 一句被切成 2–3 段，
   每段各触发一轮 2–3 秒的 LLM 回合（三段三答）。
   → **短段**（<1.2s 语音）挂起拉到 1100ms，长句不变（`VAD_HANGOVER_SHORT_MS`）。
3. **单阈值 + 不裁剪**：`floor_min=200` 太灵；送给 ASR 的段还带着 700ms 尾静音。
   → 起段 400 / 续段 200 **双阈值滞回**；段首尾裁到 160ms/240ms；
   噪声底上限 1200 → **600**（实测人声 600–7600，"噪声底"高过 600 只可能是被人声污染）。

### 三、碎句合并 + 语气词过滤（同文件）

- **纯语气词**（`嗯/哦/啊/呃/诶/喂/哈…` + 标点，且语音 <0.9s）→ 直接丢，不占一轮对话。
- **≤5 字的碎句** → 先攒 1.2s（`MERGE_WINDOW_S`），窗口内又来一段就拼成一句发；
  攒满 3 段直接发。**>5 字的正常口语零额外延迟**。
- 挂断/新通话清理攒着的碎句。
- 离线自测：`tools/test_vad_segments.py`（9 项）、`tools/test_segment_merge.py`（16 项）。

### 四、诊断落盘（默认关）

`VOICE_DUMP_SEGMENTS=1` → 每段音频写到 `data/voice-debug/`（含被丢的），
用于事后拿**真音频**离线复跑 ASR 定位「4的」这类疑似误识，而不是靠猜。
滚动上限 400 个文件。

### 五、GPU 保活：实测**不成立**（负结果，别重复踩）

假设是"通话中间隔几秒 GPU 降频 → 首包 150ms 变 800ms"。做了保活（服务空闲时每 3 秒
跑一次 1 字推理）并用 `tools/bench_keepwarm.py` 对照：

```
空闲 20s 后首包 374ms / 再静置 15s 397ms
保活态首包 333ms / 378ms        → 只快 30ms（8%）
```

结论：**不启用**（机制留在 `GET /warm?on=1`，worker 侧由 `VOICE_TTS_KEEPWARM=1` 才开）。
通话里 TTS 首包的 350–900ms 波动另有来源（并发/排队），不是时钟。

### 六、延迟埋点（下次重启应用后生效）

通话首轮日志现在会多打三行，用来决定"砍哪一段"：

```
voice-latency prompt 分节：sys=… user=… | 人设=… 打电话之前=… 刚才的对话=… 这一句=…
voice-latency 系统提示分节：核心 身份=… 安全规则=… 工具协议=… …
voice-latency 系统提示分节：技能段 trendy-memes=… sticker-librarian=…
voice-latency round1 llm=…ms toolsSchemaChars=…
```

改 `src/**` 需要**重启应用**（→ 重登便携 QQ）；`prompt.js` 的系统提示改造已按
**逐字节等价**重排并回归（`tools/test_call_memory.mjs` 19 项 + 独立导入对拍 4662 字符），
前缀缓存不受影响。

### 七、待办（本轮没做完的部分）

- 拿到分节数据后按实测砍提示词（预期最大头是"通话里还用不到的核心规则段"，
  工具白名单只剩 `send_message/finish`，表情/记忆/引用类规则在电话里用不上）。
- 首字延迟的验收线：**p50 ≤ 2.0s、p90 ≤ 3.0s**；碎片轮次归零。

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

### B.1 插件私有仓库（2026-10-11 建）

`plugins/` 与 `skills/` 被 `.gitignore` 排除，等于**完全没有版本管理**（改坏了没法回滚）。
2026-10-11 给 `plugins/` 建了私有仓库：

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/Dragonzhi/qq-agent-plugins （**private**） |
| 工作区 | 仍是 `E:\QQRobot\QQ-agent\plugins\`（应用路径不变） |
| 对象库 | `E:\QQRobot\qq-agent-plugins.git\`（**在应用目录之外**） |
| 首个快照 | `3a2dc02`，20 个插件 / 99 个文件 |

⚠️ **为什么不用普通的 `git init`**：插件热重载是 `fs.watch(plugins/, { recursive: true })`
（`src/plugin-loader.js`），**这个目录里任何文件变动都会触发一次插件重载**。`.git/` 一旦放进来，
每次 `add/commit/gc` 都会刷出一轮重载（历史上就是这个坑刷出过 1753 次 spawn）。所以用：

```powershell
git init --separate-git-dir=E:\QQRobot\qq-agent-plugins.git -b main E:\QQRobot\QQ-agent\plugins
git -C E:\QQRobot\QQ-agent\plugins remote add origin https://github.com/Dragonzhi/qq-agent-plugins.git
git -C E:\QQRobot\QQ-agent\plugins push -u origin main
```

`plugins/.git` 因此只是一个 **40 字节的文件**（`gitdir: E:/QQRobot/qq-agent-plugins.git`），
不是目录 —— 插件加载只扫目录，不会把它当插件。

日常照常在 `plugins/` 里 `git status/add/commit/push` 即可（git 顺着那个文件找对象库）。

`skills/` **刻意不建仓库**：那里是从技能市场正常安装的第三方技能，不是本仓库的作品，
重装后按市场列表装回来即可（见 `.gitignore` 里的同名说明）。

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
