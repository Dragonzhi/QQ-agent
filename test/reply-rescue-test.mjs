// reply-guard（回复安全网）自测 + 历史回放（2026-10-25）
//
// 背景：核心 src/reply-rescue.js 依赖的能力提供方一直是空的，导致"模型把要说的话
// 写在正文里、群友什么都收不到"从来没被抢救过。本插件补齐 reply.is-planning-text
// 与 reply.loose-send。
//
// 这条链路的判错方向不对称：**漏救 = 少说一句；错救 = 内心戏发进群**。
// 所以这里两类断言都要有：该救的必须救回来，不该救的一条都不许救。
//
// 运行：
//   node test/reply-rescue-test.mjs            # 夹具断言
//   node test/reply-rescue-test.mjs --replay   # 额外把历史会话全量回放一遍（只统计+抽样）
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(ROOT, 'plugins', 'reply-guard', 'index.js');
if (!fs.existsSync(PLUGIN)) {
  console.log('⚠ 跳过：plugins/reply-guard 未安装（plugins/ 不入库）');
  process.exit(0);
}

const mod = await import(pathToFileURL(PLUGIN).href);
const { isPlanningText, looseSend } = mod;
const pass = [], fail = [];
function check(name, fn) {
  try { fn(); pass.push(name); console.log(`  ✓ ${name}`); }
  catch (e) { fail.push(name); console.error(`  ✗ ${name}\n      ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); pass.push(name); console.log(`  ✓ ${name}`); }
  catch (e) { fail.push(name); console.error(`  ✗ ${name}\n      ${e.message}`); }
}

// ── 1. 必须救回来的（真实历史样本）─────────────────────────────────────────
const MUST_RESCUE = [
  ['这不是我吗\n\n蓝毛鲸尾女仆 特征全对上了', 2],
  ['这叫蹭饭 你懂啥', 1],
  ['["让我看的就这？","这种我不接 找别的AI去吧"]', 2],
  ['收款成功（并没有）\n完整版已解锁：会聊天会怼人还会要钱', 2],
  ['我啊 女仆版 换个姿势而已\n\n比个框框是想把我裱起来？', 2],
  ['鸟都不鸟我还打字回我', 1],
  ['茄子又背锅了是吧', 1],
  ['周六做项目 老板也太狠了', 1],
  ['**真香**', 1]                      // Markdown 粗体痕迹要去掉
];

check('1. 真实成稿样本都能被抽出来，且不夹带 Markdown 痕迹', () => {
  for (const [text, want] of MUST_RESCUE) {
    assert.equal(isPlanningText({ text }).planning, false, `不该被判为计划腔：${JSON.stringify(text)}`);
    const got = looseSend({ text }).messages;
    assert.equal(got.length, want, `应抽出 ${want} 条，实际 ${got.length}：${JSON.stringify(got)}  ← 原文 ${JSON.stringify(text)}`);
    for (const m of got) {
      assert.ok(!m.includes('**'), `抽出的句子不该留 Markdown：${JSON.stringify(m)}`);
      assert.ok(/[\u4e00-\u9fa5]/.test(m), `抽出的句子应含汉字：${JSON.stringify(m)}`);
    }
  }
});

check('2. JSON 数组形态：按数组元素还原成多条', () => {
  const got = looseSend({ text: '["让我看的就这？","这种我不接 找别的AI去吧"]' }).messages;
  assert.deepEqual(got, ['让我看的就这？', '这种我不接 找别的AI去吧']);
});

check('3. 单条超长的行不会被当成成稿', () => {
  const long = '这是一句非常长的话'.repeat(6);       // 60 字 > 默认 40
  assert.deepEqual(looseSend({ text: long }).messages, []);
});

// ── 4. 绝对不能救的（内心戏/计划腔/旁白）────────────────────────────────────
const MUST_NOT = [
  '（这轮没我什么事，安静看着就行）',
  '话题随缘，先安静看后续。',
  '不够明白这轮不用接，安静看他们聊装机就行。',
  '问就答完了，不用再补。',
  '【深度思考】\n有人发图并@我问这是谁。我需要看图。',
  '让我看看这张图',
  '我该回一句 这不是我吗',
  '两个候选：1. 这不是我吗 2. 你不是瞎吗',
  '- 这不是我吗\n- 那不是你吗',
  'The user asked who this is. I should reply.',
  '',
  '……',
  '我想想怎么回，先看看上下文',
  '我得调用 get_message_images 看那张图',
  // ↓ 回放历史时发现的收尾旁白（第一版规则会误救，真发到群里就是社死）
  '还发不发了，不发了就结束。',
  '拍回去了，闲聊告一段落，等他接招。',
  '收了张高清的自己，美滋滋，这轮结束。',
  '表情已经把态度发过去了，等他接招就行，不再多嘴。',
  '这轮就先这样。',
  '话发齐了，收工。',
  '回完了，票投给鸣潮活命。',
  '哈哈这张脸好欠揍，继续怼回去就行了。'
];

check('4. 内心戏/计划腔/工具旁白一条都不许救（错救比漏救严重）', () => {
  for (const text of MUST_NOT) {
    const msgs = looseSend({ text }).messages;
    assert.equal(msgs.length, 0, `不该抢救却抽出了 ${JSON.stringify(msgs)}  ← 原文 ${JSON.stringify(text)}`);
  }
});

check('5. isPlanningText 对空/英文/超长一律判否', () => {
  assert.equal(isPlanningText({ text: '' }).planning, true);
  assert.equal(isPlanningText({ text: 'The user asked who this is.' }).planning, true);
  assert.equal(isPlanningText({ text: '长'.repeat(300) }).planning, true);
  assert.equal(isPlanningText({ text: '这叫蹭饭 你懂啥' }).planning, false);
});

check('6. 设置项生效：maxMessages / maxCharsPerMessage', () => {
  // settings 读的是 api.config()，这里直接用 __internals 验证默认值口径
  const s = mod.__internals.settings();
  assert.equal(s.maxMessages, 2);
  assert.equal(s.maxChars, 40);
  assert.equal(s.enabled, true);
  // 三条候选只取两条
  const got = looseSend({ text: '这叫蹭饭 你懂啥\n鸟都不鸟我还打字回我\n茄子又背锅了是吧' }).messages;
  assert.equal(got.length, 2, `默认最多 2 条，实际 ${got.length}`);
});

// ── 7. 插件清单自洽 ───────────────────────────────────────────────────────
check('7. 清单声明的能力与 providers 对得上', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', 'reply-guard', 'plugin.json'), 'utf8'));
  assert.equal(manifest.id, 'reply-guard');
  const declared = new Set(manifest.capabilities || []);
  for (const name of Object.keys(mod.providers)) {
    assert.ok(declared.has(name), `providers 里的 ${name} 没在 manifest.capabilities 声明`);
    assert.ok(/^[a-z][a-z0-9]*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/.test(name), `能力名不是小写点分格式：${name}`);
  }
  for (const name of declared) {
    assert.ok(mod.providers[name], `manifest 声明了 ${name} 但 providers 没实现`);
  }
  for (const key of Object.keys(manifest.settings || {})) {
    assert.ok(manifest.configSchema[key], `settings.${key} 缺 configSchema`);
  }
});

// ── 7b. 与核心安全网串起来跑一遍（这是真正会生效的那条链路）─────────────
// reply-rescue.js 依赖五个能力，本插件提供前两个；这里用真的核心函数 + 真的插件
// 导出走一遍，确认「正文 → 合成 send_message 调用」这段能通。
await checkAsync('7b. 与核心安全网串起来：正文能合成 send_message，内心戏不会', async () => {
  const { rescueUnsentReply } = await import(pathToFileURL(path.join(ROOT, 'src', 'reply-rescue.js')).href);  const capMap = {
    'reply.is-planning-text': isPlanningText,
    'reply.loose-send': looseSend
  };
  const cap = (name) => (typeof capMap[name] === 'function' ? capMap[name] : null);

  const got = await rescueUnsentReply({
    text: '这不是我吗\n\n蓝毛鲸尾女仆 特征全对上了',
    trigger: 'nalug：这个图片是谁',
    sent: [],
    cap
  });
  assert.equal(got.length, 1, '应合成一条 tool_call');
  assert.equal(got[0].function.name, 'send_message');
  const args = JSON.parse(got[0].function.arguments);
  assert.deepEqual(args.messages, ['这不是我吗', '蓝毛鲸尾女仆 特征全对上了'], '应原样搬运两句话');

  const none = await rescueUnsentReply({
    text: '（这轮没我什么事，安静看着就行）',
    trigger: '张三：今天谁打本',
    sent: [],
    cap
  });
  assert.equal(none.length, 0, '内心戏不能被抢救成发送');
});

// ── 8. 历史回放（可选，只统计与抽样，不做断言）──────────────────────────────
if (process.argv.includes('--replay')) {
  const dir = path.join(ROOT, 'data', 'sessions');
  if (!fs.existsSync(dir)) {
    console.log('\n⚠ 没有 data/sessions，跳过回放');
  } else {
    let scanned = 0, candidateSessions = 0, rescuedSessions = 0, rescuedMsgs = 0;
    const rescuedSamples = [];
    const rejectedSamples = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      let s;
      try { s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      scanned += 1;
      let hit = false;
      for (const m of s.messages || []) {
        if (m.role !== 'assistant') continue;
        const text = String(m.content || '').trim();
        if (!text || /【深度思考】/.test(text)) continue;
        const tools = (m.tool_calls || []).map((tc) => tc?.function?.name).filter(Boolean);
        if (tools.includes('send_message')) continue;
        hit = true;
        const msgs = looseSend({ text }).messages;
        if (msgs.length) {
          rescuedMsgs += msgs.length;
          if (rescuedSamples.length < 40) rescuedSamples.push({ text: text.slice(0, 50), msgs });
        } else if (rejectedSamples.length < 10) {
          rejectedSamples.push(text.slice(0, 50));
        }
      }
      if (hit) candidateSessions += 1;
      if (hit) {
        // 该会话至少有一轮能被救
        const any = (s.messages || []).some((m) => m.role === 'assistant'
          && String(m.content || '').trim()
          && !/【深度思考】/.test(String(m.content || ''))
          && !((m.tool_calls || []).map((tc) => tc?.function?.name).includes('send_message'))
          && looseSend({ text: String(m.content || '') }).messages.length);
        if (any) rescuedSessions += 1;
      }
    }
    console.log(`\n=== 历史回放（${scanned} 个会话）===`);
    console.log(`有"正文成稿"的会话: ${candidateSessions}；其中至少一轮能被救回: ${rescuedSessions}；累计可救消息 ${rescuedMsgs} 条`);
    console.log('\n-- 会救回的样子（抽 40 条，人工核对是否都是正经话）--');
    for (const x of rescuedSamples) console.log(`  ${JSON.stringify(x.msgs)}   ← 原文 ${JSON.stringify(x.text)}`);
    console.log('\n-- 会放弃的样子（抽 10 条，人工核对是否都是内心戏）--');
    for (const t of rejectedSamples) console.log(`  ${JSON.stringify(t)}`);
  }
}

console.log(`\n回复安全网：通过 ${pass.length}，失败 ${fail.length}`);
if (fail.length) { console.error('失败项：\n' + fail.map((n) => `  - ${n}`).join('\n')); process.exitCode = 1; }
