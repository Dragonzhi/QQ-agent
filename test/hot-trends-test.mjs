// hot-trends 自测（2026-10-26）
//
// 这条链路解决的是一个实测出来的现象：AI-Hub 群里"大肥鱼只会报时"。
// 根因不是模型懒，而是**冷场主动唤醒时提示词里唯一会变的信息就是【当前时间】**——
// 未读为空、已读为空、没有任何材料，它只能拿时钟当话题。
// （实测：该群近 14 次主动发言里 13 次在说"两点半了/快八点了/周一最难熬"。）
//
// 三件事各自要有断言：
//   1. 冷场时把本地热点素材递进提示词（插件钩子），且关掉开关就真的不递；
//   2. 游戏来源（B站游戏区 rid=4）能抓、能进库、能优先出现在素材里；
//   3. 提示词里承诺的 hot_brief 工具真实存在（之前只有承诺、没有工具）。
//
// 运行：node test/hot-trends-test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_FILE = path.join(ROOT, 'plugins', 'hot-trend-tracker', 'index.js');
const SKILL_FILE = path.join(ROOT, 'skills', 'hot-trends', 'index.js');

// ⚠️ 必须在 import 插件**之前**改数据目录：插件在模块加载时就把 STORE_FILE 定死了，
//    晚一步改就等于测试会读写真实的 data/hot-trends.json。
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hot-trends-test-'));
process.env.QQ_AGENT_DATA_DIR = TMP;
const STORE = path.join(TMP, 'hot-trends.json');

const now = Date.now();
function fixture() {
  return {
    version: 1,
    updatedAt: now,
    lastCollectedAt: now,
    lastCollectedDay: '',
    collectedDays: [],
    sources: {},
    stats: { served: 0, injected: 0, collectRuns: 1, lastRunMs: 0 },
    topics: [
      // 最新的是贴吧条目（不游戏优先时它该排第一）
      { key: 'k-tb', title: '贴吧最新社会话题', desc: '一条社会新闻简介', sources: ['tieba'], lastSeenAt: now, firstSeenAt: now, rank: 1, url: 'https://tieba.baidu.com/x' },
      { key: 'k-bg', title: '《绝区零》新版本PV', desc: 'UP主 绝区零：新 PV 上线', sources: ['biliGame'], lastSeenAt: now - 60_000, firstSeenAt: now - 60_000, rank: 2, url: 'https://www.bilibili.com/video/BV1' },
      { key: 'k-bv', title: 'B站热门视频', desc: 'UP主 某人：一条热门', sources: ['bilibili'], lastSeenAt: now - 120_000, firstSeenAt: now - 120_000, rank: 3, url: 'https://www.bilibili.com/video/BV2' }
    ]
  };
}
function writeStore(store) { fs.writeFileSync(STORE, JSON.stringify(store, null, 1), 'utf8'); }
writeStore(fixture());

const pass = [], fail = [];
function check(name, fn) {
  try { fn(); pass.push(name); console.log(`  ✓ ${name}`); }
  catch (e) { fail.push(name); console.error(`  ✗ ${name}\n      ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); pass.push(name); console.log(`  ✓ ${name}`); }
  catch (e) { fail.push(name); console.error(`  ✗ ${name}\n      ${e.message}`); }
}

const m = await import(pathToFileURL(PLUGIN_FILE).href);
const internals = m.__internals;
const HEADER = '【冷场素材（系统自己抓的网上的事，不是群友说的）】';
const NO_TIME_HINT = '开场别再用';

/** 用给定的设置跑一次「冷场唤醒」钩子，返回被追加到 user 消息末尾的文本。 */
async function runProactiveHook(overrides = {}, messages = null) {
  const cfg = { ...defaults(), ...overrides };
  m.setup({ config: () => cfg, log: () => {}, warn: () => {} });
  const msgs = messages || [{ role: 'system', content: 'SYS' }, { role: 'user', content: '【当前时间】2026-10-26 15:24:58（周一）' }];
  const before = msgs.length;
  await m.hooks['before-llm-messages']({ messages: msgs, proactive: true, chatKey: 'group:1103398129' });
  assert.equal(msgs.length, before, '不应新增消息，只能追加到末尾');
  const last = msgs[msgs.length - 1].content;
  return { appended: last.slice('【当前时间】2026-10-26 15:24:58（周一）'.length), msgs };
}
function defaults() {
  return {
    enabled: true, collectHour: 6, catchUpOnStart: false, checkIntervalMin: 15,
    sourceBaidu: false, sourceTieba: true, sourceBilibili: true, sourceBiliGame: true,
    perSourceLimit: 20, keepDays: 7, maxTopics: 300, minDescriptionChars: 8,
    injectBrief: true, injectOnProactive: true, proactiveCount: 4, proactiveGameFirst: true,
    triggerWords: '热搜,什么梗', maxInjectChars: 480, hookCount: 5, briefDescChars: 40,
    notifyChatKey: '', maxSourceFailures: 5
  };
}

console.log(`\n[trace] 数据目录=${TMP}\n`);

// ── 1. 设置默认值：冷场递素材默认开、游戏来源默认开 ──────────────────────────
check('默认设置：injectOnProactive / sourceBiliGame / proactiveCount 都有值', () => {
  m.setup({ config: () => ({}), log: () => {}, warn: () => {} });
  const s = internals.settings();
  assert.equal(s.injectOnProactive, true, 'injectOnProactive 默认应为 true');
  assert.equal(s.sourceBiliGame, true, 'sourceBiliGame 默认应为 true');
  assert.equal(s.proactiveGameFirst, true, 'proactiveGameFirst 默认应为 true');
  assert.equal(s.proactiveCount, 4, 'proactiveCount 默认应为 4');
});

// ── 2. 游戏来源真的算进「启用的来源」────────────────────────────────────────
check('游戏来源启用时会出现在 status().sources 里（enabled=true）', () => {
  m.setup({ config: () => defaults(), log: () => {}, warn: () => {} });
  const st = m.status();
  assert.ok(st.sources.biliGame, 'status 里应有 biliGame 这一路');
  assert.equal(st.sources.biliGame.enabled, true);
  assert.equal(st.sources.biliGame.label, 'B站游戏区');
});

check('关掉 sourceBiliGame 后该来源不再启用', () => {
  m.setup({ config: () => ({ ...defaults(), sourceBiliGame: false }), log: () => {}, warn: () => {} });
  const st = m.status();
  assert.equal(st.sources.biliGame.enabled, false);
});

// ── 3. B站游戏区接口的 payload 能被统一解析器读懂 ───────────────────────────
check('parseBilibili 能解析 ranking/v2 形状（游戏区）的 payload', () => {
  const json = {
    code: 0,
    data: {
      list: [
        { title: '《鸣潮》0.1版本PV', desc: '新 PV\n第二行', owner: { name: '鸣潮' }, bvid: 'BV1abc' },
        { title: '', desc: '空标题应被跳过', owner: { name: 'x' } }
      ]
    }
  };
  const out = m.parseBilibili(json, 20);
  assert.equal(out.length, 1, '空标题条目应被跳过');
  assert.equal(out[0].title, '《鸣潮》0.1版本PV');
  assert.ok(out[0].desc.includes('UP主 鸣潮'), '简介里应带 UP 主，且换行要压平');
  assert.ok(!out[0].desc.includes('\n'), '简介里的换行必须压平');
  assert.ok(out[0].url.includes('BV1abc'));
});

// ── 4. 素材排序：游戏优先会把游戏条目顶上来（这正是"报时"的解药）─────────
check('brief 不指定偏好时按时间排序（最新在前）', () => {
  m.setup({ config: () => defaults(), log: () => {}, warn: () => {} });
  const r = m.brief({ limit: 3, maxChars: 2000, descChars: 20 });
  assert.equal(r.count, 3);
  assert.ok(r.text.includes('贴吧最新社会话题'), r.text);
  assert.ok(r.text.indexOf('贴吧最新社会话题') < r.text.indexOf('《绝区零》新版本PV'), '最新条目应在前');
});

check('brief 传 preferSources=[biliGame] 时游戏条目排第一', () => {
  m.setup({ config: () => defaults(), log: () => {}, warn: () => {} });
  const r = m.brief({ limit: 3, maxChars: 2000, descChars: 20, preferSources: ['biliGame'] });
  const lines = r.text.split('\n').filter((l) => l.startsWith('· '));
  assert.ok(lines[0].includes('《绝区零》新版本PV'), `第一条应是游戏条目，实际：${lines[0]}`);
});

// ── 5. 核心：冷场唤醒时把素材递进提示词 ────────────────────────────────────
await checkAsync('冷场唤醒：提示词末尾追加了素材块（含"别报时间"的提醒）', async () => {
  const { appended } = await runProactiveHook();
  assert.ok(appended.includes(HEADER), '应有冷场素材标题');
  assert.ok(appended.includes(NO_TIME_HINT), '应有"别报时间"的提醒');
  assert.ok(appended.includes('· '), '应带上具体条目');
  assert.ok(appended.length > 200, `素材块太短：${appended.length}`);
});

await checkAsync('冷场唤醒：游戏优先时素材首条是游戏资讯', async () => {
  const { appended } = await runProactiveHook({ proactiveGameFirst: true });
  const firstItem = appended.split('\n').find((l) => l.startsWith('· '));
  assert.ok(firstItem.includes('绝区零'), `首条应是游戏条目，实际：${firstItem}`);
});

await checkAsync('冷场唤醒：关掉 injectOnProactive 就一个字都不加', async () => {
  const { appended } = await runProactiveHook({ injectOnProactive: false });
  assert.equal(appended, '', `不应追加任何内容，实际追加了 ${appended.length} 字`);
});

await checkAsync('普通唤醒（proactive=false）不递冷场素材', async () => {
  m.setup({ config: () => defaults(), log: () => {}, warn: () => {} });
  const msgs = [{ role: 'system', content: 'SYS' }, { role: 'user', content: '【当前时间】2026-10-26 15:24:58（周一）' }];
  await m.hooks['before-llm-messages']({ messages: msgs, proactive: false });
  assert.ok(!msgs[1].content.includes(HEADER), '普通唤醒不该出现冷场素材');
});

await checkAsync('普通唤醒命中触发词：走老的小抄路径（不是冷场素材）', async () => {
  m.setup({ config: () => defaults(), log: () => {}, warn: () => {} });
  const msgs = [{ role: 'system', content: 'SYS' }, { role: 'user', content: '最近有什么热搜' }];
  await m.hooks['before-llm-messages']({ messages: msgs, proactive: false });
  assert.ok(msgs[1].content.includes('【最近网上的热点'), '应走触发词小抄');
  assert.ok(!msgs[1].content.includes(HEADER), '不应混入冷场素材');
});

await checkAsync('幂等：同一份消息被处理两次也只追加一份素材', async () => {
  const cfg = defaults();
  m.setup({ config: () => cfg, log: () => {}, warn: () => {} });
  const msgs = [{ role: 'system', content: 'SYS' }, { role: 'user', content: '【当前时间】x' }];
  await m.hooks['before-llm-messages']({ messages: msgs, proactive: true });
  await m.hooks['before-llm-messages']({ messages: msgs, proactive: true });
  const count = msgs[1].content.split(HEADER).length - 1;
  assert.equal(count, 1, `素材块只应出现一次，实际 ${count} 次`);
});

await checkAsync('知识库为空时安静跳过（不递一个空标题过去）', async () => {
  writeStore({ ...fixture(), topics: [] });
  const { appended } = await runProactiveHook();
  assert.equal(appended, '', `空库不应注入，实际注入 ${appended.length} 字`);
  writeStore(fixture());   // 复原，后面还要用
});

await checkAsync('轮换：连续几次冷场拿到的不是同一份清单', async () => {
  // 反例来由：一天可能有 3~4 次冷场，若每次都是同样的 4 条，
  // 模型很容易顺手复读同一句（"这个 EP 出了"连说三遍）。
  const topics = [];
  for (let i = 0; i < 14; i += 1) {
    topics.push({ key: `g${i}`, title: `游戏条目${i}`, desc: '简介', sources: ['biliGame'], lastSeenAt: now - i * 1000, firstSeenAt: now - i * 1000, rank: i + 1, url: '' });
  }
  writeStore({ ...fixture(), topics });
  const firsts = [];
  for (let i = 0; i < 3; i += 1) {
    const { appended } = await runProactiveHook();
    firsts.push(appended.split('\n').find((l) => l.startsWith('· ')) || '');
  }
  assert.ok(new Set(firsts).size >= 2, `三次冷场应至少换两段，实际每次都一样：${firsts[0]}`);
  writeStore(fixture());
});

// ── 5b. 旧闻防线（2026-10-26 事故：把去年的 PV 当新游发进群）─────────────────
check('parseBiliGame 只保留游戏分区，并带回发布时间', () => {
  const json = {
    code: 0,
    data: {
      list: [
        { title: '【2026全球总决赛】IG vs HLE', tname: '电子竞技', desc: '赛事', owner: { name: '赛事' }, pubdate: 1792951186, bvid: 'BV1x' },
        { title: '日本人吃自助', tname: '美食侦探', desc: '吃的', owner: { name: 'x' }, pubdate: 1792951186, bvid: 'BV2x' },
        { title: '鸣潮世界观PV', tname: '手机游戏', desc: '新PV', owner: { name: '鸣潮' }, pubdate: 1792900000, bvid: 'BV3x' }
      ]
    }
  };
  const out = m.parseBiliGame(json, 20);
  assert.equal(out.length, 2, '应只剩 2 条游戏类');
  assert.ok(out.every((x) => /游戏|电子竞技/.test(x.tname)), `混进了非游戏类：${out.map((x) => x.tname)}`);
  assert.equal(out[0].pubAt, 1792951186 * 1000, 'pubAt 应换算成毫秒');
});

check('filterFreshItems：全旧 → allStale（上层据此判失败，避免永远喂旧闻）', () => {
  const now = Date.now();
  const day = 86400000;
  const stale = [1, 2, 3].map((i) => ({ title: `旧${i}`, pubAt: now - 573 * day }));
  const r = m.filterFreshItems(stale, 3, now);
  assert.equal(r.allStale, true);
  assert.equal(r.fresh.length, 0);
  assert.ok(r.oldestDays >= 570, `最老天数应≈573，实际 ${r.oldestDays}`);
});

check('filterFreshItems：旧的丢掉、新的留下', () => {
  const now = Date.now();
  const day = 86400000;
  const items = [
    { title: '今天', pubAt: now - 3600 * 1000 },
    { title: '两天前', pubAt: now - 2 * day },
    { title: '十天前', pubAt: now - 10 * day }
  ];
  const r = m.filterFreshItems(items, 3, now);
  assert.deepEqual(new Set(r.fresh.map((x) => x.title)), new Set(['今天', '两天前']));
  assert.equal(r.dropped, 1);
  assert.equal(r.allStale, false);
});

check('filterFreshItems：没有发布时间的来源（贴吧/百度）一条不丢', () => {
  const now = Date.now();
  const r = m.filterFreshItems([{ title: '贴吧话题' }, { title: '百度热搜' }], 3, now);
  assert.equal(r.fresh.length, 2);
  assert.equal(r.dropped, 0);
  assert.equal(r.allStale, false);
});

check('ageText：今天 / 昨天 / N天前，没时间返回空串', () => {
  const now = Date.now();
  assert.equal(m.ageText(now - 1000, now), '今天');
  assert.equal(m.ageText(now - 86400000, now), '昨天');
  assert.equal(m.ageText(now - 3 * 86400000, now), '3天前');
  assert.equal(m.ageText(0, now), '', '没有发布时间必须返回空串，不能假装是今天');
});

check('pruneTopics：清掉 1.2.0 之前没时间戳的 B 站老条目 + 太旧条目，贴吧保留', () => {
  const now = Date.now();
  const s = { ...defaults(), maxAgeDays: 3, keepDays: 7, maxTopics: 300 };
  const topics = [
    // 事故现场：旧版存进来的 B 站条目，没有 pubAt，看不出来是哪年的
    { key: 'legacy', title: '去年那个PV', sources: ['biliGame'], lastSeenAt: now, firstSeenAt: now },
    { key: 'stale', title: '十天前的热门', sources: ['bilibili'], pubAt: now - 10 * 86400000, lastSeenAt: now, firstSeenAt: now },
    { key: 'ok', title: '今天的游戏视频', sources: ['biliGame'], pubAt: now - 3600 * 1000, lastSeenAt: now, firstSeenAt: now },
    { key: 'tieba', title: '贴吧热议', sources: ['tieba'], lastSeenAt: now, firstSeenAt: now }
  ];
  const kept = internals.pruneTopics(topics, s, now).map((t) => t.key);
  assert.deepEqual(kept.sort(), ['ok', 'tieba'], `应只留 ok/tieba，实际 ${kept}`);
});

check('query/brief 不返回超过 maxAgeDays 的内容（哪怕 lastSeenAt 是刚更新的）', () => {
  // 事故的精确机理：一条 573 天前的视频今天又被抓进来，lastSeenAt 变成"刚刚"，
  // 只看 lastSeenAt 的话它照样算新鲜 —— 所以必须再按 pubAt 卡一道。
  writeStore({
    ...fixture(),
    topics: [
      { key: 'old', title: '去年那个PV', desc: 'x', sources: ['biliGame'], pubAt: now - 573 * 86400000, lastSeenAt: now, firstSeenAt: now, rank: 1, url: '' },
      { key: 'new', title: '今天的视频', desc: 'y', sources: ['biliGame'], pubAt: now - 3600 * 1000, lastSeenAt: now, firstSeenAt: now, rank: 2, url: '' }
    ]
  });
  m.setup({ config: () => defaults(), log: () => {}, warn: () => {} });
  const r = m.query({ limit: 10 });
  assert.equal(r.returned, 1, `只该剩今天的，实际返回 ${r.returned} 条`);
  assert.equal(r.topics[0].title, '今天的视频');
  writeStore(fixture());
});

check('brief 的行里带发布时间（模型才能自己判断新不新）', () => {
  writeStore({
    ...fixture(),
    topics: [{ key: 'fresh', title: '今天的游戏视频', desc: '简介', sources: ['biliGame'], pubAt: now - 3600 * 1000, lastSeenAt: now, firstSeenAt: now, rank: 1, url: '' }]
  });
  m.setup({ config: () => defaults(), log: () => {}, warn: () => {} });
  const r = m.brief({ limit: 3, maxChars: 2000, descChars: 10 });
  assert.ok(r.text.includes('（今天）'), `素材里应标出发布时间，实际：${r.text}`);
  writeStore(fixture());
});

// ── 6. 提示词里承诺的 hot_brief 工具必须真实存在 ───────────────────────────
await checkAsync('技能注册了 hot_brief / hot_query / hot_status 三个工具', async () => {
  const skill = await import(pathToFileURL(SKILL_FILE).href);
  const tools = new Map();
  skill.register({
    config: () => ({ briefCount: 5, briefChars: 480, queryCount: 8 }),
    capability: () => undefined,
    registerTool: (def) => tools.set(def.id, def)
  });
  assert.deepEqual([...tools.keys()].sort(), ['hot_brief', 'hot_query', 'hot_status']);
  for (const [id, def] of tools) {
    assert.ok(def.name && def.description, `${id} 缺少 name/description`);
    assert.ok(def.parameters && def.parameters.type === 'object', `${id} 的 parameters 不合法`);
    assert.equal(typeof def.execute, 'function', `${id} 缺少 execute`);
  }
});

await checkAsync('hot_brief 能取到能力提供方给的内容', async () => {
  const skill = await import(pathToFileURL(SKILL_FILE).href);
  const tools = new Map();
  skill.register({
    config: () => ({ briefCount: 5, briefChars: 480, queryCount: 8 }),
    capability: (name, args) => {
      assert.equal(name, 'knowledge.hot-trends');
      assert.equal(args.action, 'brief');
      assert.deepEqual(args.preferSources, ['biliGame'], '默认应要求游戏优先');
      return { ok: true, text: '【最近网上的热点】\n· 假条目', count: 1 };
    },
    registerTool: (def) => tools.set(def.id, def)
  });
  const r = await tools.get('hot_brief').execute({}, {});
  assert.ok(r.content.includes('假条目'));
  assert.ok(!r.isError);
});

await checkAsync('插件没启用（能力取不到）时如实报不可用，不假装有数据', async () => {
  const skill = await import(pathToFileURL(SKILL_FILE).href);
  const tools = new Map();
  skill.register({
    config: () => ({}),
    capability: () => undefined,
    registerTool: (def) => tools.set(def.id, def)
  });
  for (const id of ['hot_brief', 'hot_query', 'hot_status']) {
    const args = id === 'hot_query' ? { query: '星穹铁道' } : {};
    const r = await tools.get(id).execute({}, args);
    assert.equal(r.isError, true, `${id} 应报错`);
    assert.ok(r.content.includes('hot-trend-tracker'), `${id} 的报错应指出是插件没启用`);
  }
});

await checkAsync('hot_query 空关键词直接拒绝', async () => {
  const skill = await import(pathToFileURL(SKILL_FILE).href);
  const tools = new Map();
  skill.register({ config: () => ({}), capability: () => ({ ok: true, returned: 0, total: 0, fresh: 0 }), registerTool: (d) => tools.set(d.id, d) });
  const r = await tools.get('hot_query').execute({}, { query: '   ' });
  assert.equal(r.isError, true);
});

// ── 收尾 ──────────────────────────────────────────────────────────────────
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 临时目录删不掉无所谓 */ }

console.log(`\n通过 ${pass.length} / ${pass.length + fail.length}`);
if (fail.length) {
  console.error(`失败 ${fail.length} 项：${fail.join('、')}`);
  process.exit(1);
}
console.log('全部通过 ✅');
