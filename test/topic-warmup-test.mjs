// 话题热身卡（skills/topic-warmup）自测：接梗能力的确定性知识注入。
// 验证：① 群梗命中渲染（active 进 / pending 不进）② 无命中与边界返回 []
// ③ 私聊无群梗但网络梗底稿仍可命中 ④ TTL 缓存（改文件立即不变、过期后变）。
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 数据目录隔离：必须在 import src/* 之前设置（config.js 模块加载时把 DATA_DIR 定死）。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-warmup-'));
process.env.QQ_AGENT_DATA_DIR = dataDir;

const { createChecker, sleep } = await import('./_harness.mjs');
const t = createChecker('话题热身卡');
const { saveMemes } = await import('../src/group-memes.js');
const skill = await import('../skills/topic-warmup/index.js');

// 假 store：与真 ChatStore.recent 同约定（正序返回、limit 生效、条目含 text）
function fakeStore(messages) {
  return { recent: (_chatKey, { limit = 80 } = {}) => messages.slice(-limit) };
}
const ctxOf = (chatKey, messages) => ({ chatKey, store: fakeStore(messages) });

// 群聊消息：含「锄大地」「厕卡」两个群梗名；「终末地」里藏着「末地」（缓存用例追加的梗名）
const GROUP_MSGS = [
  { id: 1, ts: 1, self: false, text: '终末地今天更新了' },
  { id: 2, ts: 2, self: false, text: '锄大地锄了一下午，体力全没了' },
  { id: 3, ts: 3, self: false, text: '我这厕卡又歪了' },
  { id: 4, ts: 4, self: true, text: '你们慢慢锄' }
];

// ── ① 群梗命中 ──────────────────────────────────────────────────────────
t.section('① 群梗命中：active 注入、pending 不注入');
saveMemes('group:123', [
  { id: 'g1', name: '锄大地', meaning: '终末地里清图刷体力', example: '今天你锄了吗', status: 'active', createdAt: 3 },
  { id: 'g2', name: '厕卡', meaning: '抽卡歪了的自嘲', example: '', status: 'active', createdAt: 2 },
  { id: 'g3', name: '待审梗', meaning: 'pending 不许出现', status: 'pending', createdAt: 4 }
]);

await t.check('命中时输出热身卡片段（形状正确）', () => {
  const s = skill.promptSections(ctxOf('group:123', GROUP_MSGS));
  assert.strictEqual(s.length, 1, '应且仅应输出一段');
  assert.strictEqual(s[0].id, 'topic-warmup');
  assert.strictEqual(s[0].title, '话题热身');
  assert.strictEqual(s[0].priority, 30, '动态段殿后');
  assert.ok(s[0].content.startsWith('以下词条与当前话题相关，回答前先看完再决定怎么接'), '首行说明在场');
  return `content ${s[0].content.length} 字符`;
});

await t.check('active 群梗按「名字：含义（群里语境：example）」渲染', () => {
  const c = skill.promptSections(ctxOf('group:123', GROUP_MSGS))[0].content;
  assert.ok(c.includes('锄大地：终末地里清图刷体力（群里语境：今天你锄了吗）'), '带 example 的完整渲染');
  assert.ok(c.includes('厕卡：抽卡歪了的自嘲'), '无 example 的省略语境');
});

await t.check('pending 群梗不注入', () => {
  const c = skill.promptSections(ctxOf('group:123', GROUP_MSGS))[0].content;
  assert.ok(!c.includes('待审梗'));
});

await t.check('内容总量 ≤600 字符', () => {
  const c = skill.promptSections(ctxOf('group:123', GROUP_MSGS))[0].content;
  assert.ok(c.length <= 601, `实际 ${c.length}`);
});

// ── ② 无命中 / 边界 ─────────────────────────────────────────────────────
t.section('② 无命中与边界：一律返回 []');
saveMemes('group:456', [{ id: 'x', name: '只在此群', meaning: '别的消息提不到', example: '', status: 'active', createdAt: 1 }]);

await t.check('消息不含任何词条名 → []', () => {
  const s = skill.promptSections(ctxOf('group:456', [
    { text: '今天天气不错' }, { text: '中午食堂吃什么好' }, { text: '我下午去趟超市' }
  ]));
  assert.deepStrictEqual(s, []);
});

await t.check('store 不可用 → []', () => {
  assert.deepStrictEqual(skill.promptSections({ chatKey: 'group:123', store: null }), []);
  assert.deepStrictEqual(skill.promptSections({ chatKey: 'group:123' }), []);
});

await t.check('消息不足 3 条 → []', () => {
  assert.deepStrictEqual(skill.promptSections(ctxOf('group:123', GROUP_MSGS.slice(0, 2))), []);
});

// ── ③ 私聊 ──────────────────────────────────────────────────────────────
t.section('③ 私聊：无群梗，网络梗底稿仍可命中');
await t.check('private 会话命中底稿词条「破防了」', () => {
  const s = skill.promptSections(ctxOf('private:777', [
    { text: '刚出分了' },
    { text: '看到这成绩我直接破防了' },
    { text: '下学期重修吧' }
  ]));
  assert.strictEqual(s.length, 1);
  assert.ok(s[0].content.includes('破防了：'), '网络梗按「名字：含义」渲染（无群里语境）');
  assert.ok(!s[0].content.includes('锄大地'), '私聊绝不注入群梗（哪怕消息里出现了群梗名）');
});

// ── ④ TTL 缓存 ──────────────────────────────────────────────────────────
t.section('④ TTL 缓存：改文件立即不变，过期后生效');
await t.check('TTL 内改群梗文件 → 仍用缓存', () => {
  saveMemes('group:123', [
    { id: 'g1', name: '锄大地', meaning: '终末地里清图刷体力', example: '今天你锄了吗', status: 'active', createdAt: 3 },
    { id: 'g2', name: '厕卡', meaning: '抽卡歪了的自嘲', example: '', status: 'active', createdAt: 2 },
    { id: 'g4', name: '末地', meaning: '终末地的简称', example: '', status: 'active', createdAt: 5 }
  ]);
  const c = skill.promptSections(ctxOf('group:123', GROUP_MSGS))[0].content;
  assert.ok(!c.includes('末地：终末地的简称'), '60s TTL 内不应读到新文件'
    + '（用整行断言：裸「末地」会误中「终末地里」的子串）');
});

await t.check('TTL 过期后再调 → 读到新文件', async () => {
  skill.internals.setTtlMs(30);
  await sleep(60);
  const c = skill.promptSections(ctxOf('group:123', GROUP_MSGS))[0].content;
  assert.ok(c.includes('末地：终末地的简称'), '过期后应重新读盘');
  skill.internals.setTtlMs(60_000);   // 恢复默认
  skill.internals.clearCache();
});

try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
t.finish();
