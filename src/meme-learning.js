// 群梗学习增强（doc/plans/meme-learning-upgrade.md）：
//   ① 频次信号 —— 群梗候选要"在群里真实出现 N 次"才成立，并记录证据消息 id；
//   ② 未知词观察表 —— 群里反复出现但梗库没有的说法，被提及时提示模型去查。
//
// 设计来源是 MaiBot 的 learners/（jargon_miner 的频次阈值与证据消息引用、
// jargon_context_matcher 的"提到才召回"），只借设计不借代码（对方 GPL-3.0）。
//
// 本模块只放纯函数 + 观察表文件读写，不依赖 LLM/网络，方便单测。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

// 新候选：当天非 self 消息里至少出现这么多次（低于它 = 一次性玩笑，不像"反复在用"）
export const MIN_DAY_OCCURRENCES = 3;
// 渐进修正阈值：pending 条目累计次数越过这些值时，允许模型结合更多上下文重写含义。
// 只对 pending 生效 —— active 是人工审定过的解释，不能被夜间任务悄悄改掉。
export const INFER_THRESHOLDS = [8, 25, 100];
// 喂给模型的"已收录梗名"上限：只是防重复提案，给多了白烧 token
export const EXISTING_NAMES_MAX = 15;

export const WATCH_CAP = 15;          // 每群观察词上限
export const WATCH_TTL_DAYS = 14;     // 观察词保鲜期：两周没再出现就忘掉
export const WATCH_MIN_DAY_OCCURRENCES = 2;   // 观察词当天至少出现 2 次
export const WATCH_MAX_SAMPLES = 2;

const WATCH_DIR = path.join(DATA_DIR, 'meme-watch');

/** 归一化：小写 + 去掉所有空白。用于匹配与查重（"尊嘟 假嘟" == "尊嘟假嘟"）。 */
export function normTerm(s) {
  return String(s ?? '').toLowerCase().replace(/[\s\u3000]+/g, '');
}

/** 噪声判定：纯数字/纯标点/URL/占位符，不是可检索的词。 */
export function looksLikeNoiseTerm(s) {
  const t = String(s ?? '').trim();
  if (!t) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (t.length < 2 || t.length > 20) return true;
  if (/^[\d\s.．,，:：;；!！?？~～。、…\-—_()（）[\]【】「」『』]+$/.test(t)) return true;
  return /^\d{4,}$/.test(t);
}

/**
 * 统计每个词在消息里出现的情况。
 * - 只数非 self 消息（学的是群友的用法，不是机器人自己的回声）
 * - **每条消息对一个词最多计 1 次**（一个人连发三条同词算 3 次，一句话里出现两遍只算 1 次）
 * - 同时收集命中的消息 id（≤maxMids，留最近几条）与原文样例（≤maxSamples）
 *
 * @param {Array<{mid?:any,text?:string,self?:boolean,ts?:number}>} messages
 * @param {Array<string|{name:string,aliases?:string[]}>} names
 * @returns {Map<string,{count:number,mids:string[],samples:string[]}>} key = normTerm(词)
 */
export function countOccurrences(messages, names, { maxMids = 3, maxSamples = 3 } = {}) {
  const out = new Map();
  const terms = [];
  for (const item of Array.isArray(names) ? names : []) {
    const name = typeof item === 'string' ? item : item?.name;
    const norm = normTerm(name);
    if (!norm) continue;
    terms.push({ norm, aliases: (typeof item === 'object' && Array.isArray(item?.aliases) ? item.aliases : []).map(normTerm).filter(Boolean) });
    if (!out.has(norm)) out.set(norm, { count: 0, mids: [], samples: [] });
  }
  if (!terms.length) return out;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.self) continue;
    const text = String(m.text ?? '');
    if (!text) continue;
    const hay = normTerm(text);
    for (const t of terms) {
      const hit = hay.includes(t.norm) || t.aliases.some((a) => hay.includes(a));
      if (!hit) continue;
      const rec = out.get(t.norm);
      rec.count += 1;
      if (m.mid !== undefined && m.mid !== null) {
        rec.mids.push(String(m.mid));
        if (rec.mids.length > maxMids) rec.mids = rec.mids.slice(-maxMids);
      }
      if (rec.samples.length < maxSamples) rec.samples.push(text.slice(0, 60));
    }
  }
  return out;
}

/** 证据消息 id：去重 + 保留最近的 max 个（新证据比旧证据有用）。 */
export function mergeEvidenceMids(old, added, max = 3) {
  const merged = [];
  for (const x of [...(Array.isArray(old) ? old : []), ...(Array.isArray(added) ? added : [])]) {
    const id = String(x ?? '').trim();
    if (id && !merged.includes(id)) merged.push(id);
  }
  return merged.slice(-Math.max(1, max));
}

/** 该不该做一次"含义修正"：返回要跨过的阈值，或 null（还没到 / 已完成）。 */
export function nextInferenceThreshold(inferredCount, count) {
  const countNum = Math.max(0, Number(count) || 0);
  const lastNum = Math.max(0, Number(inferredCount) || 0);
  if (countNum <= lastNum) return null;
  return INFER_THRESHOLDS.find((t) => countNum >= t && t > lastNum) ?? null;
}

/**
 * 把当天的出现情况累计到已有条目的 count/lastSeenAt/evidenceMids 上（不改变 status）。
 * 旧条目没有这些字段时按 0/空处理（向后兼容，不做批量迁移）。
 */
export function accumulateMemeSignals(entries, messages, now = Date.now()) {
  const list = Array.isArray(entries) ? entries : [];
  const occ = countOccurrences(messages, list.map((m) => ({ name: m?.name, aliases: m?.aliases })));
  let changed = false;
  const next = list.map((m) => {
    const norm = normTerm(m?.name);
    const rec = norm ? occ.get(norm) : null;
    if (!rec || !rec.count) return m;
    changed = true;
    return {
      ...m,
      count: (Number(m.count) || 0) + rec.count,
      lastSeenAt: now,
      evidenceMids: mergeEvidenceMids(m.evidenceMids, rec.mids)
    };
  });
  return { entries: next, changed };
}

/**
 * 应用模型的"含义修正"。只作用于 pending（未审 AI 草稿）；
 * active 是人工审定过的解释，永不自动改；rejected 留痕不动。
 * 条件：该条目累计次数已越过下一档阈值 + 模型自评可信度够。
 */
export function applyMemeUpdates(entries, updates, { minConfidence = 0.72, now = Date.now() } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const raws = Array.isArray(updates) ? updates : [];
  const byNorm = new Map();
  for (const m of list) {
    const norm = normTerm(m?.name);
    if (norm) byNorm.set(norm, m);
  }
  let applied = 0;
  let dropped = 0;
  const patch = new Map();
  for (const item of raws) {
    const norm = normTerm(item?.name);
    const target = norm ? byNorm.get(norm) : null;
    const meaning = String(item?.meaning ?? '').replace(/\s+/g, ' ').trim();
    const confidence = Number(item?.confidence);
    if (!target || target.status !== 'pending') { dropped++; continue; }
    if (!meaning || meaning.length < 4) { dropped++; continue; }
    if (!Number.isFinite(confidence) || confidence < minConfidence) { dropped++; continue; }
    if (!nextInferenceThreshold(target.inferredCount, target.count)) { dropped++; continue; }
    patch.set(norm, {
      meaning,
      inferredCount: Number(target.count) || 0,
      refinedAt: now,
      ...(item?.example ? { example: String(item.example).replace(/\s+/g, ' ').trim().slice(0, 120) } : {})
    });
    applied++;
  }
  if (!patch.size) return { entries: list, applied, dropped };
  return {
    entries: list.map((m) => {
      const norm = normTerm(m?.name);
      return norm && patch.has(norm) ? { ...m, ...patch.get(norm) } : m;
    }),
    applied,
    dropped
  };
}

/** 从模型的 unknown[] 产出可入观察表的词（校验 + 当日次数）。 */
export function buildWatchTerms(rawUnknown, { knownNames = [], messages = [], now = Date.now() } = {}) {
  const known = new Set((Array.isArray(knownNames) ? knownNames : []).map(normTerm).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(rawUnknown) ? rawUnknown : []) {
    const term = String(typeof item === 'string' ? item : item?.term ?? '').replace(/\s+/g, ' ').trim();
    const norm = normTerm(term);
    if (!norm || seen.has(norm)) continue;
    if (looksLikeNoiseTerm(term)) continue;
    if (known.has(norm)) continue;
    const rec = countOccurrences(messages, [term]).get(norm);
    if (!rec || rec.count < WATCH_MIN_DAY_OCCURRENCES) continue;
    seen.add(norm);
    out.push({ term, count: rec.count, mids: rec.mids, samples: rec.samples.slice(0, WATCH_MAX_SAMPLES) });
  }
  return out;
}

// ── 观察表存储（per-chat，天然隔离）────────────────────────────────────

/** 观察表文件路径；非 group:<纯数字> 一律 null（防路径穿越，私聊没有群观察表）。 */
export function watchFileFor(chatKey) {
  const key = String(chatKey ?? '');
  if (!key.startsWith('group:')) return null;
  const gid = key.split(':')[1] || '';
  if (!/^\d+$/.test(gid)) return null;
  return path.join(WATCH_DIR, `${gid}.json`);
}

function emptyWatch() { return { terms: [] }; }

/** 读观察表：缺失/损坏一律视为空（锦上添花，不能炸主流程）。 */
export function loadWatch(chatKey) {
  const file = watchFileFor(chatKey);
  if (!file) return emptyWatch();
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.terms)) {
      return {
        terms: parsed.terms.filter((t) => t && String(t.term ?? '').trim())
          .map((t) => ({
            term: String(t.term).trim(),
            count: Math.max(0, Number(t.count) || 0),
            firstSeenAt: Number(t.firstSeenAt) || 0,
            lastSeenAt: Number(t.lastSeenAt) || 0,
            samples: Array.isArray(t.samples) ? t.samples.slice(0, WATCH_MAX_SAMPLES) : []
          }))
      };
    }
  } catch { /* 新群 / 坏文件 */ }
  return emptyWatch();
}

/** 原子写（tmp + rename），并按 TTL 清理、按上限裁剪（保留出现次数高的）。 */
export function saveWatch(chatKey, terms, now = Date.now()) {
  const file = watchFileFor(chatKey);
  if (!file) return false;
  const ttlMs = WATCH_TTL_DAYS * 24 * 3600 * 1000;
  let list = (Array.isArray(terms) ? terms : [])
    .filter((t) => t && String(t.term ?? '').trim())
    .filter((t) => now - (Number(t.lastSeenAt) || now) <= ttlMs)
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, WATCH_CAP);
  try {
    fs.mkdirSync(WATCH_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ terms: list }, null, 1), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;   // 写不进去只影响这次观察，不影响复盘主流程
  }
}

/** 合并今天的观察词：已有累计次数/更新时间，新的直接插入。 */
export function mergeWatchTerms(chatKey, freshTerms, now = Date.now()) {
  const cur = loadWatch(chatKey);
  const byNorm = new Map();
  for (const t of cur.terms) byNorm.set(normTerm(t.term), { ...t });
  for (const t of Array.isArray(freshTerms) ? freshTerms : []) {
    const norm = normTerm(t?.term);
    if (!norm) continue;
    const prev = byNorm.get(norm);
    if (prev) {
      prev.count = (Number(prev.count) || 0) + (Number(t.count) || 0);
      prev.lastSeenAt = now;
      prev.samples = [...(prev.samples || []), ...(t.samples || [])].slice(-WATCH_MAX_SAMPLES);
    } else {
      byNorm.set(norm, {
        term: String(t.term).trim(),
        count: Math.max(1, Number(t.count) || 1),
        firstSeenAt: now,
        lastSeenAt: now,
        samples: (t.samples || []).slice(0, WATCH_MAX_SAMPLES)
      });
    }
  }
  const merged = [...byNorm.values()];
  saveWatch(chatKey, merged, now);
  return merged;
}

/**
 * 本轮文本命中了哪些观察词（"提到才召回"）。
 * 返回 [{term, count}]，出现次数高的优先；没命中返回空数组。
 */
export function matchWatched(chatKey, text, max = 3) {
  const hay = normTerm(text);
  if (!hay) return [];
  const { terms } = loadWatch(chatKey);
  return terms
    .filter((t) => {
      const norm = normTerm(t.term);
      return norm && hay.includes(norm);
    })
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, Math.max(1, max))
    .map((t) => ({ term: t.term, count: Number(t.count) || 0 }));
}

/** 命中时渲染的提示块（纯函数，测试直接断言文案与顺序）。 */
export function formatWatchHint(matched) {
  const list = (Array.isArray(matched) ? matched : []).filter((m) => m && String(m.term ?? '').trim());
  if (!list.length) return '';
  const lines = list.map((m) => `${m.term}（${m.count} 次）`).join('、');
  return [
    '【本群新说法（可能你还不认识）】',
    `群里最近反复出现这些说法：${lines}。如果上下文正在用、你确实需要接，可以先用「查网络梗」或 web_search 查一下；查明白后可以用「收录网络梗」记下来。`,
    '不确定就别装懂，也别每次都查 —— 查不查看这次要不要接这句话。'
  ].join('\n');
}
