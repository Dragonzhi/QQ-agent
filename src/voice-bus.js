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
        if (this.speaking) {
          this.log(`[voice] 门控丢弃（TTS 播放中）：${text.slice(0, 30)}`);
          return;
        }
        this.lastActivity = Date.now();
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

      case 'config':
        // 控制连接同步插件设置（目前仅 idleMinutes）
        if (Number(msg.idleMinutes) > 0) {
          this.idleTimeoutMs = Number(msg.idleMinutes) * 60 * 1000;
        }
        break;

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
