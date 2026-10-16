// 群内自产梗的 per-chat 存取（doc/persona-meme-plan.md P2）。
// 每个群一个文件 data/group-memes/<gid>.json，内容 { memes: [...] }。
// 条目形状：{ id, name, meaning, example, status:'active'|'pending'|'rejected', source, createdAt }。
// 只有 status==='active' 的条目会渲染进该群的提示词【群内梗】段（prompt.js）。
// per-chat 文件天然隔离：A 群的黑话绝不会注入到 B 群的提示词里。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const MEMES_DIR = path.join(DATA_DIR, 'group-memes');
// 提示词注入只取最近 N 条 active（与 P1 示例库 maxActive 同思路：防无限膨胀）
export const ACTIVE_CAP = 20;
// 单群文件条目硬上限：超出丢最旧 pending（saveMemes 里强制，防复盘日积月累写爆）
const FILE_CAP = 50;

/** 群梗文件路径。chatKey 不是群聊（group:<纯数字id>）返回 null —— 防路径穿越，私聊没有群梗。 */
export function memesFileFor(chatKey) {
  const key = String(chatKey ?? '');
  if (!key.startsWith('group:')) return null;
  const gid = key.split(':')[1] || '';
  if (!/^\d+$/.test(gid)) return null;
  return path.join(MEMES_DIR, `${gid}.json`);
}

/** 读单群全部梗（含 pending/rejected）。文件缺失/损坏一律视为空 —— 群梗是锦上添花，不能炸主流程。 */
export function loadMemes(chatKey) {
  const file = memesFileFor(chatKey);
  if (!file) return { memes: [] };
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.memes)) return { memes: parsed.memes };
  } catch { /* 新群 / 坏文件 */ }
  return { memes: [] };
}

/**
 * 原子写单群梗列表（tmp + rename：写一半崩溃不会留下半截 JSON 给下次读）。
 * 这里是唯一写入口，单群文件条目上限 50 在此强制：超出时优先丢最旧的 pending
 * （rejected 留痕不动，active 是人工审批过的更不动），全满才丢最旧的。
 */
export function saveMemes(chatKey, memes) {
  const file = memesFileFor(chatKey);
  if (!file || !Array.isArray(memes)) return false;
  let list = memes.filter((m) => m && typeof m === 'object');
  if (list.length > FILE_CAP) {
    const pending = list.filter((m) => m.status === 'pending')
      .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
    const drop = new Set(pending.slice(0, list.length - FILE_CAP));
    list = list.filter((m) => !drop.has(m)).slice(0, FILE_CAP);
  }
  fs.mkdirSync(MEMES_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ memes: list }, null, 1), 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

/** 只取该群生效中的梗：按 createdAt 降序（最近优先）切片。给 prompt.js 注入用。 */
export function loadActiveMemes(chatKey, cap = ACTIVE_CAP) {
  const { memes } = loadMemes(chatKey);
  return memes
    .filter((m) => m && m.status === 'active')
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, Math.max(1, Number(cap) || ACTIVE_CAP));
}

/** 全量列举：设置页「群内梗库」面板用。坏文件跳过不抛。 */
export function listAllMemes() {
  const out = [];
  try {
    const files = fs.readdirSync(MEMES_DIR).filter((f) => /^\d+\.json$/.test(f));
    for (const f of files) {
      const chatId = f.replace(/\.json$/, '');
      const { memes } = loadMemes(`group:${chatId}`);
      if (memes.length) out.push({ chatId, memes });
    }
  } catch { /* 目录还不存在 */ }
  return out;
}
