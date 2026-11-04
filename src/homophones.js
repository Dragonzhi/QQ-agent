// 谐音梗提示（2026-11-04）。
//
// 用户反馈 bot 常常按字面理解谐音梗。取证（van♂游群 11-03）：
//   · 群友「你🐋玉玉了同学」→ 它只回了"心疼钱包"，完全没读出「玉玉＝抑郁」；
//   · 群友「肥鱼真是区啊」→ 它的思考里写"'区'可能是'菜'的意思"，回了
//     "区也是勤勤恳恳的区"（自说自话）。「区」在这个群是「蛆」的谐音用法。
//
// 做法：一张高置信度的小表（**只收多字、避免单字误伤**——"区""蚌"这种单字
// 会误命中"区域""蚌埠住了"以外的正常词），命中未读消息时给一行提示。
// 提示只负责把"这是谐音"这条信息摆到模型眼前，接不接、怎么接仍由它判断；
// 表里没有的谐音，靠系统提示里的通用规则 + 「查网络梗」工具。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
// 梗库（skills/trendy-memes/kb/*.json）与自学习库：标签里带「谐音」的条目自动并进来。
// 这样"谐音梗大全"不用手抄死在代码里 —— 梗库/蒸馏管线/「收录网络梗」新增一条带谐音
// 标签的条目，下一次构建提示词就生效（文件变更按 mtime 失效缓存）。
const KB_DIR = path.join(APP_ROOT, 'skills', 'trendy-memes', 'kb');
const USER_FILE = path.join(DATA_DIR, 'trendy-memes', 'user-added.json');

export const HOMOPHONES = [
  { term: '玉玉', meaning: '抑郁', note: '「抑郁了」的谐音，调侃情绪低落' },
  { term: '蚌埠住了', meaning: '绷不住了', note: '忍不住笑 / 情绪绷不住' },
  { term: '蚌埠', meaning: '绷不住', note: '同上，简写' },
  { term: '尊嘟假嘟', meaning: '真的假的', note: '卖萌谐音' },
  { term: '尊嘟', meaning: '真的', note: '卖萌谐音' },
  { term: '栓Q', meaning: 'thank you', note: '表面道谢、实际无语' },
  { term: '拴q', meaning: 'thank you', note: '同上' },
  { term: '夺笋', meaning: '多损', note: '损人 / 挖苦' },
  { term: '雨女无瓜', meaning: '与你无关', note: '口音梗' },
  { term: '深井冰', meaning: '神经病', note: '骂人谐音，多为玩笑' },
  { term: '蓝瘦香菇', meaning: '难受想哭', note: '口音梗' },
  { term: '蕉绿', meaning: '焦虑', note: '香蕉相关玩梗' },
  { term: '真不戳', meaning: '真不错', note: '夸赞' },
  { term: '针不戳', meaning: '真不错', note: '同上' },
  { term: '耗子尾汁', meaning: '好自为之', note: '出自马保国' }
];

let cache = { key: '', list: null };

function mtimeOf(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

/** 从梗库/自学习库收集带「谐音」标签（或解释里写了谐音）的条目。 */
function collectedEntries() {
  const out = [];
  const push = (title, meaning, tags) => {
    const term = String(title ?? '').trim();
    const m = String(meaning ?? '').replace(/\s+/g, ' ').trim();
    if (!term || term.length < 2 || term.length > 20 || !m) return;
    const tagged = Array.isArray(tags) && tags.some((t) => /谐音/.test(String(t)));
    if (!tagged && !/谐音/.test(m)) return;
    out.push({ term, meaning: m.slice(0, 60), note: '来自梗库' });
  };
  try {
    for (const name of fs.readdirSync(KB_DIR).filter((n) => n.endsWith('.json'))) {
      const raw = JSON.parse(fs.readFileSync(path.join(KB_DIR, name), 'utf8'));
      for (const e of (Array.isArray(raw) ? raw : (raw?.entries || []))) push(e?.title, e?.meaning, e?.tags);
    }
  } catch { /* 没有梗库就只用内置表 */ }
  try {
    const raw = JSON.parse(fs.readFileSync(USER_FILE, 'utf8'));
    for (const e of (Array.isArray(raw) ? raw : (raw?.entries || []))) push(e?.title, e?.meaning, e?.tags);
  } catch { /* 自学习库还不存在 */ }
  return out;
}

/**
 * 生效的谐音表 = 内置高置信表 + 梗库/自学习库里的谐音条目（按 mtime 缓存）。
 * 内置项优先（同名词条不重复报）。
 */
export function listHomophones() {
  const key = [
    mtimeOf(USER_FILE),
    ...(function () { try { return fs.readdirSync(KB_DIR).filter((n) => n.endsWith('.json')).map((n) => mtimeOf(path.join(KB_DIR, n))); } catch { return []; } })()
  ].join(',');
  if (cache.list && cache.key === key) return cache.list;
  const seen = new Set();
  const list = [];
  for (const h of [...HOMOPHONES, ...collectedEntries()]) {
    const norm = String(h.term).toLowerCase().replace(/\s+/g, '');
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    list.push(h);
  }
  cache = { key, list };
  return list;
}

/**
 * 命中哪些谐音梗。
 * 长词优先：出现「蚌埠住了」时不再重复报「蚌埠」；同一句最多 max 条。
 * @param {string} text
 * @param {number} max
 * @returns {Array<{term:string, meaning:string, note:string}>}
 */
export function matchHomophones(text, max = 3) {
  const hay = String(text ?? '').toLowerCase().replace(/[\s\u3000]+/g, '');
  if (!hay) return [];
  const hits = listHomophones()
    .filter((h) => hay.includes(String(h.term).toLowerCase().replace(/\s+/g, '')))
    .sort((a, b) => b.term.length - a.term.length);
  const kept = [];
  for (const h of hits) {
    // 已被更长的同族词覆盖（蚌埠住了 ⊃ 蚌埠）就跳过
    if (kept.some((k) => k.term.includes(h.term) || h.term.includes(k.term))) continue;
    kept.push(h);
    if (kept.length >= Math.max(1, max)) break;
  }
  return kept;
}

/** 命中时渲染的提示块；没命中返回空串（调用方据此不注入）。 */
export function formatHomophoneHint(list) {
  const items = (Array.isArray(list) ? list : []).filter((h) => h && h.term);
  if (!items.length) return '';
  return [
    '【这句里有谐音，别按字面接】',
    ...items.map((h) => `- ${h.term} = ${h.meaning}（${h.note || ''}）`),
    '按谐音的意思理解这句话；不确定就用「查网络梗」查一下或反问一句，别装懂，也别把谐音解释给群友听。'
  ].join('\n');
}
