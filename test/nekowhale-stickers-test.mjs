// nekowhale-stickers 技能自测（2026-10-25）
//
// 纯本地、不联网：只验证"检索"这一半（索引解析 / 打分 / 去重 / 额度 / URL / 魔数）。
// 真正的下载与发送走 ctx.sender，属于 QQ-Agent 运行时，不在这里模拟。
//
// ⚠️ skills/ 是 .gitignore 掉的（第三方技能不入库），所以本测试在技能未安装时
//    打印"跳过"并退出 0 —— 与其他本地技能的测试保持一致。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'nekowhale-stickers');
if (!fs.existsSync(path.join(SKILL_DIR, 'index.js'))) {
  console.log('⚠ 跳过：skills/nekowhale-stickers 未安装（skills/ 不入库）');
  process.exit(0);
}

// 数据目录隔离：必须在 import src/* 之前设置
const __testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-nk-'));
process.env.QQ_AGENT_DATA_DIR = __testDataDir;

// Windows 下动态 import 绝对路径必须转成 file:// URL
const mod = await import(pathToFileURL(path.join(SKILL_DIR, 'index.js')).href);
const { normalizeCatalog, expandTerms, scoreItem, pickCandidates, sniffImage, stickerUrl, quotaOf } = mod.__internals;

const pass = [], fail = [];
function check(name, fn) {
  try { fn(); pass.push(name); console.log(`  ✓ ${name}`); }
  catch (e) { fail.push(name); console.error(`  ✗ ${name}\n      ${e.message}`); }
}

const raw = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'catalog.json'), 'utf8'));
const cat = normalizeCatalog(raw);

// ── 1. 索引解析 ──────────────────────────────────────────────────────────
check('1. 随包索引能解析出 322 张，字段齐全', () => {
  assert.equal(cat.items.length, 322, `期望 322 张，实际 ${cat.items.length}`);
  assert.ok(cat.packs.length >= 2, '应至少识别出两个套组');
  const it = cat.items.find((x) => x.id === '大肥鱼/10N01_猫猫搓手');
  assert.ok(it, '应能按 id 找到样本');
  assert.equal(it.pack, '大肥鱼');
  assert.equal(it.name, '猫猫搓手', '名字应去掉编号段');
  assert.equal(it.code, '10N01');
  assert.equal(it.emotion, '兴奋');
  assert.ok(it.tags.length > 0, 'tags 应解析出来');
  assert.ok(it.use.includes('期待'), 'use 应解析出来');
});

check('2. 所有条目都有 id/pack/stem/emotion，且 id 唯一', () => {
  const seen = new Set();
  for (const it of cat.items) {
    assert.ok(it.id.includes('/'), `id 应含斜杠：${it.id}`);
    assert.ok(it.pack && it.stem, `pack/stem 缺失：${it.id}`);
    assert.ok(it.emotion, `缺情绪：${it.id}`);
    assert.ok(!seen.has(it.id), `id 重复：${it.id}`);
    seen.add(it.id);
  }
});

// ── 3. URL 拼接 ──────────────────────────────────────────────────────────
check('3. 图片直链按 /media/gif/<pack>/<stem>.gif?h=<hash> 拼', () => {
  const it = cat.items.find((x) => x.id === '大肥鱼/10N01_猫猫搓手');
  const url = stickerUrl(it);
  assert.equal(url, 'https://kiriyuki.com/media/gif/%E5%A4%A7%E8%82%A5%E9%B1%BC/10N01_%E7%8C%AB%E7%8C%AB%E6%90%93%E6%89%8B.gif?h=4a44767ab58b');
  // 无 hash 时不应留下空 ?h=
  assert.ok(!stickerUrl({ ...it, hash: '' }).includes('?'), '没有 hash 时不该带查询串');
});

// ── 4. 词元展开 ──────────────────────────────────────────────────────────
check('4. 语气词能剥掉"来张/发个"前缀并补双字滑窗', () => {
  assert.deepEqual(expandTerms(''), []);
  const terms = expandTerms('来张委屈的');
  assert.ok(terms.includes('来张委屈的'), '保留原词');
  assert.ok(terms.some((t) => t.includes('委屈') && t.length < 5), `应剥出「委屈」类词元：${JSON.stringify(terms)}`);
});

// ── 5. 检索质量 ──────────────────────────────────────────────────────────
check('5. 关键词检索能命中语义相关的图（不是随机）', () => {
  for (const [kw, expectTag] of [['委屈', '委屈'], ['摸鱼', '摸鱼'], ['下班', '下班'], ['吃瓜', '吃瓜']]) {
    const got = pickCandidates(cat, { terms: expandTerms(kw), limit: 5, rand: () => 1 });
    assert.ok(got.items.length > 0, `「${kw}」不该一个都挑不出来`);
    const hit = got.items.some((it) => [it.tags.join(' '), it.use, it.desc, it.text, it.name].join(' ').includes(expectTag));
    assert.ok(hit, `「${kw}」的前 5 张里应至少有一张命中「${expectTag}」，实际：${got.items.map((i) => i.id).join(' / ')}`);
  }
});

check('6. 打分确实区分了命中位置（情绪 > 标签 > 描述）', () => {
  const mk = (over) => ({
    id: 'x', pack: 'p', stem: 's', name: '名字', code: '', text: '', emotion: '', tags: [], use: '', desc: '', meme: '', dir: '', en: '', hash: '', ...over
  });
  const terms = ['委屈'];
  const byEmotion = scoreItem(mk({ emotion: '委屈' }), terms);
  const byTag = scoreItem(mk({ tags: ['委屈'] }), terms);
  const byDesc = scoreItem(mk({ desc: '一脸委屈' }), terms);
  assert.ok(byEmotion > byTag, `情绪命中应高于标签：${byEmotion} vs ${byTag}`);
  assert.ok(byTag > byDesc, `标签命中应高于描述：${byTag} vs ${byDesc}`);
  assert.equal(scoreItem(mk({}), []), 0, '没有词元时不应得分');
});

check('7. emotion 参数能限定大类', () => {
  const got = pickCandidates(cat, { terms: [], emotion: '哭', limit: 5, rand: () => 1 });
  assert.ok(got.items.length > 0, '限定情绪时应能挑出图');
  assert.ok(got.items.every((it) => it.emotion === '哭' || it.emotion.includes('哭')), `应全是哭类：${got.items.map((i) => i.emotion)}`);
});

check('8. 本会话发过的图被大幅降权（不硬排除）', () => {
  const first = pickCandidates(cat, { terms: expandTerms('开心'), limit: 3, rand: () => 1 }).items.map((i) => i.id);
  const again = pickCandidates(cat, { terms: expandTerms('开心'), excludeIds: first, limit: 3, rand: () => 1 }).items.map((i) => i.id);
  assert.ok(again.length > 0, '去重后仍要有候选（全库才 322 张，不能挑空）');
  assert.notDeepEqual(first.slice(0, 2), again.slice(0, 2), '前两张应发生变化');
});

check('9. 无关键词时 pickCandidates 给出提示文案而不是静默返回', () => {
  const got = pickCandidates(cat, { terms: [], emotion: '', limit: 3 });
  assert.ok(got.items.length > 0);
  assert.ok(got.note.includes('随机'), `应有说明文案，实际：${got.note}`);
});

// ── 10. 魔数嗅探（防裂图的关键一道闸）─────────────────────────────────────
check('10. 魔数嗅探：认得 GIF，垃圾内容返回 null', () => {
  const gif = Buffer.alloc(16);
  gif.write('GIF89a', 0, 'latin1');
  gif.writeUInt16LE(320, 6);
  gif.writeUInt16LE(240, 8);
  const got = sniffImage(gif);
  assert.ok(got && got.format === 'gif', '应认出 GIF');
  assert.equal(got.w, 320);
  assert.equal(got.h, 240);

  const html = Buffer.from('<!doctype html><html><body>404</body></html>', 'utf8');
  assert.equal(sniffImage(html), null, 'HTML 错误页必须被挡下来');

  const png = Buffer.alloc(24);
  png[0] = 0x89; png.write('PNG', 1, 'latin1');
  png.writeUInt32BE(64, 16); png.writeUInt32BE(64, 20);
  assert.equal(sniffImage(png).format, 'png');
});

// ── 11. 额度 ─────────────────────────────────────────────────────────────
check('11. 额度换算：按会话按小时/按天，过期自动归零', () => {
  const now = Date.now();
  const dk = new Date(now).toISOString().slice(0, 10);
  // 当天已发 3 张、本小时已发 2 张
  const state = { sent: {}, quota: { 'group:1': { dayKey: localDay(now), day: 3, hourAt: now - 60000, hour: 2 } } };
  const q = quotaOf(state, 'group:1', now);
  assert.equal(q.dayCount, 3);
  assert.equal(q.hourCount, 2);
  assert.ok(q.left <= q.perHour - 2 && q.left <= q.perDay - 3, `剩余额度应取两者最小值：${q.left}`);

  // 两小时前的计数不算数
  const stale = { sent: {}, quota: { 'group:1': { dayKey: localDay(now), day: 3, hourAt: now - 2 * 3600_000, hour: 9 } } };
  assert.equal(quotaOf(stale, 'group:1', now).hourCount, 0, '超过一小时的计数应归零');

  // 昨天的日计数不算数
  const yday = { sent: {}, quota: { 'group:1': { dayKey: '1999-01-01', day: 99, hourAt: now, hour: 0 } } };
  assert.equal(quotaOf(yday, 'group:1', now).dayCount, 0, '跨天日计数应归零');
  void dk;
});

function localDay(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── 12. 清单自洽 ─────────────────────────────────────────────────────────
check('12. skill.json 声明的设置项与 index.js 的 DEFAULTS 对得上', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'skill.json'), 'utf8'));
  assert.equal(manifest.id, 'nekowhale-stickers');
  for (const key of Object.keys(manifest.settings)) {
    assert.ok(manifest.configSchema[key], `settings 里的 ${key} 缺 configSchema（UI 渲染不出来）`);
    assert.ok(manifest.configSchema[key].type, `${key} 的 schema 缺 type`);
    assert.ok(manifest.configSchema[key].label, `${key} 的 schema 缺 label`);
  }
  assert.ok(fs.existsSync(path.join(SKILL_DIR, 'catalog.json')), '随包索引必须存在（搜索零网络的前提）');
  const src = fs.readFileSync(path.join(SKILL_DIR, 'index.js'), 'utf8');
  for (const key of Object.keys(manifest.settings)) {
    assert.ok(src.includes(`${key}:`), `index.js 的 DEFAULTS 应包含 ${key}`);
  }
});

try { fs.rmSync(__testDataDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n大肥鱼表情包：通过 ${pass.length}，失败 ${fail.length}`);
if (fail.length) { console.error('失败项：\n' + fail.map((n) => `  - ${n}`).join('\n')); process.exitCode = 1; }
