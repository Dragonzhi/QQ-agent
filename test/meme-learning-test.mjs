// 梗学习模块单测：频次计数 / 阈值 / 证据合并 / 观察表读写与命中（doc/plans/meme-learning-upgrade.md）。
// 运行：node test/meme-learning-test.mjs
// ⚠️ 必须在 import 业务模块之前指定临时数据目录（config.js 在模块加载时定 DATA_DIR）。
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-meme-learning-'));
process.env.QQ_AGENT_DATA_DIR = tmp;

const M = await import('../src/meme-learning.js');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };

// ── 1. 归一化与噪声 ──
eq(M.normTerm(' 尊嘟 假嘟 '), '尊嘟假嘟', '归一化应去空白');
eq(M.looksLikeNoiseTerm('1234567'), true, '纯数字是噪声');
eq(M.looksLikeNoiseTerm('https://a.b/c'), true, 'URL 是噪声');
eq(M.looksLikeNoiseTerm('？？！。'), true, '纯标点是噪声');
eq(M.looksLikeNoiseTerm('胶固'), false, '正常词不是噪声');
eq(M.looksLikeNoiseTerm('一二三四五六七八九十一二三四五六七八九十一'), true, '超长（>20）应判噪声');

// ── 2. 出现次数：只数非 self、每消息计 1、别名算命中、收集 mid ──
const msgs = [
  { mid: 1, self: false, text: '锄大地锄吐了 锄大地' },   // 一条里出现两遍只计 1
  { mid: 2, self: true, text: '锄大地' },                // self 不计
  { mid: 3, self: false, text: '明天还锄大地吗' },
  { mid: 4, self: false, text: '尊嘟假嘟 好可爱' },
  { mid: 5, self: false, text: '尊嘟 假嘟' },            // 空白差异不影响归一化
  { mid: 6, self: false, text: '' }
];
const occ = M.countOccurrences(msgs, [{ name: '锄大地' }, { name: '尊嘟假嘟', aliases: ['真的假嘟'] }]);
eq(occ.get('锄大地').count, 2, 'self 消息不计；每消息最多计 1');
eq(occ.get('锄大地').mids, ['1', '3'], '证据消息 id 按出现顺序收集');
eq(occ.get('尊嘟假嘟').count, 2, '空白差异应算同一个词');
eq(occ.get('尊嘟假嘟').samples.length, 2, '样例条数等于命中条数（上限内）');
ok(!occ.has('真的假嘟'), '别名不单独建立条目');

// mid 上限 3：命中 5 条只保留最近 3 个
const many = Array.from({ length: 5 }, (_, i) => ({ mid: 10 + i, self: false, text: '甲梗' }));
eq(M.countOccurrences(many, ['甲梗']).get('甲梗').mids, ['12', '13', '14'], '证据 id 只留最近 3 个');

// ── 3. 证据合并 / 阈值 ──
eq(M.mergeEvidenceMids(['1', '2'], ['2', '3', '4']), ['2', '3', '4'], '去重后保留最近 3 个');
eq(M.mergeEvidenceMids([], ['7']), ['7']);
eq(M.nextInferenceThreshold(0, 7), null, '没到 8 次不动');
eq(M.nextInferenceThreshold(0, 8), 8);
eq(M.nextInferenceThreshold(8, 9), null, '同一档内不重复修正');
eq(M.nextInferenceThreshold(8, 25), 25);
eq(M.nextInferenceThreshold(100, 150), null, '超过最高档不再修正');

// ── 4. 累计信号 ──
const entries = [
  { id: 'a', name: '锄大地', status: 'pending', count: 2, evidenceMids: ['9'] },
  { id: 'b', name: '没出现过的', status: 'active' }
];
const acc = M.accumulateMemeSignals(entries, msgs, 5000);
eq(acc.changed, true, '有次数变化应标记 changed');
eq(acc.entries[0].count, 4, '2（历史）+ 2（今天）');
eq(acc.entries[0].lastSeenAt, 5000);
eq(acc.entries[0].evidenceMids, ['9', '1', '3'], '旧证据与新证据合并');
eq(acc.entries[1].count, undefined, '今天没出现的条目不应被改写字段');
const noChange = M.accumulateMemeSignals([{ id: 'c', name: '别的梗' }], msgs, 6000);
eq(noChange.changed, false, '没有任何命中时 changed=false');
eq(noChange.entries[0].count, undefined);

// ── 5. 含义修正：只动 pending、要有阈值、要够可信 ──
const pend = [
  { id: 'p', name: '乙梗', status: 'pending', meaning: '旧解释', count: 8, inferredCount: 0 },
  { id: 'q', name: '丙梗', status: 'active', meaning: '人工审定', count: 8, inferredCount: 0 },
  { id: 'r', name: '丁梗', status: 'pending', meaning: '旧解释', count: 3, inferredCount: 0 }
];
const upd = M.applyMemeUpdates(pend, [
  { name: '乙梗', meaning: '修正后的解释', confidence: 0.9 },
  { name: '丙梗', meaning: '想改 active', confidence: 0.95 },
  { name: '丁梗', meaning: '还没到阈值就改', confidence: 0.95 }
], { minConfidence: 0.72, now: 7000 });
eq(upd.applied, 1, '只有 pending 且越过阈值的能改');
eq(upd.dropped, 2, 'active 与未到阈值的都丢弃');
eq(upd.entries.find((m) => m.name === '乙梗').meaning, '修正后的解释');
eq(upd.entries.find((m) => m.name === '乙梗').inferredCount, 8, '修正后记推断基线');
eq(upd.entries.find((m) => m.name === '丙梗').meaning, '人工审定', 'active 内容不动');
const lowConf = M.applyMemeUpdates(pend, [{ name: '乙梗', meaning: '低可信的改法', confidence: 0.3 }], { now: 7000 });
eq(lowConf.applied, 0, '低可信修正应丢弃');

// ── 6. 观察词候选：频次 ≥2、非噪声、不在已收录名单 ──
const msgs2 = [
  ...msgs,
  { mid: 21, self: false, text: '低频梗又来了' },
  { mid: 22, self: false, text: '低频梗 真的' }
];
const watchBuilt = M.buildWatchTerms([
  { term: '低频梗', evidence: '反复出现' },
  { term: '甲梗', evidence: '已收录' },
  { term: '不存在的词', evidence: '没有' },
  { term: '123456', evidence: '数字' },
  { term: '低频梗', evidence: '重复项' }
], { knownNames: ['甲梗'], messages: msgs2, now: 8000 });
eq(watchBuilt.map((t) => t.term), ['低频梗'], '只有低频梗该入选（其余：已收录/没出现/噪声/重复）');
eq(watchBuilt[0].count, 2, '观察词要带当天出现次数');
ok(watchBuilt[0].samples.length <= M.WATCH_MAX_SAMPLES, '样例不超过上限');

// ── 7. 观察表存储：路径校验 / roundtrip / TTL / 上限 / 坏文件 ──
eq(M.watchFileFor('group:123'), path.join(tmp, 'meme-watch', '123.json'));
eq(M.watchFileFor('private:123'), null, '私聊没有群观察表');
eq(M.watchFileFor('group:../../etc'), null, '路径穿越必须拒绝');

const now = Date.now();
eq(M.saveWatch('group:123', [
  { term: '低频梗', count: 2, firstSeenAt: now, lastSeenAt: now, samples: [{ mid: 21, text: '低频梗又来了' }] },
  { term: '过期梗', count: 99, firstSeenAt: now, lastSeenAt: now - 30 * 24 * 3600 * 1000, samples: [] }
], now), true, '观察表应写入成功');
const loaded = M.loadWatch('group:123');
eq(loaded.terms.map((t) => t.term), ['低频梗'], 'TTL 过期的词在写入时被清掉');

// 上限：超过 15 条时按 count 保留高的
const crowded = Array.from({ length: 20 }, (_, i) => ({ term: `词${i}`, count: i + 1, firstSeenAt: now, lastSeenAt: now, samples: [] }));
M.saveWatch('group:124', crowded, now);
const kept = M.loadWatch('group:124').terms;
eq(kept.length, M.WATCH_CAP, '观察表按上限裁剪');
ok(kept.every((t) => t.count >= 6), '裁剪保留出现次数高的');

// 坏文件：视为空而不是抛错
fs.mkdirSync(path.join(tmp, 'meme-watch'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'meme-watch', '125.json'), '{ 坏 JSON', 'utf8');
eq(M.loadWatch('group:125').terms, [], '坏文件应视为空观察表');

// 合并：同一词累计次数、刷新 lastSeenAt、保留样例
M.saveWatch('group:126', [{ term: '低频梗', count: 2, firstSeenAt: now - 1000, lastSeenAt: now - 1000, samples: [{ mid: 1, text: 'a' }] }], now);
M.mergeWatchTerms('group:126', [{ term: '低频梗', count: 3, samples: [{ mid: 2, text: 'b' }] }], now + 1000);
const merged = M.loadWatch('group:126').terms[0];
eq(merged.count, 5, '观察词次数应累计');
eq(merged.lastSeenAt, now + 1000, 'lastSeenAt 应刷新');
eq(merged.firstSeenAt, now - 1000, 'firstSeenAt 保留最早');
ok(merged.samples.length <= M.WATCH_MAX_SAMPLES, '合并后样例不超上限');

// ── 8. 命中与提示块 ──
const matched = M.matchWatched('group:126', '他们说的低频 梗是什么');
eq(matched.map((m) => m.term), ['低频梗'], '"低频 梗"（空白差异）也应命中');
eq(M.matchWatched('group:126', '完全无关的一句话'), [], '没提到就不召回');
const hint = M.formatWatchHint([{ term: '低频梗', count: 5 }]);
ok(hint.includes('【本群新说法'), '提示块应带段头');
ok(hint.includes('低频梗（5 次）'), '提示块应带词与次数');
ok(hint.includes('不确定就别装懂'), '提示块要写明不确定就别装懂');
eq(M.formatWatchHint([]), '', '没命中时返回空串（调用方据此不注入）');

console.log(`梗学习模块测试全部通过 ✅（${passed} 项）`);
