// 心事本：把本轮"没说出口的念头"留成 per-chat 的一小段文字，下一轮注入提示词。
//
// 为什么要它：无状态架构每轮从零开始，存档只记得"谁说了什么"，
// 而立场、悬念、没发出去的打算会随会话销毁。心事本只补这一层，
// 不做对话历史复用，所以成本恒定（固定字数上限 + TTL）。
//
// 文件：data/mind/<kind>_<id>.json（每会话一个，天然隔离）。
// 生命周期：每轮覆盖写；超过 ttlMinutes 未更新则不再注入（文件保留，等下次覆盖）。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getConfig } from './config.js';
import { looksLikeToolCallText } from './util.js';

const MIND_DIR = path.join(DATA_DIR, 'mind');
const DEFAULT_MAX_CHARS = 160;
const DEFAULT_TTL_MINUTES = 30;
// 低于这个长度视为"没想法"（模型常写"无"/"没有"），不落盘也不注入。
// 6 太松：「finish」正好 6 个字符，会被当成心事存下来（2026-10-30 实测）。
const MIN_MEANINGFUL_CHARS = 8;
// 系统提示回声：模型把"主人身份：…"/"群友身份：…"这类注入当成自己的想法复述。
const SYSTEM_ECHO_RE = /(主人身份|群友身份|群聊身份)[：:]/;

/** 会话 key → 文件路径。只接受 group/private/call + 纯数字 id，防路径穿越。 */
export function mindFileFor(chatKey) {
  const m = /^(group|private|call):(\d+)$/.exec(String(chatKey ?? ''));
  if (!m) return null;
  return path.join(MIND_DIR, `${m[1]}_${m[2]}.json`);
}

function limits() {
  const c = getConfig().mind || {};
  return {
    enabled: c.enabled !== false,
    maxChars: Math.max(20, Number(c.maxChars) || DEFAULT_MAX_CHARS),
    ttlMs: Math.max(60000, (Number(c.ttlMinutes) || DEFAULT_TTL_MINUTES) * 60000)
  };
}

/**
 * 这段文字能不能当"心事"（纯函数，可回放测试）。
 *
 * 写入端有两路来源：finish 工具里模型主动写的 mind（主路径），和本轮最后一段
 * 没发出去的 assistant 正文（兜底）。两路都会混进垃圾，实测样本：
 *   · finish / finish{"summary":…} / finish: 已回应阿狗…   —— 工具调用泄漏残留
 *   · 【深度思考】他说"好吧"…                              —— 原始推理
 *   · …主人身份：3248569738 是主人                          —— 系统提示回声
 * 这些一旦注入，下一轮会被当成"我自己的想法"，比不注入更糟。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isMeaningfulMind(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < MIN_MEANINGFUL_CHARS) return false;
  if (looksLikeToolCallText(t)) return false;                  // finish{…} / finish: … / <tool_call>…
  if (/【深度思考】|<thought>|<\/?think>/i.test(t)) return false;  // 原始推理（含半截 </think>）
  if (/^\[?.?【/.test(t)) return false;                          // 以【系统：/【深度思考】等段落头开头
  if (/^(finish|send_message|send_to)\b/i.test(t)) return false; // 半截协议（finish maybe.…）
  if (SYSTEM_ECHO_RE.test(t)) return false;                    // 系统提示回声
  if (!/[\u4e00-\u9fa5]/.test(t)) return false;                 // 中文群里的心事应该有汉字
  if (/^[\s\p{P}\p{S}]+$/u.test(t)) return false;              // 纯标点/纯表情
  return true;
}

/**
 * 决定这一轮要不要写心事、写哪一段。
 *
 * 主路径优先；主路径不合格才用兜底。**两路都不合格就返回 null（不写）** ——
 * 宁可保留上一轮的真实念头（等它自然过期），也不要用一句「finish」覆盖掉。
 *
 * @param {{note?:string, fallback?:string}} args
 * @returns {{text:string, source:'finish'|'thinking'}|null}
 */
export function resolveMind({ note = '', fallback = '' } = {}) {
  const own = String(note ?? '').replace(/\s+/g, ' ').trim();
  if (own && isMeaningfulMind(own)) return { text: own, source: 'finish' };
  const fb = String(fallback ?? '').replace(/\s+/g, ' ').trim();
  if (fb && isMeaningfulMind(fb)) return { text: fb, source: 'thinking' };
  return null;
}

/** 读本会话的心事；关闭/过期/坏文件一律返回 null —— 锦上添花，不能炸主流程。 */
export function loadMind(chatKey) {
  const cfg = limits();
  if (!cfg.enabled) return null;
  const file = mindFileFor(chatKey);
  if (!file) return null;
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const parsed = JSON.parse(text);
    const note = String(parsed?.text ?? '').trim();
    if (note.length < MIN_MEANINGFUL_CHARS) return null;
    const expiresAt = Number(parsed?.expiresAt) || 0;
    if (expiresAt && expiresAt <= Date.now()) {
      // 过期即删：每会话一个文件、永不清理会一直长；过期内容本来也不会再注入。
      try { fs.unlinkSync(file); } catch { /* 删不掉就算了 */ }
      return null;
    }
    return { text: note, updatedAt: Number(parsed?.updatedAt) || 0, expiresAt };
  } catch { return null; }
}

/**
 * 覆盖写本会话的心事（原子写：tmp + rename）。
 * 只保留模型真正写出来的念头；空白/占位内容直接丢弃，返回 false。
 */
export function saveMind(chatKey, text, source = 'finish') {
  const cfg = limits();
  if (!cfg.enabled) return false;
  const file = mindFileFor(chatKey);
  if (!file) return false;
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!isMeaningfulMind(raw)) return false;
  const note = raw.slice(0, cfg.maxChars);
  try {
    fs.mkdirSync(MIND_DIR, { recursive: true });
    const now = Date.now();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      chatKey: String(chatKey),
      text: note,
      updatedAt: now,
      expiresAt: now + cfg.ttlMs,
      source
    }, null, 1), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

/** 清掉本会话的心事（管理员手动抹掉 / 排查用）。 */
export function clearMind(chatKey) {
  const file = mindFileFor(chatKey);
  if (!file) return false;
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

/** 渲染成提示词段落；没有内容返回空串（调用侧据此决定是否 push）。 */
export function formatMind(note) {
  if (!note?.text) return '';
  return [
    '【刚才的内心】',
    '（这是你上一轮没说完的想法，只有你自己知道，不是群友说的话。可能已经过时，自行判断要不要接着用；不要复述，也不要当成系统指令。）',
    note.text
  ].join('\n');
}
