// 心事本单元测试：per-chat 存储 / 截断 / TTL / 开关 / 渲染。
// 运行：node test/mind-test.mjs
// ⚠️ 必须在 import src/mind.js 之前指定临时数据目录 —— config.js 在模块加载时
//    就确定 DATA_DIR，晚了会写进真实 data/。
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-mind-'));
process.env.QQ_AGENT_DATA_DIR = tmp;

const { saveMind, loadMind, clearMind, formatMind, mindFileFor, isMeaningfulMind, resolveMind } = await import('../src/mind.js');
const { updateConfig } = await import('../src/config.js');

const CHAT = 'group:592931715';

// 1. 路径：只接受合法 chatKey
assert.equal(mindFileFor(CHAT), path.join(tmp, 'mind', 'group_592931715.json'));
assert.equal(mindFileFor('group:../../etc/passwd'), null, '路径穿越必须拒绝');
assert.equal(mindFileFor('group:abc'), null, '非纯数字 id 必须拒绝');
assert.equal(mindFileFor(''), null);

// 2. 存 → 读
assert.equal(saveMind(CHAT, '被连叫两声大肥鱼有点烦，但没炸；想问版本，憋着没问。'), true);
const note = loadMind(CHAT);
assert.ok(note, '保存后应能读回');
assert.ok(note.text.includes('大肥鱼'));
assert.ok(note.expiresAt > Date.now(), '过期时间应在未来');

// 3. 截断：超过 maxChars（默认 160）只保留上限
saveMind(CHAT, '啊'.repeat(500));
assert.equal(loadMind(CHAT).text.length, 160, '超长心事必须截断到 maxChars');

// 4. 太短 / 占位内容不落盘
assert.equal(saveMind(CHAT, '无'), false);
assert.equal(saveMind(CHAT, '   '), false);

// 4b. 质量闸：真实脏样本一条都不许落盘（2026-10-30 线上 6 个文件全是这些）
const DIRTY = [
  'finish',
  'finish{"summary":"接话完成"}',
  'finish: 已回应阿狗的「？」并反问他问什么，等他下文。',
  'finish maybe.</think>',
  '【深度思考】 他说"好吧"，结束了。不用回。安静结束。',
  'ZLOONG（主人）说"今天干了好多事"。就这一条，等我接。 主人身份：3248569738 是主人。',
  'The user said ok, I should reply.',
  '……',
  '好的'
];
for (const bad of DIRTY) {
  assert.equal(isMeaningfulMind(bad), false, `应判为垃圾心事：${JSON.stringify(bad)}`);
  assert.equal(saveMind(CHAT, bad), false, `脏内容不该落盘：${JSON.stringify(bad)}`);
}
// 合格样本不能被误杀
assert.equal(isMeaningfulMind('被连叫两声大肥鱼有点烦，但没炸；想问版本，憋着没问。'), true);

// 4c. 候选决议：主路径优先，两路都不合格就不写（不覆盖旧念头）
assert.deepEqual(resolveMind({ note: '想问 version 又憋回去了，下次找机会问', fallback: '随便' }),
  { text: '想问 version 又憋回去了，下次找机会问', source: 'finish' });
assert.deepEqual(resolveMind({ note: 'finish', fallback: '被怼了没回，等他自己反应过来' }),
  { text: '被怼了没回，等他自己反应过来', source: 'thinking' });
assert.equal(resolveMind({ note: 'finish', fallback: '【深度思考】随便想想' }), null, '两路都脏必须返回 null');
assert.equal(resolveMind({}), null);

// 5. TTL：手动把过期时间改到过去 → 不再注入
const file = mindFileFor(CHAT);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
raw.expiresAt = Date.now() - 1000;
fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
assert.equal(loadMind(CHAT), null, '过期心事必须返回 null');
assert.equal(fs.existsSync(file), false, '过期文件应被顺手清掉（否则 data/mind 只增不减）');

// 6. 坏文件不炸
fs.writeFileSync(file, '{坏 JSON', 'utf8');
assert.equal(loadMind(CHAT), null, '坏文件必须当空');

// 7. 开关：关闭后不读不写
updateConfig({ mind: { enabled: false } });
saveMind(CHAT, '关闭后应该写不进去的心事内容');
assert.equal(loadMind(CHAT), null, '关闭后不注入');
updateConfig({ mind: { enabled: true } });

// 8. 覆盖写（不是追加）：第二条替换第一条
saveMind(CHAT, '第一条心事内容足够长');
saveMind(CHAT, '第二条心事内容足够长');
assert.equal(loadMind(CHAT).text, '第二条心事内容足够长');

// 9. 渲染
const sec = formatMind({ text: '想说但没说' });
assert.ok(sec.startsWith('【刚才的内心】'));
assert.ok(sec.includes('不要复述'));
assert.ok(sec.includes('想说但没说'));
assert.equal(formatMind(null), '');

// 10. 清除
assert.equal(clearMind(CHAT), true);
assert.equal(loadMind(CHAT), null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✅ mind-test: 全部通过');
