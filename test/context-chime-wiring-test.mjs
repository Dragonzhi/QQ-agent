// 上下文插话判定（能力 reply.interest-judge / context-chime 插件）接线回归（2026-10-25）
//
// 锁住的契约：
//   1. 原生触发（@/关键词/随机）全没命中时，**问一次**判定能力；
//   2. 判定要接 → 排定唤醒，且触发原因记「上下文相关」（不落到"未触发"）；
//   3. 判定不接 / 没有能力提供者 → 回到原生"标已读"，不建会话、不调聊天模型；
//   4. 1 档（仅艾特）**不调**判定 —— 用户显式要求"只认 @"，不该被悄悄改掉；
//   5. 判定抛错 → 当"不接"处理（fail-closed），不把异常漏给入库热路径。
//
// 为什么不 boot 整个应用：Orchestrator 直接 new + 能力用 stub 提供，
// 既不加载真实插件、也不花掉任何真实模型调用，跑起来是纯本地的。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ⚠️ 数据目录隔离：必须在 import src/* 之前设置（config.js 加载时就把 DATA_DIR 定死）
const __testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-chime-'));
process.env.QQ_AGENT_DATA_DIR = __testDataDir;

const { Orchestrator } = await import('../src/orchestrator.js');
const { setRuntimeConfig, DEFAULT_CONFIG } = await import('../src/config.js');
const { skillManager } = await import('../src/skills/manager.js');

const CHAT = 'group:123';
const pass = [], fail = [];
async function check(name, fn) {
  try { await fn(); pass.push(name); console.log(`  ✓ ${name}`); }
  catch (e) { fail.push(name); console.error(`  ✗ ${name}\n      ${e.message}`); }
}

// ── 基础桩件 ────────────────────────────────────────────────────────────
/** store 桩：只实现 onIncoming / #runInterestJudge 用到的几个方法。 */
function makeStore2() {
  const entries = [];
  const read = new Set();
  const api = {
    entries,
    read,
    peekUnread: () => entries.filter((e) => !read.has(e.id)),
    recent: () => entries.slice(),
    markEntryRead: (_k, id) => { read.add(id); return true; },
    markAllRead: () => 0,
    getChatMeta: () => ({ unread: entries.filter((e) => !read.has(e.id)).length })
  };
  return api;
}

function makeOrchestrator(store) {
  const orch = new Orchestrator({
    store,
    memory: {},
    stickers: {},
    sender: {},
    sessions: {},
    onebot: { selfId: '999', selfNickname: '测试鲸' },
    emit: () => {},
    reminders: null,
    videoReader: null
  });
  // 只测判定接线：把"排定唤醒"换成记录，避免真的起定时器跑会话
  orch.scheduled = [];
  orch.scheduleWake = (chatKey) => { orch.scheduled.push(chatKey); };
  return orch;
}

function baseCfg(patch = {}) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.api.model = 'test-model';
  cfg.api.baseUrl = 'http://127.0.0.1:1/v1';
  cfg.api.apiKey = 'test-key';
  // 档位由滑条位置派生（contextSliderPos → contextTier），直接写 contextTier 会被覆盖。
  // 20 = 2 档（+关键词、无随机）：没有配关键词 → 原生恒不命中，判定链路必被走到。
  cfg.store.contextSliderPos = 20;
  cfg.store.historyCount = 10;
  cfg.persona.botName = '测试鲸';
  cfg.persona.participation = 'low';
  Object.assign(cfg.store, patch.store || {});
  return cfg;
}

/** 把能力提供者换成 stub；返回还原函数。 */
function stubJudge(fn) {
  const original = skillManager.getCapabilityProviders;
  skillManager.getCapabilityProviders = (name) => (name === 'reply.interest-judge' ? [{ fn }] : []);
  return () => { skillManager.getCapabilityProviders = original; };
}
function noJudge() {
  const original = skillManager.getCapabilityProviders;
  skillManager.getCapabilityProviders = () => [];
  return () => { skillManager.getCapabilityProviders = original; };
}

const entryFor = (id, text, extra = {}) => ({
  id, mid: 1000 + id, ts: Date.now(), senderId: 'u1', senderName: '群友1',
  text, self: false, read: false, isPoke: false, atMe: false, atNames: [], reply: null, ...extra
});

/** 给异步的判定跑完留出时间（判定函数本身是 await 的，stub 是同步也会走微任务）。 */
const tick = () => new Promise((r) => setTimeout(r, 20));

// ── 场景 1：判定要接 → 排定唤醒 ─────────────────────────────────────────
await check('1. 原生没命中 + 判定要接 → 排定唤醒（不再标已读）', async () => {
  setRuntimeConfig(baseCfg());
  const store = makeStore2();
  const orch = makeOrchestrator(store);
  let called = 0, gotArgs = null;
  const restore = stubJudge(async (args) => { called += 1; gotArgs = args; return { respond: true, confidence: 80, why: '在聊它的梗' }; });
  try {
    const entry = entryFor(1, '这句到底该不该接');
    store.entries.push(entry);
    orch.onIncoming(CHAT, entry);
    assert.equal(called, 1, '判定能力应被调用一次');
    await tick();   // 判定是异步的：等它回来才会排唤醒
    assert.equal(orch.scheduled.length, 1, '判定要接应排定唤醒');
    assert.deepEqual(orch.scheduled, [CHAT], '应为该群排定唤醒');
    assert.equal(store.read.has(1), false, '要接的消息不应被标已读');
    // 参数契约：插件靠这些字段拼判定提示词
    assert.equal(gotArgs.chatKey, CHAT);
    assert.equal(gotArgs.kind, 'group');
    assert.equal(gotArgs.chatId, '123');
    assert.equal(gotArgs.text, '这句到底该不该接');
    assert.ok(gotArgs.entry && gotArgs.entry.id === 1, '要传 entry 本身（插件读 senderName/isPoke）');
    assert.ok(Array.isArray(gotArgs.recent), '要传上下文 recent');
    assert.equal(gotArgs.botName, '测试鲸');
    assert.equal(gotArgs.selfId, '999');
    assert.ok(gotArgs.api && gotArgs.api.model === 'test-model', '要传当前模型配置');
    // 触发原因留在 chimeWakes 上，wake 里消费
    assert.equal(orch.chimeWakes.get(CHAT), '在聊它的梗', 'why 要带给会话（会话页解释触发原因）');
  } finally { restore(); }
});

// ── 场景 2：判定不接 → 标已读、不排唤醒 ─────────────────────────────────
await check('2. 原生没命中 + 判定不接 → 标已读、不排唤醒（零会话）', async () => {
  setRuntimeConfig(baseCfg());
  const store = makeStore2();
  const orch = makeOrchestrator(store);
  const restore = stubJudge(async () => ({ respond: false, confidence: 30, why: '别人之间的私事' }));
  try {
    const entry = entryFor(2, '张三你明天几点到');
    store.entries.push(entry);
    orch.onIncoming(CHAT, entry);
    await tick();
    assert.equal(orch.scheduled.length, 0, '判定不接不应排唤醒');
    assert.equal(store.read.has(2), true, '判定不接应把这条标已读');
  } finally { restore(); }
});

// ── 场景 3：没有能力提供者（插件没装/被关）→ 原生行为 ───────────────────
await check('3. 插件没装（取不到能力）→ 完全回到原生：标已读、不排唤醒、不报错', async () => {
  setRuntimeConfig(baseCfg());
  const store = makeStore2();
  const orch = makeOrchestrator(store);
  const restore = noJudge();
  try {
    const entry = entryFor(3, '没人接我一句话');
    store.entries.push(entry);
    orch.onIncoming(CHAT, entry);
    assert.equal(orch.scheduled.length, 0, '没有能力时不应排唤醒');
    assert.equal(store.read.has(3), true, '没有能力时应按原生标已读');
    assert.equal(orch.chimePending.size, 0, '不应残留 pending 标记');
  } finally { restore(); }
});

// ── 场景 4：1 档（仅艾特）不调判定 ─────────────────────────────────────
await check('4. 1 档（仅艾特）：非 @ 消息不调判定（用户显式要求"只认 @"）', async () => {
  const cfg = baseCfg();
  cfg.store.contextSliderPos = 0;   // 0 → 1 档（仅艾特）
  setRuntimeConfig(cfg);
  const store = makeStore2();
  const orch = makeOrchestrator(store);
  let called = 0;
  const restore = stubJudge(async () => { called += 1; return { respond: true, confidence: 99, why: '应该接' }; });
  try {
    const entry = entryFor(4, '一句普通闲聊不该触发判定');
    store.entries.push(entry);
    orch.onIncoming(CHAT, entry);
    await tick();
    assert.equal(called, 0, '1 档下判定能力不应被调用');
    assert.equal(orch.scheduled.length, 0, '1 档下不应排唤醒');
    assert.equal(store.read.has(4), true, '1 档下应与原生一致：标已读');
  } finally { restore(); }
});

// ── 场景 5：判定抛错 → fail-closed（当不接），不留 pending ──────────────
await check('5. 判定抛错 → 当"不接"处理（fail-closed），pending 被清理', async () => {
  setRuntimeConfig(baseCfg());
  const store = makeStore2();
  const orch = makeOrchestrator(store);
  const restore = stubJudge(async () => { throw new Error('判定模型超时'); });
  try {
    const entry = entryFor(5, '一句会让判定炸掉的话');
    store.entries.push(entry);
    orch.onIncoming(CHAT, entry);
    await tick();
    assert.equal(orch.scheduled.length, 0, '判定异常不应排唤醒');
    assert.equal(store.read.has(5), true, '判定异常应按"不接"标已读');
    assert.equal(orch.chimePending.size, 0, '异常路径必须清掉 pending，否则该群永久不再判定');
  } finally { restore(); }
});

// ── 场景 6：原生命中（@）时不走判定 ────────────────────────────────────
await check('6. 原生命中（被 @）时不调判定，直接按原生触发', async () => {
  setRuntimeConfig(baseCfg());
  const store = makeStore2();
  const orch = makeOrchestrator(store);
  let called = 0;
  const restore = stubJudge(async () => { called += 1; return { respond: false }; });
  try {
    const entry = entryFor(6, '@测试鲸 在吗', { atMe: true });
    store.entries.push(entry);
    orch.onIncoming(CHAT, entry);
    await tick();
    assert.equal(called, 0, '@ 命中属于原生触发，不该再问判定');
    assert.equal(orch.scheduled.length, 1, '@ 命中应直接排定唤醒');
  } finally { restore(); }
});

// ── 场景 7：判定期间并发消息不重复判定 ─────────────────────────────────
await check('7. 判定进行中又来的消息：不再打第二次判定（防并发刷成本）', async () => {
  setRuntimeConfig(baseCfg());
  const store = makeStore2();
  const orch = makeOrchestrator(store);
  let called = 0;
  let release = null;
  const restore = stubJudge(() => {
    called += 1;
    return new Promise((r) => { release = () => r({ respond: false, why: '不接' }); });
  });
  try {
    const a = entryFor(7, '第一条要判定的消息');
    const b = entryFor(8, '判定还没回来时的第二条');
    store.entries.push(a, b);
    orch.onIncoming(CHAT, a);
    assert.equal(called, 1, '第一条应发起判定');
    orch.onIncoming(CHAT, b);
    assert.equal(called, 1, '判定进行中，第二条不应再打一次判定');
    assert.equal(store.read.has(8), true, '判定进行中来的消息按原生标已读');
    release();
    await tick();
    assert.equal(orch.chimePending.size, 0, '判定结束后应释放 pending');
  } finally { restore(); }
});

try { fs.rmSync(__testDataDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n插话判定接线：通过 ${pass.length}，失败 ${fail.length}`);
if (fail.length) { console.error('失败项：\n' + fail.map((n) => `  - ${n}`).join('\n')); process.exitCode = 1; }
