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
const { loadMemes, saveMemes } = await import('../src/group-memes.js');

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
// 消息计数（doc/plans/meme-learning-upgrade.md M1）：候选要在当天非 self 消息里
// 出现 ≥3 次才收，所以样本里给几个说法铺够次数；mid 用于断言 evidenceMids 落盘。
const CHATS = {
  [GROUP]: [
    // 甲/乙/丙梗各 3 次（供每群上限/修正用例）；低频梗只有 2 次（供频次闸用例）
    { id: 101, mid: 9001, ts: NOW - 60000, self: false, text: '甲梗 又来了' },
    { id: 102, mid: 9002, ts: NOW - 59000, self: false, text: '甲梗 真的' },
    { id: 103, mid: 9003, ts: NOW - 58000, self: false, text: '甲梗 笑死' },
    { id: 104, mid: 9004, ts: NOW - 57000, self: false, text: '乙梗 是吧' },
    { id: 105, mid: 9005, ts: NOW - 56000, self: false, text: '乙梗 哈哈' },
    { id: 106, mid: 9006, ts: NOW - 55000, self: false, text: '乙梗 行' },
    { id: 107, mid: 9007, ts: NOW - 54000, self: false, text: '丙梗 ？' },
    { id: 108, mid: 9008, ts: NOW - 53000, self: false, text: '丙梗 别' },
    { id: 109, mid: 9009, ts: NOW - 52000, self: false, text: '丙梗 好' },
    { id: 110, mid: 9010, ts: NOW - 51000, self: false, text: '低频梗出现过' },
    { id: 111, mid: 9011, ts: NOW - 50000, self: false, text: '低频梗又来了' },
    { id: 1, mid: 1001, ts: NOW - 5000, self: false, text: '终末地今天更新了' },
    { id: 2, mid: 1002, ts: NOW - 4500, self: false, text: '锄大地是真折磨' },
    { id: 3, mid: 1003, ts: NOW - 4000, self: true, text: '锄大地锄吐了' },
    { id: 4, mid: 1004, ts: NOW - 3500, self: false, text: '明天还锄大地吗' },
    { id: 5, mid: 1005, ts: NOW - 3000, self: false, text: '锄大地 我服了' },
    { id: 6, mid: 1006, ts: NOW - 2000, self: true, text: '你倒是挺勤快' },
    { id: 7, mid: 1007, ts: NOW - 1000, self: true, text: '传送点没开更折磨' }
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
    examples: JSON.stringify({ examples: [
      { trigger: '锄大地锄吐了', good: ['不锄了 我认输'], bad: ['确实'], note: '锄大地=清图刷体力\n（群里刷材料）', why: '群友跟着复述锄大地', confidence: 0.9, tags: ['吐槽'] },
      { trigger: '传送点没开更折磨', good: ['走传送点 省得来回跑'], bad: [], confidence: 0.8 },
      { trigger: '19959878509 405360', good: ['？这啥'], confidence: 0.95 },     // 随机数字：质量闸应拦下
      { trigger: '开电脑了今晚一起清本', good: ['好'], confidence: 0.95 }        // 水回复：质量闸应拦下
    ] }),
    memes: JSON.stringify({ memes: [] })
  });
  const r = await runReviewOnce({
    store: fakeStore(CHATS),
    now: NOW,
    llmCall: async (args) => { seen.push(args); return inner(args); }
  });
  assert.deepStrictEqual(r.errors, [], '不应有任何错误');
  assert.strictEqual(r.examplesDrafted, 2);
  assert.strictEqual(r.examplesDropped, 2, '随机数字与水回复应被质量闸拦下');
  assert.strictEqual(r.chatsScanned, 1);
  // 回归守卫：思考型端点的 reasoning 会先吃掉数千 token，输出预算给小了正文会被截成空串
  // （finishReason=length、正文 0 字），下游只看到「模型输出不是可解析的 JSON」（2026-10-17 线上故障，
  // 起草与群梗两路先后在 2000/8000 预算上翻车，群梗通读 4000 字群聊时思考量更大）。
  assert.ok(seen[0].maxTokens >= 10000, `起草调用必须留足输出预算，实测 ${seen[0].maxTokens}`);
  assert.ok(seen[1]?.maxTokens >= 10000, `群梗调用必须留足输出预算，实测 ${seen[1]?.maxTokens}`);
  const saved = (getConfig().persona?.examples || []).filter((e) => e.source === 'review');
  assert.strictEqual(saved.length, 2, '应写入 2 条 review 来源示例');
  assert.strictEqual(saved[0].status, 'pending', '只进待审区，不直接生效');
  assert.deepStrictEqual(saved[0].good, ['不锄了 我认输']);
  assert.strictEqual(saved[0].confidence, 0.9, 'confidence 随草稿落盘（面板按它筛）');
  assert.strictEqual(saved[0].why, '群友跟着复述锄大地', 'why（自证依据）随草稿落盘');
  // note（梗解释）随草稿落盘：换行压成单行；模型给不出时落空串而不是丢草稿
  assert.strictEqual(saved[0].note, '锄大地=清图刷体力 （群里刷材料）', 'note 应单行化后落盘');
  assert.strictEqual(saved[1].note, '', '没给 note 的条目落空串，不阻塞草稿');
  const promptText = String(seen[0].messages.find((m) => m.role === 'user')?.content ?? '');
  assert.ok(promptText.includes('note'), '起草提示词应要求顺带补 note（梗解释）');
  assert.ok(promptText.includes('confidence'), '起草提示词应要求模型自评 confidence（质量闸靠它）');
  assert.ok(promptText.includes('why'), '起草提示词应要求 why（为什么值得学）');
  // 没有群友接话的回复不进样本（id4「你倒是挺勤快」后面只有自己的话 → 应被过滤）
  assert.ok(promptText.includes('锄大地锄吐了'), '有群友接话的回复应进样本');
  assert.ok(!promptText.includes('你倒是挺勤快'), '没人接话的回复不应进任务一样本');
  return `chatsScanned=${r.chatsScanned}`;
});

// ── ② 群梗任务 ──────────────────────────────────────────────────────────
t.section('② 群梗收集：per-chat 落盘 pending');
await t.check('写进 data/group-memes/<gid>.json 且状态为 pending', async () => {
  const r = await runWith(llmByTask({
    examples: JSON.stringify({ examples: [] }),
    memes: JSON.stringify({ memes: [
      { name: '锄大地', meaning: '清图刷体力', example: '锄吐了', evidence: '当天出现 3 次，群友互相复述', confidence: 0.9 },
      { name: '没依据的梗', meaning: '听起来像梗其实只是猜测', example: '随便', confidence: 0.9 }
    ] })
  }));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.memesDrafted, 1);
  assert.ok(r.memesDropped >= 1, '没有 evidence 的候选应被拦下');
  assert.ok(fs.existsSync(path.join(dataDir, 'group-memes', '900001.json')), 'per-chat 文件路径正确');
  const { memes } = loadMemes(GROUP);
  assert.strictEqual(memes.length, 1);
  assert.strictEqual(memes[0].status, 'pending');
  assert.strictEqual(memes[0].name, '锄大地');
  assert.strictEqual(memes[0].evidence, '当天出现 3 次，群友互相复述', 'evidence 随梗落盘（面板展示）');
  assert.strictEqual(memes[0].confidence, 0.9);
  // 频次信号（M1）：当天非 self 出现 3 次 + 证据消息 id
  assert.strictEqual(memes[0].count, 3, '频次闸应记下当天非 self 出现次数');
  assert.deepStrictEqual(memes[0].evidenceMids, ['1002', '1004', '1005'], '证据消息 id 应按出现顺序落盘');
  assert.strictEqual(memes[0].inferredCount, 0, '新候选的修正基线为 0');
});

// ── ③ 弱模型输出容错 ────────────────────────────────────────────────────
t.section('③ 弱模型输出：围栏 + 前后说明文字仍可解析');
await t.check('```json 围栏包裹 → 正常起草', async () => {
  const r = await runWith(llmByTask({
    examples: '好的，结果如下：\n```json\n{"examples":[{"trigger":"你倒是挺勤快","good":["还行吧 我也刚醒"],"bad":[],"confidence":0.9,"tags":[]}]}\n```',
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

// ── ⑤ 质量闸专项（2026-10-23）──────────────────────────────────────────
// 背景：真实复盘一次收 13 条群梗 + 6 条示例，多数是普通聊天/随机数字/水回复，
// 用户人工筛不过来。这里锁住「宁可漏收，也不拿垃圾占待审位」的几道闸。
t.section('⑤ 质量闸：低可信 / 噪音 / 水回复 / 已驳回 / 无依据 一律不进待审');
await t.check('示例：已驳回的同触发句不再重收，低可信与水回复拦下', async () => {
  const { updateConfig } = await import('../src/config.js');
  updateConfig({
    persona: {
      examples: [...(getConfig().persona?.examples || []), {
        id: 'ex_rejected_seed', status: 'rejected', trigger: '老梗复投', good: ['这个不错'], bad: [],
        source: 'review', createdAt: 1, usedAt: 0
      }]
    }
  });
  const r = await runWith(llmByTask({
    examples: JSON.stringify({ examples: [
      { trigger: '老梗复投', good: ['这波可以 直接上'], confidence: 0.95 },          // 已驳回 → 去重拦
      { trigger: '低可信测试', good: ['我觉得可以先试试看'], confidence: 0.4 },        // 低可信 → 拦
      { trigger: '开电脑了', good: ['好'], confidence: 0.95 },                       // 水回复 → 拦
      { trigger: '[图片] [图片]', good: ['这图不错'], confidence: 0.95 }               // 占位符 → 拦
    ] }),
    memes: JSON.stringify({ memes: [] })
  }));
  assert.strictEqual(r.examplesDrafted, 0, '这些候选一条都不该进待审');
  assert.strictEqual(r.examplesDropped, 4, '四条都应计入拦下数');
});

await t.check('群梗：每群单次上限 2 条，无依据的候选拦下', async () => {
  const r = await runWith(llmByTask({
    examples: JSON.stringify({ examples: [] }),
    memes: JSON.stringify({ memes: [
      { name: '丁梗', meaning: '没有依据的候选说法', example: '丁', confidence: 0.9 },            // 无 evidence → 拦
      { name: '甲梗', meaning: '甲群内部黑话，指代某人', example: '甲', evidence: '出现两次，群友互相复述', confidence: 0.9 },
      { name: '乙梗', meaning: '乙群内部黑话，指代某物', example: '乙', evidence: '出现三次', confidence: 0.9 },
      { name: '丙梗', meaning: '丙群内部黑话，指代某事', example: '丙', evidence: '出现两次', confidence: 0.9 }
    ] })
  }));
  assert.strictEqual(r.memesDrafted, 2, '每群单次最多 2 条（多出来的宁可下次）');
  assert.ok(r.memesDropped >= 1, '无依据的候选应被拦下');
  const { memes } = loadMemes(GROUP);
  assert.ok(memes.every((m) => m.evidence), '落盘的群梗都必须带 evidence');
});

// ── ⑥ 频次闸（M1）──────────────────────────────────────────────────────
t.section('⑥ 频次闸：当天非 self 出现不足 3 次的候选不收');
{
  const resetGroupMemes = (list = []) => {
    try { fs.rmSync(path.join(dataDir, 'group-memes'), { recursive: true, force: true }); } catch { /* 首次无文件 */ }
    if (list.length) saveMemes(GROUP, list);
  };
  const groupLlm = (payload) => async ({ messages }) => {
    const user = String((messages || []).find((m) => m.role === 'user')?.content ?? '');
    return okResp(user.includes('群内自产梗') ? JSON.stringify(payload) : JSON.stringify({ examples: [] }));
  };
  await t.check('低频梗（2 次）被拦，够 3 次的正常收，并带 count/evidenceMids', async () => {
    resetGroupMemes();
    const r = await runReviewOnce({
      store: fakeStore(CHATS), now: NOW,
      llmCall: groupLlm({ memes: [
        { name: '低频梗', meaning: '只出现两次的说法', evidence: '今天出现两次', confidence: 0.9 },
        { name: '甲梗', meaning: '群内黑话甲', evidence: '出现三次', confidence: 0.9 }
      ] })
    });
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.memesDrafted, 1, '只有够 3 次的甲梗该进待审');
    assert.ok(r.memesDropped >= 1, '低频梗应被频次闸拦下');
    const { memes } = loadMemes(GROUP);
    assert.deepStrictEqual(memes.map((m) => m.name), ['甲梗']);
    assert.strictEqual(memes[0].count, 3);
    assert.strictEqual(memes[0].evidenceMids.length, 3);
  });

  // ── ⑦ 渐进修正（M1）──────────────────────────────────────────────────
  t.section('⑦ 渐进修正：只改 pending，active 的人工审定解释不动');
  await t.check('pending 越过 8 次阈值被修正；active 即使越阈值也忽略', async () => {
    resetGroupMemes([
      { id: 'gm_old', name: '乙梗', meaning: '旧解释', status: 'pending', count: 5, inferredCount: 0, evidence: '此前出现', confidence: 0.9, createdAt: 1 },
      { id: 'gm_human', name: '丙梗', meaning: '人工审定解释', status: 'active', count: 5, inferredCount: 0, evidence: '此前出现', confidence: 0.9, createdAt: 1 }
    ]);
    const r = await runReviewOnce({
      store: fakeStore(CHATS), now: NOW,
      llmCall: groupLlm({ memes: [], updates: [
        { name: '乙梗', meaning: '结合今天上下文修正后的解释', confidence: 0.9 },
        { name: '丙梗', meaning: '模型想改的', confidence: 0.9 }
      ] })
    });
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.memesRefined, 1, '只该有 1 条 pending 被修正');
    const { memes } = loadMemes(GROUP);
    const yi = memes.find((m) => m.name === '乙梗');
    assert.strictEqual(yi.meaning, '结合今天上下文修正后的解释', 'pending 的含义应被修正');
    assert.strictEqual(yi.count, 8, '5（历史）+ 3（今天）= 8');
    assert.strictEqual(yi.inferredCount, 8, '修正后记录推断基线，避免重复修正');
    assert.strictEqual(yi.status, 'pending', '修正不改变状态');
    const bing = memes.find((m) => m.name === '丙梗');
    assert.strictEqual(bing.meaning, '人工审定解释', 'active 的人工审定解释不允许夜间漂移');
  });

  // ── ⑧ 未知词观察表（M2）──────────────────────────────────────────────
  t.section('⑧ 未知词观察表：够 2 次且不在已收录名单才入表');
  await t.check('低频梗入观察表；已收录的百度词与没出现的词不入；文件落盘', async () => {
    resetGroupMemes([
      { id: 'gm_known', name: '甲梗', meaning: '已知的群梗', status: 'pending', evidence: '此前出现', confidence: 0.9, createdAt: 1 }
    ]);
    const r = await runReviewOnce({
      store: fakeStore(CHATS), now: NOW,
      llmCall: groupLlm({ memes: [], unknown: [
        { term: '低频梗', evidence: '今天反复出现' },
        { term: '甲梗', evidence: '已收录的梗' },
        { term: '从没出现过的词', evidence: '无' }
      ] })
    });
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.watchAdded, 1, '只有低频梗该进观察表');
    const watchFile = path.join(dataDir, 'meme-watch', '900001.json');
    assert.ok(fs.existsSync(watchFile), '观察表应写在 data/meme-watch/<gid>.json');
    const watch = JSON.parse(fs.readFileSync(watchFile, 'utf8'));
    assert.strictEqual(watch.terms.length, 1);
    assert.strictEqual(watch.terms[0].term, '低频梗');
    assert.strictEqual(watch.terms[0].count, 2, '观察词要记当天出现次数');
    assert.ok(Array.isArray(watch.terms[0].samples) && watch.terms[0].samples.length <= 2, '样例最多 2 条');
  });
}

try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
t.finish();
