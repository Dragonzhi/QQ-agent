// 内联工具调用解析 + 工具调用泄漏拦截（2026-10-30）
//
// 背景（用户实际报障）：
//   「❤️❤️永远的提瓦特大陆❤️❤️」群里机器人刷屏 finish{"summary": XXX} /
//   finish: XXX —— 模型（step-5-preview）不返回原生 tool_calls，而是把调用
//   直接写进正文（content）。核心内联解析只认 <tool_call>…</tool_call>，
//   于是这段正文落进"回复安全网"，被当成成稿抢救成一条 send_message 发进群。
//   更糟的是它随后作为"我"的发言进入【已读信息】，教模型模仿自己 → 死循环刷屏。
//
// 本测试锁住三层防线：
//   ① 裸调用形态（name{json} / name: 理由）能被识别成真实调用 → 正常收尾/发送
//   ② 识别不了的时候，窄口径的疑似判定（looksLikeToolCallText）兜底
//   ③ 正常聊天（含"时间: 8点"、提到工具名）不能被误判
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ⚠️ 数据目录隔离：必须在 import src/* 之前设置（config.js 加载时就把 DATA_DIR 定死）
process.env.QQ_AGENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-inline-'));

const { parseInlineToolCalls } = await import('../src/orchestrator.js');
const { looksLikeToolCallText } = await import('../src/util.js');

let bad = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  [ok] ${label}`); }
  catch (e) { bad++; console.log(`  [FAIL] ${label} -- ${e.message}`); }
};

// ── ① 裸调用形态必须解析成真实调用 ──
console.log('\n== 裸工具调用形态（模型把调用写成正文）==');

const parseOne = (text, names = null) => {
  const calls = parseInlineToolCalls(text, names);
  return calls.length === 1 ? calls[0] : null;
};

check('finish{"summary":"接话完成"} → finish', () => {
  const c = parseOne('finish{"summary":"接话完成"}');
  assert.ok(c, '应解析出一个调用');
  assert.equal(c.name, 'finish');
  assert.equal(c.args.summary, '接话完成');
});

check('finish { "summary": "x" }（带空格）→ finish', () => {
  const c = parseOne('finish { "summary": "x" }');
  assert.ok(c);
  assert.equal(c.name, 'finish');
  assert.equal(c.args.summary, 'x');
});

check('finish: 理由 → finish(summary=理由)', () => {
  const text = 'finish: 回应阿狗关于兑换码的疑问，调侃服务器还在加载。';
  const c = parseOne(text);
  assert.ok(c, '冒号形态应被识别');
  assert.equal(c.name, 'finish');
  assert.equal(c.args.summary, text.slice('finish: '.length));
});

check('finish：理由（全角冒号）→ finish', () => {
  const c = parseOne('finish：接话完成');
  assert.ok(c);
  assert.equal(c.name, 'finish');
  assert.equal(c.args.summary, '接话完成');
});

check('finish: {"summary":"JSON"} → finish 用 JSON 参数', () => {
  const c = parseOne('finish: {"summary":"冒号加JSON","mind":"留个念头"}');
  assert.ok(c);
  assert.equal(c.args.summary, '冒号加JSON');
  assert.equal(c.args.mind, '留个念头');
});

check('send_message{"messages":[...]} → send_message', () => {
  const c = parseOne('send_message{"messages":["你好","在吗"]}');
  assert.ok(c);
  assert.equal(c.name, 'send_message');
  assert.deepEqual(c.args.messages, ['你好', '在吗']);
});

check('send_message({"messages":[...]})（括号包裹）→ send_message', () => {
  const c = parseOne('send_message({"messages":["你好"]})');
  assert.ok(c);
  assert.equal(c.name, 'send_message');
});

check('标准 <tool_call> 协议不回归', () => {
  const c = parseOne('<tool_call>{"name":"send_message","arguments":{"messages":["hi"]}}</tool_call>');
  assert.ok(c);
  assert.equal(c.name, 'send_message');
  assert.deepEqual(c.args.messages, ['hi']);
});

// ── ② 正常聊天绝不能误判 ──
console.log('\n== 正常聊天不能被误判 ==');

for (const text of [
  '这叫蹭饭 你懂啥',
  '时间: 8点 群里集合',
  'finish 这词我记得是工具名',
  'banana(s) are good',
  '{"foo":1}',
  '接梗完成\nfinish{"summary":"x"}',   // 多行里只有一行是调用 → 不整段当调用
  'finish{"summary":"x"} 然后我又说了句人话'
]) {
  check(`不当成调用：${JSON.stringify(text)}`, () => {
    assert.deepEqual(parseInlineToolCalls(text), [], '应解析为空');
  });
}

check('未知工具名不按裸调用解析', () => {
  assert.deepEqual(parseInlineToolCalls('foo{"a":1}'), []);
});

// ── ③ 窄口径疑似判定（发送/提示词两侧共用的兜底）──
console.log('\n== looksLikeToolCallText 兜底口径 ==');

for (const text of [
  'finish{"summary":"接话完成"}',
  'finish: 接梗完成',
  'finish：接梗完成',
  'send_message{"messages":["你好"]}',
  '<tool_call>{"name":"finish"}</tool_call>',
  '{"name":"finish","arguments":{"summary":"x"}}'
]) {
  check(`判为工具调用：${JSON.stringify(text)}`, () => {
    assert.equal(looksLikeToolCallText(text), true);
  });
}

for (const text of [
  '这叫蹭饭 你懂啥',
  '时间: 8点 群里集合',
  'finish 这词我记得是工具名',
  '草 手滑了',
  'Re: 你说的那个我看了'
]) {
  check(`不判为工具调用：${JSON.stringify(text)}`, () => {
    assert.equal(looksLikeToolCallText(text), false);
  });
}

console.log(bad ? `\n${bad} 项失败\n` : '\n全部通过\n');
process.exit(bad ? 1 : 0);
