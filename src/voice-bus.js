// VoiceBus 语音桥传输层 —— 与 OneBot 平级的第二条传输通道。
//
// 形态：WS 服务端（默认 127.0.0.1:3211，仅本机）。两类客户端连入：
//   · Python worker（plugins/voice-bridge/voice_worker.py）：音频采集/VAD/ASR/TTS/播放
//   · 插件控制连接（voice-bridge/index.js）：接听/挂断/状态
//
// 上行：worker 的转写文本 → onTranscript 回调（app.js 合成入站消息进会话，
//       chatKey = call:private:<target>，1v1 全接——见 orchestrator 的 isPrivate 补丁）。
// 下行：sender 拦截 call:* 会话 → say() → worker TTS 播放回通话。
//
// 附带三个通话语义：
//   · 门控：TTS 播放期间上行转写被丢弃（它说话时不听，防自激）
//   · 空闲自动挂断：capturing 且 N 分钟无活动 → 自动停
//   · 语音口令挂断：转写命中「挂断/先挂了」等 → 自动停
import { WebSocketServer } from 'ws';

/** 语音口令挂断（保守词表：正常人聊天不会误触） */
const HANGUP_RE = /(挂断|挂了吧|先挂了|挂电话|不用打电话了)/;

/**
 * 通话档（profile）白名单：插件设置界面 → 控制连接 `config` 消息 → orchestrator。
 *
 * 只收这里列出的键（不认识的键直接丢，防止前端塞垃圾字段进总线状态），
 * 值类型按表归一（string 去首尾空格、boolean 取真值、number 只认有限数字）。
 * 语义：callModel / callProviderId 为空串 = 用主模型 / 主 provider（归一后仍是空串，
 * 判空交给 orchestrator，总线不做业务判断）。
 */
const PROFILE_COERCERS = {
  callModel: (v) => String(v ?? '').trim(),          // 空 = 主模型
  callProviderId: (v) => String(v ?? '').trim(),     // 空 = 主 provider
  slimPrompt: (v) => Boolean(v),                     // 默认 true（由插件默认值给出）
  callMaxRounds: (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined),
  callWakeDelayMs: (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined),
  bargeIn: (v) => Boolean(v)                         // 默认 false
};

/** 归一 profile 补丁：undefined 的键跳过，认识的键按类型收。 */
function normalizeProfile(patch = {}) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const [key, coerce] of Object.entries(PROFILE_COERCERS)) {
    if (patch[key] === undefined) continue;
    const value = coerce(patch[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export class VoiceBus {
  /**
   * @param {object} opts
   * @param {number} [opts.port] WS 端口，默认 3211
   * @param {number} [opts.idleMinutes] 空闲自动挂断分钟数，默认 15
   * @param {(...a:any[])=>void} [opts.log]
   * @param {(...a:any[])=>void} [opts.warn]
   */
  constructor({ port = 3211, idleMinutes = 15, log = () => {}, warn = () => {} } = {}) {
    this.port = port;
    this.idleTimeoutMs = Math.max(1, Number(idleMinutes) || 15) * 60 * 1000;
    this.log = log;
    this.warn = warn;

    this.wss = null;
    this.worker = null;          // worker 连接（转写/播放的载体）
    this.controls = new Set();   // 插件控制连接
    this.ready = false;          // worker 已连入且 hello 完成
    this.target = '';            // 1v1 绑定的对方 QQ 号（worker hello 带来）
    this.speaking = false;       // TTS 播放中 → 门控生效
    this.capturing = false;      // 是否正在采集（通话中）
    this.lastActivity = Date.now();

    /** 上行转写回调：(text:string) => void，由 app.js 注入 ingestVoiceMessage */
    this.onTranscript = null;
    /** 状态变化回调：() => void */
    this.onStateChange = null;
    /**
     * 通话档：插件设置界面里那些"通话专用"的参数（callModel/slimPrompt/...）。
     * 控制连接发来 config 消息时按白名单增量并入；orchestrator 每次通话读它。
     */
    this.profile = {};
    /** 通话档变化回调：(profile:object, ws:WebSocket) => void，由 app.js 转发给 orchestrator */
    this.onProfile = null;

    this._idleTimer = null;
    this._saySeq = 0;
  }

  start() {
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });
    this.wss.on('connection', (ws, req) => {
      const role = new URL(req.url || '/', 'http://x').searchParams.get('role') || 'worker';
      if (role === 'control') {
        this.controls.add(ws);
        ws.on('close', () => this.controls.delete(ws));
      } else {
        if (this.worker && this.worker.readyState === 1) {
          // 已有 worker：拒绝新来的。以前是「踢掉旧的」，但旧 worker 3 秒后重连
          // 又把新的踢掉——两个进程乒乓重连。让新来的收到 bye 自行退出更干净
          // （worker 侧收到 bye 就 os._exit，不回重连）。
          this.warn('[voice] 已有 worker 在线，拒绝重复连接');
          try { ws.send(JSON.stringify({ type: 'bye', reason: '已有 worker 在线' })); } catch { /* 忽略 */ }
          setTimeout(() => { try { ws.close(); } catch { /* 忽略 */ } }, 300).unref?.();
          return;
        }
        this.worker = ws;
        this.log('[voice] worker 已连接');
      }
      ws.on('message', (raw) => this.#onMessage(ws, raw));
      ws.on('error', () => { /* 连接错误不打断总线 */ });
      ws.on('close', () => {
        if (this.worker === ws) {
          this.worker = null;
          this.ready = false;
          this.speaking = false;
          this.capturing = false;
          this.log('[voice] worker 断开');
          this.#broadcastState();
        }
      });
    });
    this.wss.on('error', (e) => this.warn(`[voice] WS 服务端错误: ${e.message}`));
    this._idleTimer = setInterval(() => this.#checkIdle(), 30000);
    this._idleTimer.unref?.();
    this.log(`[voice] 总线已启动 ws://127.0.0.1:${this.port}`);
  }

  stop() {
    if (this._idleTimer) clearInterval(this._idleTimer);
    try { this.wss?.close(); } catch { /* 已经关了 */ }
  }

  // ── 内部：消息分发 ─────────────────────────────────────────────

  #onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    switch (msg?.type) {
      case 'hello':
        // 只认 worker 角色的 hello
        if (ws !== this.worker) return;
        this.ready = true;
        this.target = String(msg.target || '').trim();
        this.capturing = !!msg.capturing;
        this.log(`[voice] worker 就绪：target=${this.target || '(未绑定)'} 采集=${msg.devices?.capture || '?'} 播放=${msg.devices?.playback || '?'}`);
        this.#broadcastState();
        break;

      case 'transcript': {
        if (ws !== this.worker) return;
        const text = String(msg.text || '').trim();
        if (!text) return;
        // 播放期默认门控（防自激）；插件设置里开了「允许打断」就放行
        if (this.speaking && this.profile?.bargeIn !== true) {
          this.log(`[voice] 门控丢弃（TTS 播放中）：${text.slice(0, 30)}`);
          return;
        }
        this.lastActivity = Date.now();
        this._turnT0 = Date.now();   // 首字延迟起点：转写进来 = 模型开始跑
        this._turnN = (this._turnN || 0) + 1;   // 期间注入了 N 句（>1 时下面的数字是下限）
        if (HANGUP_RE.test(text)) {
          this.hangup('语音口令');
          return;
        }
        try { this.onTranscript?.(text); } catch (e) { this.warn(`[voice] 转写处理出错: ${e?.message ?? e}`); }
        break;
      }

      case 'played':
        // worker 播完一批 → 开门
        if (ws === this.worker) this.speaking = false;
        break;

      case 'play-start':
        // 首字延迟真值：转写进来 → 第一段音频开始播（含 LLM 全部轮次 + TTS）
        if (ws === this.worker && this._turnT0) {
          const n = this._turnN || 1;
          this.log(`[voice] 首字延迟 ${Date.now() - this._turnT0}ms（转写→第一段开口`
            + `${n > 1 ? `；期间又注入了 ${n - 1} 句，此数为下限` : ''}）`);
          this._turnT0 = 0;
          this._turnN = 0;
        }
        break;

      case 'status':
        if (ws === this.worker) {
          this.capturing = !!msg.capturing;
          if (msg.capturing) this.lastActivity = Date.now();
          this.#broadcastState();
        }
        break;

      // 控制连接（插件）指令：与 worker 共用一套指令集
      case 'capture':
        this.capturing = !!msg.on;
        if (this.capturing) this.lastActivity = Date.now();
        this.#sendToWorker({ type: 'capture', on: this.capturing });
        this.log(`[voice] 采集${this.capturing ? '开始' : '停止'}`);
        this.#broadcastState();
        break;

      case 'hangup':
        this.hangup(msg.reason || '控制端');
        break;

      case 'config': {
        // 控制连接同步插件设置：idleMinutes 保持原行为（只认正数），
        // 其余通话档键按白名单并入 this.profile。插件 reload 后会重复发同一条
        // config —— 这里是幂等覆盖，重复收到结果不变。
        if (Number(msg.idleMinutes) > 0) {
          this.idleTimeoutMs = Number(msg.idleMinutes) * 60 * 1000;
        }
        const patch = normalizeProfile(msg);
        if (Object.keys(patch).length) this.profile = { ...this.profile, ...patch };
        try { this.onProfile?.(this.profile, ws); } catch (e) { this.warn(`[voice] profile 转发出错: ${e?.message ?? e}`); }
        break;
      }

      default:
        break;
    }
  }

  #sendToWorker(obj) {
    if (this.worker?.readyState === 1) {
      try { this.worker.send(JSON.stringify(obj)); } catch { /* 发送失败下一轮重连即可 */ }
    }
  }

  #broadcastState() {
    const payload = JSON.stringify({ type: 'bus-state', ...this.state });
    for (const c of this.controls) {
      if (c.readyState === 1) { try { c.send(payload); } catch { /* 忽略 */ } }
    }
    try { this.onStateChange?.(); } catch { /* 忽略 */ }
  }

  // ── 下行：sender 拦截 call:* 会话时调用 ─────────────────────────

  /**
   * 把一批回复文本交给 worker 播放。
   * @returns {{sent:Array,failed:Array}} 与 SendQueue.sendTextBatch 同构
   */
  say(chatKey, messages) {
    const texts = (Array.isArray(messages) ? messages : [messages])
      .map((t) => String(t ?? ''))
      .filter((t) => t.trim());
    if (!texts.length) return { sent: [], failed: [] };
    if (!this.ready) {
      return { sent: [], failed: texts.map((text) => ({ text, error: '语音桥未连接（worker 不在线）' })) };
    }
    this.speaking = true;   // 门控：播放期间不上行
    this.lastActivity = Date.now();
    this._saySeq += 1;
    this.#sendToWorker({ type: 'say', id: this._saySeq, texts });
    return { sent: texts.map((text) => ({ text, messageId: null, at: Date.now() })), failed: [] };
  }

  // ── 通话控制 ──────────────────────────────────────────────────

  startCapture() {
    if (!this.ready) return false;
    this.capturing = true;
    this.lastActivity = Date.now();
    this.#sendToWorker({ type: 'capture', on: true });
    this.log('[voice] 接听：开始采集');
    this.#broadcastState();
    return true;
  }

  stopCapture() {
    this.capturing = false;
    this.#sendToWorker({ type: 'capture', on: false });
    this.#broadcastState();
  }

  hangup(reason = '手动') {
    const wasCapturing = this.capturing;
    this.stopCapture();
    if (wasCapturing) this.log(`[voice] 挂断（${reason}）`);
  }

  #checkIdle() {
    if (!this.capturing) return;
    if (Date.now() - this.lastActivity > this.idleTimeoutMs) {
      this.hangup(`空闲 ${Math.round(this.idleTimeoutMs / 60000)} 分钟`);
    }
  }

  get state() {
    return {
      ready: this.ready,
      capturing: this.capturing,
      speaking: this.speaking,
      target: this.target,
      workerConnected: Boolean(this.worker)
    };
  }
}
