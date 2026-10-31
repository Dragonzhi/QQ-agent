// 梗候选库单元测试（meme-distiller P0）：解析闸 / 查重 / 晋升写入 / 清理。
// 运行：node test/meme-candidates-test.mjs
// ⚠️ 必须在 import 业务模块之前指定临时数据目录（config.js 在模块加载时定 DATA_DIR）。
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-meme-candidates-'));
process.env.QQ_AGENT_DATA_DIR = tmp;

const core = await import('../src/meme-candidates.js');
const plugin = await import('../plugins/meme-distiller/index.js');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); passed++; };

// ── 1. 归一化：大小写/空白/标点不计差异 ──
eq(core.normTitle('  YYDS！'), 'yyds', '归一化应去空白与标点');
eq(core.normTitle('栓Q'), core.normTitle('栓q'), '大小写不应算不同梗');
eq(core.normTitle('尊嘟 假嘟'), core.normTitle('尊嘟假嘟'), '空白不应算不同梗');

// ── 2. 宽松 JSON 解析：围栏 / 前后废话 / 裸数组 / 垃圾 ──
const p1 = plugin.parseLooseJson('\u0060\u0060\u0060json\n{"memes":[]}\n\u0060\u0060\u0060');
eq(Array.isArray(p1?.memes), true, '应剥掉 json 围栏');
const p2 = plugin.parseLooseJson('好的，结果如下：{"memes":[{"title":"x"}]} 以上。');
eq(p2?.memes?.[0]?.title, 'x', '应容忍前后废话');
const p3 = plugin.parseLooseJson('[{"title":"a"}]');
eq(Array.isArray(p3), true, '应容忍裸数组');
eq(plugin.parseLooseJson('完全不是 JSON'), null, '纯文本应返回 null');

// ── 3. 落盘闸：无证据/低可信/噪声标题/查重/上限 ──
const rawOk = {
  memes: [
    { title: '正式梗', aliases: ['别名一', ' 别名二 '], meaning: '意思是这个说法被拿来开玩笑', usage: '群里接话时用', tone: '自嘲', freshness: '正热', evidence: '热榜标题里两次出现这个词', confidence: 0.9, tags: ['谐音', ''] },
    { title: '没证据', meaning: '听起来像个梗但没有依据', evidence: '', confidence: 0.95 },
    { title: '低可信', meaning: '这条模型自己也没把握', evidence: '某条热榜', confidence: 0.3 },
    { title: '123456789', meaning: '纯数字标题没有价值', evidence: '某条热榜', confidence: 0.9 },
    { title: 'https://example.com', meaning: '链接不是梗', evidence: '某条', confidence: 0.9 },
    { title: '太短', meaning: 'x', evidence: '某条', confidence: 0.9 },
    { title: '  ', meaning: '空标题应丢弃', evidence: '某条', confidence: 0.9 }
  ]
};
const built = plugin.buildCandidates(rawOk, { existing: new Set(), minConfidence: 0.7, max: 5, now: 1000 });
eq(built.candidates.length, 1, '只有证据齐全的那条能过闸');
eq(built.dropped, 6, '其余 6 条应全部被丢弃');
const c0 = built.candidates[0];
eq(c0.status, 'pending', '产物必须只进待审');
eq(c0.source, 'distill', '来源标记');
eq(c0.confidence, 0.9);
eq(c0.aliases.length, 2, '别名应去空后保留 2 个');
ok(!c0.aliases.includes(''), '空别名必须被过滤');
ok(!('extra' in c0), '不允许透传未知字段');

// 查重：已有同名的即使证据齐全也丢
const dupBuilt = plugin.buildCandidates(
  { memes: [{ title: '正式梗', meaning: '重复的梗', evidence: '热榜', confidence: 0.9 }] },
  { existing: new Set([core.normTitle('正式梗')]), minConfidence: 0.7, max: 5 }
);
eq(dupBuilt.candidates.length, 0, '已存在的同名梗不应重复入候选');
eq(dupBuilt.dropped, 1);

// 上限：max 生效，且不会无限输出
const many = { memes: Array.from({ length: 9 }, (_, i) => ({ title: `梗${i}`, meaning: `这是第 ${i} 个梗的意思`, evidence: '热榜', confidence: 0.9 })) };
eq(plugin.buildCandidates(many, { existing: new Set(), max: 3 }).candidates.length, 3, '单次上限必须生效');

// ── 4. 存储：损坏文件不炸、读回一致 ──
const storeFile = path.join(tmp, 'meme-distiller', 'candidates.json');
fs.mkdirSync(path.dirname(storeFile), { recursive: true });
fs.writeFileSync(storeFile, '{ 这不是合法 JSON', 'utf8');
assert.deepEqual(core.loadCandidates().candidates, [], '坏文件应视为空库而不是抛错');
passed++;

const now = Date.now();
core.saveCandidates({
  lastRunAt: now,
  lastRunDay: '2026-10-31',
  candidates: [
    { id: 'md-a', title: '正式梗', aliases: ['别名一'], meaning: '意思是这个说法被拿来开玩笑', usage: '群里接话时用', tone: '自嘲', era: '', freshness: '正热', evidence: '热榜两次出现', confidence: 0.9, tags: ['谐音'], status: 'pending', source: 'distill', createdAt: now },
    { id: 'md-b', title: '待驳回的梗', aliases: [], meaning: '这条会被驳回留痕', usage: '', tone: '', era: '', freshness: '正热', evidence: '热榜', confidence: 0.8, tags: [], status: 'pending', source: 'distill', createdAt: now - 10 }
  ]
});
eq(core.loadCandidates().candidates.length, 2, '保存后应读回 2 条');
eq(core.loadCandidates().lastRunDay, '2026-10-31');

// 列表排序：pending 在前，新的在前
const sorted = core.listCandidates();
eq(sorted[0].id, 'md-a', '新候选排前面');
eq(core.candidateStats().pending, 2, '统计待审 2 条');

// ── 5. 晋升：写入 user-added.json（形状对齐 trendy-memes entriesOf）──
const promoted = core.promoteCandidate('md-a');
eq(promoted.ok, true, '晋升应成功');
const userFile = path.join(tmp, 'trendy-memes', 'user-added.json');
const userRaw = JSON.parse(fs.readFileSync(userFile, 'utf8'));
eq(userRaw.entries.length, 1, '自学习库应新增 1 条');
const entry = userRaw.entries[0];
eq(entry.title, '正式梗');
eq(entry.freshness, '正热');
eq(Array.isArray(entry.aliases), true);
ok(!('evidence' in entry) && !('confidence' in entry) && !('status' in entry), '候选内部字段不应写进梗库');
eq(core.listCandidates().find((c) => c.id === 'md-a').status, 'active', '晋升后候选置 active');
eq(core.promoteCandidate('md-a').code, 409, '重复晋升应 409');
eq(core.promoteCandidate('md-not-exist').code, 404, '不存在的 id 应 404');

// 再晋升一条同名（换个 id）也必须被自学习库查重拦下
core.saveCandidates({
  ...core.loadCandidates(),
  candidates: [
    ...core.loadCandidates().candidates,
    { id: 'md-c', title: '正式 梗', aliases: [], meaning: '换个写法也是同一个梗', evidence: '热榜', confidence: 0.9, status: 'pending', source: 'distill', createdAt: now }
  ]
});
const dupPromote = core.promoteCandidate('md-c');
eq(dupPromote.code, 409, '归一化同名不应重复写进梗库');

// ── 6. 驳回：留痕且不再展示为待审 ──
eq(core.rejectCandidate('md-b').ok, true, '驳回应成功');
eq(core.listCandidates().find((c) => c.id === 'md-b').status, 'rejected');
eq(core.rejectCandidate('md-b').ok, true, '重复驳回应幂等成功');
eq(core.rejectCandidate('md-none').code, 404);

// 驳回的标题也要参与去重（titlesInUse 会把它算进来）
const rejectedBuilt = plugin.buildCandidates(
  { memes: [{ title: '待驳回的梗', meaning: '同名的不能再收', evidence: '热榜', confidence: 0.9 }] },
  { existing: plugin.titlesInUse(), minConfidence: 0.7, max: 5 }
);
eq(rejectedBuilt.candidates.length, 0, '已驳回的梗不应再被收进候选');

// ── 7. 删除 / 清理 / 待审上限 ──
eq(core.removeCandidate('md-c').ok, true, '删除应成功');
eq(core.removeCandidate('md-c').code, 404, '重复删除应 404');

const old = now - 40 * 24 * 3600 * 1000;
core.saveCandidates({
  ...core.loadCandidates(),
  candidates: [
    { id: 'md-old', title: '很旧的已决条目', aliases: [], meaning: '超过保留期应被清', evidence: 'x', confidence: 0.9, status: 'rejected', createdAt: old, decidedAt: old },
    { id: 'md-old-pending', title: '很旧的待审条目', aliases: [], meaning: '待审的不能自动清', evidence: 'x', confidence: 0.9, status: 'pending', createdAt: old }
  ]
});
eq(core.pruneCandidates(30), 1, '只应清掉已决且过期的 1 条');
const afterPrune = core.listCandidates();
ok(afterPrune.some((c) => c.id === 'md-old-pending'), '待审的过期条目必须保留');

// 待审上限：超了丢最旧待审
const manyPending = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, title: `待审梗${i}`, aliases: [], meaning: '凑数', evidence: 'x', confidence: 0.9, status: 'pending', createdAt: i }));
const trimmed = plugin.trimPending({ candidates: manyPending }, 10);
eq(trimmed.candidates.length, 10, '待审上限 10 应裁到 10 条');
ok(trimmed.candidates.every((c) => c.id !== 'p0' && c.id !== 'p4'), '应丢最旧的 5 条');
passed++;

// ── 8. titlesInUse：底稿/自学习库/候选库都参与查重 ──
const inUse = plugin.titlesInUse();
ok(inUse.has(core.normTitle('正式梗')), '自学习库里的梗应在查重集合里');
ok(inUse.size > 10, '底稿标题也应参与查重');

console.log(`梗候选库测试全部通过 ✅（${passed} 项）`);
