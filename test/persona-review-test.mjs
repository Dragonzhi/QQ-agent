// 每晚复盘（src/persona-review.js，doc/persona-meme-plan.md P2）自测。
// 重点锁住「LLM 返回结构契约」：chatCompletion 返回扁平结构 { message, usage, raw, … }，
// **不是** OpenAI 原始响应的 { choices:[…] } —— 读错会让整轮复盘静默丢弃，
// 表现为「模型输出不是可解析的 JSON」（2026-10-17 线上实际故障）。
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 数据目录隔离：必须在 import src/* 之前设置（config.js 模块加载时把 DATA_DIR 定死）。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-review-'));
process.env.QQ_AGENT_DATA_DIR = dataDir;

const { createChecker } = await import('./_harness.mjs');
const t = createChecker('每晚复盘');
const { runReviewOnce } = await import('../src/persona-review.js');
const { getConfig } = await import('../src/config.js');
const { loadMemes } = await import('../src/group-memes.js');

const NOW = Date.now();
const GROUP = 'group:900001';

// 假 store：与真 ChatStore 同约定（listChats + recent 正序、limit 生效、条目含 self/text/ts）。
// 群内 3 条 self：低于 collectGroups 的 selfCount < 3 门槛的群会被整群跳过。
function fakeStore(chats) {
  return {
    listChats: () => Object.keys(chats),
    recent: (chatKey, { limit = 80 } = {}) => (chats[chatKey] || []).slice(-limit)
  };
}
const CHATS = {
  [GROUP]: [
    { id: 1, ts: NOW - 5000, self: false, text: '终末地今天更新了' },
    { id: 2, ts: NOW - 4000, self: true, text: '锄大地锄吐了' },
    { id: 3, ts: NOW - 3000, self: false, text: '哈哈哈哈' },
    { id: 4, ts: NOW - 2000, self: true, text: '你倒是挺勤快' },
    { id: 5, ts: NOW - 1000, self: true, text: '传送点没开更折磨' }
  ]
};

// chatCompletion 的真实返回形状：message 在顶层（关键契约）
const okResp = (content) => ({
  message: { role: 'assistant', content },
  finishReason: 'stop',
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  raw: {}
});
// 按任务分派：用户消息里含「群内自产梗」的是任务二（群梗），其余是任务一（起草示例）
const llmByTask = ({ examples, memes }) => async ({ messages }) => {
  const user = String((messages || []).find((m) => m.role === 'user')?.content ?? '');
  return okResp(user.includes('群内自产梗') ? memes : examples);
};
const runWith = (llmCall) => runReviewOnce({ store: fakeStore(CHATS), now: NOW, llmCall });

// ── ① 正常返回 ──────────────────────────────────────────────────────────
t.section('① 扁平结构 message.content → 解析成功');
await t.check('起草示例落进 config.persona.examples（source=review、status=pending）', async () => {
  const seen = [];
  const inner = llmByTask({
    examples: JSON.stringify({ examples: [{ trigger: '锄大地锄吐了', good: ['受着'], bad: ['确实'], tags: ['吐槽'] }] }),
    memes: JSON.stringify({ memes: [] })
  });
  const r = await runReviewOnce({
    store: fakeStore(CHATS),
    now: NOW,
    llmCall: async (args) => { seen.push(args); return inner(args); }
  });
  assert.deepStrictEqual(r.errors, [], '不应有任何错误');
  assert.strictEqual(r.examplesDrafted, 1);
  assert.strictEqual(r.chatsScanned, 1);
  // 回归守卫：思考型端点的 reasoning 会先吃掉数千 token，输出预算给小了正文会被截成空串
  // （finishReason=length、正文 0 字），下游只看到「模型输出不是可解析的 JSON」（2026-10-17 线上故障，
  // 起草与群梗两路先后在 2000/8000 预算上翻车，群梗通读 4000 字群聊时思考量更大）。
  assert.ok(seen[0].maxTokens >= 10000, `起草调用必须留足输出预算，实测 ${seen[0].maxTokens}`);
  assert.ok(seen[1]?.maxTokens >= 10000, `群梗调用必须留足输出预算，实测 ${seen[1]?.maxTokens}`);
  const saved = (getConfig().persona?.examples || []).filter((e) => e.source === 'review');
  assert.strictEqual(saved.length, 1, '应写入 1 条 review 来源示例');
  assert.strictEqual(saved[0].status, 'pending', '只进待审区，不直接生效');
  assert.deepStrictEqual(saved[0].good, ['受着']);
  return `chatsScanned=${r.chatsScanned}`;
});

// ── ② 群梗任务 ──────────────────────────────────────────────────────────
t.section('② 群梗收集：per-chat 落盘 pending');
await t.check('写进 data/group-memes/<gid>.json 且状态为 pending', async () => {
  const r = await runWith(llmByTask({
    examples: JSON.stringify({ examples: [] }),
    memes: JSON.stringify({ memes: [{ name: '锄大地', meaning: '清图刷体力', example: '锄吐了' }] })
  }));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.memesDrafted, 1);
  assert.ok(fs.existsSync(path.join(dataDir, 'group-memes', '900001.json')), 'per-chat 文件路径正确');
  const { memes } = loadMemes(GROUP);
  assert.strictEqual(memes.length, 1);
  assert.strictEqual(memes[0].status, 'pending');
  assert.strictEqual(memes[0].name, '锄大地');
});

// ── ③ 弱模型输出容错 ────────────────────────────────────────────────────
t.section('③ 弱模型输出：围栏 + 前后说明文字仍可解析');
await t.check('```json 围栏包裹 → 正常起草', async () => {
  const r = await runWith(llmByTask({
    examples: '好的，结果如下：\n```json\n{"examples":[{"trigger":"你倒是挺勤快","good":["还行吧"],"bad":[],"tags":[]}]}\n```',
    memes: '{"memes":[]}'
  }));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.examplesDrafted, 1);
});

// ── ④ 契约回归 ──────────────────────────────────────────────────────────
// 反向锁：若有人把 persona-review 改回读 OpenAI 原始形状（.choices[0].message），
// 这个用例会立刻失败 —— 因为那时「flat 结构」取不到内容、而「choices 结构」反而被当成功。
t.section('④ 契约回归：OpenAI 原始形状 { choices:[…] } 必须判失败');
await t.check('返回 { choices:[…] } → 记错误、零产出，绝不静默当成功', async () => {
  const r = await runWith(async () => ({
    choices: [{ message: { role: 'assistant', content: '{"examples":[{"trigger":"x","good":["y"],"bad":[],"tags":[]}]}' } }],
    usage: {}
  }));
  assert.strictEqual(r.examplesDrafted, 0, 'choices 形状取不到正文，不该起草出示例');
  assert.strictEqual(r.memesDrafted, 0);
  assert.ok(r.errors.length >= 1, '结构与契约不符时应显式记错误');
});

try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
t.finish();
