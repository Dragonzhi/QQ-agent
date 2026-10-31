// 梗候选库（meme-distiller 的消费端）—— doc/plans/meme-distiller-plan.md §4.2。
//
// 生产端是 plugins/meme-distiller（定时从热榜蒸馏候选，写 data/meme-distiller/candidates.json）。
// 这里是审查端：读候选 → 人工晋升/驳回 → 晋升时把条目追加进
// data/trendy-memes/user-added.json —— 不新建一套"梗库2"，因为 trendy-memes 的
// loadAll() 本来就合并 user-added.json，晋升即生效、消费端零改动。
//
// 闸门照抄群梗库（src/group-memes.js）的 pending/active/rejected：
// 蒸馏是 LLM 产物，硬编一个错解释比不认识更尴尬，所以无人值守的产物永远只进待审。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const DIR = path.join(DATA_DIR, 'meme-distiller');
const FILE = path.join(DIR, 'candidates.json');
const USER_FILE = path.join(DATA_DIR, 'trendy-memes', 'user-added.json');
// user-added.json 的硬上限：只增不减会把提示词/检索拖慢；超了丢最旧的（新梗更有价值）
const USER_CAP = 300;

function emptyStore() {
  return { version: 1, updatedAt: 0, lastRunAt: 0, lastRunDay: '', stats: {}, candidates: [] };
}

function readJson(file) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch { return null; }
}

/** 原子写：tmp + rename，写一半崩溃不会留下半截 JSON。 */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 读候选库。文件缺失/损坏一律视为空 —— 候选库是锦上添花，不能炸主流程。
 * 损坏时备份坏文件（便于排查），但不抛错。
 */
export function loadCandidates() {
  const parsed = readJson(FILE);
  if (!parsed || typeof parsed !== 'object') return emptyStore();
  const base = emptyStore();
  return {
    ...base,
    ...parsed,
    stats: { ...base.stats, ...(parsed.stats || {}) },
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates.filter((c) => c && c.title) : []
  };
}

export function saveCandidates(store) {
  const next = { ...emptyStore(), ...(store || {}), updatedAt: Date.now() };
  writeJson(FILE, next);
  return next;
}

/** 归一化标题：查重口径（大小写、空白、标点差异不算不同梗）。 */
export function normTitle(s) {
  return String(s ?? '').toLowerCase().replace(/[\s\u3000]+/g, '').replace(/[，。！？、,.!?~\-—_:：'"“”()（）\[\]【】]/g, '');
}

/** 列表：待审在前（新的优先），已决的按时间倒序跟在后面。 */
export function listCandidates() {
  const { candidates } = loadCandidates();
  const rank = { pending: 0, active: 1, rejected: 2 };
  return candidates
    .slice()
    .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

/** 候选 → trendy-memes 的 entry 形状（entriesOf() 认的那几个字段，多余字段丢弃）。 */
export function candidateToEntry(c) {
  return {
    title: String(c.title || '').trim(),
    aliases: Array.isArray(c.aliases) ? c.aliases.map((a) => String(a).trim()).filter(Boolean).slice(0, 4) : [],
    meaning: String(c.meaning || '').trim(),
    usage: String(c.usage || '').trim(),
    tone: String(c.tone || '').trim(),
    era: String(c.era || '').trim(),
    freshness: String(c.freshness || '蒸馏').trim() || '蒸馏',
    tags: Array.isArray(c.tags) ? c.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6) : []
  };
}

/** 读自学习库（容忍两种形态：{entries:[]} 与裸数组）。 */
export function loadUserAdded() {
  const parsed = readJson(USER_FILE);
  const list = Array.isArray(parsed) ? parsed : (parsed?.entries || []);
  return list.filter((e) => e && e.title);
}

function writeUserAdded(entries) {
  const list = entries.slice(-USER_CAP);
  writeJson(USER_FILE, { entries: list });
  return list.length;
}

/**
 * 晋升：把候选写进 user-added.json 并置 active。
 * 查重口径与群梗库一致：同名（归一化后）已存在就 409，不覆盖已有条目。
 * 返回 { ok:true, entry } 或 { ok:false, code, error }。
 */
export function promoteCandidate(id) {
  const store = loadCandidates();
  const cand = store.candidates.find((c) => c && c.id === id);
  if (!cand) return { ok: false, code: 404, error: '找不到这条候选' };
  if (cand.status === 'active') return { ok: false, code: 409, error: '这条已经是生效状态' };
  const entry = candidateToEntry(cand);
  if (!entry.title || !entry.meaning) return { ok: false, code: 400, error: '候选缺标题或含义，不能晋升' };

  const existing = loadUserAdded();
  const norm = normTitle(entry.title);
  const aliases = entry.aliases.map(normTitle);
  const dup = existing.some((e) => {
    if (normTitle(e.title) === norm) return true;
    const ea = (Array.isArray(e.aliases) ? e.aliases : []).map(normTitle);
    return aliases.some((a) => a && (ea.includes(a) || normTitle(e.title) === a)) || ea.includes(norm);
  });
  if (dup) return { ok: false, code: 409, error: `自学习库里已有同名/同别名的梗：${entry.title}` };

  writeUserAdded([...existing, entry]);
  const next = {
    ...store,
    candidates: store.candidates.map((c) => (c.id === id
      ? { ...c, status: 'active', decidedAt: Date.now() }
      : c))
  };
  saveCandidates(next);
  return { ok: true, entry };
}

/** 别名输入容错：数组或「逗号/顿号/空格分隔」的字符串都能吃，去重、去空、去与标题重复的。 */
export function parseAliases(value, title = '') {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[,，、\s]+/);
  const normTitleValue = normTitle(title);
  const out = [];
  for (const a of raw) {
    const s = String(a ?? '').trim().slice(0, 20);
    if (!s) continue;
    const n = normTitle(s);
    if (!n || n === normTitleValue) continue;
    if (out.some((x) => normTitle(x) === n)) continue;
    out.push(s);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * 编辑一条候选（晋升前改解释 / 晋升后修错别字都走这里）。
 *
 * 状态不在这里改（晋升/驳回仍是 PUT 带 status 的那条路径），这里只动内容字段。
 * 已晋升的条目会**同步**改写 user-added.json 里对应的那一份 —— 否则面板改了、
 * 机器人查到的还是旧解释。定位口径与晋升查重一致：归一化标题。
 * 返回 { ok, candidate, synced } 或 { ok:false, code, error }。
 */
export function updateCandidate(id, patch = {}) {
  const store = loadCandidates();
  const cur = store.candidates.find((c) => c && c.id === id);
  if (!cur) return { ok: false, code: 404, error: '找不到这条候选' };
  const next = { ...cur };
  if (patch.title !== undefined) {
    const t = String(patch.title).trim().slice(0, 20);
    if (!t) return { ok: false, code: 400, error: '梗名不能为空' };
    next.title = t;
  }
  if (patch.meaning !== undefined) {
    const m = String(patch.meaning).replace(/\s+/g, ' ').trim();
    if (m.length < 4) return { ok: false, code: 400, error: '含义至少 4 个字（写清楚它是啥）' };
    next.meaning = m.slice(0, 300);
  }
  if (patch.usage !== undefined) next.usage = String(patch.usage).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (patch.evidence !== undefined) next.evidence = String(patch.evidence).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (patch.tone !== undefined) next.tone = String(patch.tone).replace(/\s+/g, ' ').trim().slice(0, 20);
  if (patch.era !== undefined) next.era = String(patch.era).replace(/\s+/g, ' ').trim().slice(0, 20);
  if (patch.freshness !== undefined) next.freshness = String(patch.freshness).replace(/\s+/g, ' ').trim().slice(0, 10);
  if (patch.aliases !== undefined) next.aliases = parseAliases(patch.aliases, next.title);
  if (patch.tags !== undefined) {
    const tags = Array.isArray(patch.tags) ? patch.tags : String(patch.tags ?? '').split(/[,，、\s]+/);
    next.tags = tags.map((t) => String(t ?? '').trim().slice(0, 10)).filter(Boolean).slice(0, 6);
  }
  next.updatedAt = Date.now();

  // 已晋升：把改动同步进自学习库（按**编辑前**的标题定位，标题改了也能找到）
  let synced = false;
  if (cur.status === 'active') {
    const entries = loadUserAdded();
    const oldNorm = normTitle(cur.title);
    const idx = entries.findIndex((e) => normTitle(e.title) === oldNorm);
    if (idx >= 0) {
      entries[idx] = candidateToEntry(next);
      writeUserAdded(entries);
      synced = true;
    }
  }
  saveCandidates({ ...store, candidates: store.candidates.map((c) => (c.id === id ? next : c)) });
  return { ok: true, candidate: next, synced };
}

/** 驳回：留痕参与去重，不删除（与群梗库同口径）。 */
export function rejectCandidate(id) {
  const store = loadCandidates();
  const has = store.candidates.some((c) => c && c.id === id);
  if (!has) return { ok: false, code: 404, error: '找不到这条候选' };
  saveCandidates({
    ...store,
    candidates: store.candidates.map((c) => (c.id === id ? { ...c, status: 'rejected', decidedAt: Date.now() } : c))
  });
  return { ok: true };
}

/** 删除：真删（驳回只是留痕，删除用于清掉明显不该出现在列表里的条目）。 */
export function removeCandidate(id) {
  const store = loadCandidates();
  const next = store.candidates.filter((c) => c && c.id !== id);
  if (next.length === store.candidates.length) return { ok: false, code: 404, error: '找不到这条候选' };
  saveCandidates({ ...store, candidates: next });
  return { ok: true };
}

/**
 * 清理已决条目（active/rejected 超过 keepDays 天），pending 不在这里动
 * （由 plugin 的 maxPending 上限兜底，避免把用户还没看的候选清掉）。
 */
export function pruneCandidates(keepDays = 30) {
  const store = loadCandidates();
  const cutoff = Date.now() - Math.max(1, Number(keepDays) || 30) * 24 * 3600 * 1000;
  const kept = store.candidates.filter((c) => {
    if (c.status === 'pending') return true;
    const at = Number(c.decidedAt) || Number(c.createdAt) || 0;
    return at >= cutoff;
  });
  const removed = store.candidates.length - kept.length;
  if (removed > 0) saveCandidates({ ...store, candidates: kept });
  return removed;
}

/** 状态汇总（设置页/日志用）。 */
export function candidateStats() {
  const { candidates, lastRunAt, lastRunDay, stats } = loadCandidates();
  const by = { pending: 0, active: 0, rejected: 0 };
  for (const c of candidates) if (by[c.status] !== undefined) by[c.status]++;
  return { total: candidates.length, ...by, lastRunAt, lastRunDay, stats };
}
