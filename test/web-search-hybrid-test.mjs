// 混合搜索的相关性守卫自测（2026-10-26）
//
// 背景（真实事故链，别删）：
//   · Bing 网页解析对**多词中文**查询会静默降级 —— 把查询拆成首字去搜。
//     实测 "绝区零 星徽骑士EP" 连续三次返回「绝（汉语文字）_百度百科」，
//     而单词 "绝区零" 完全正常。这种结果"看起来搜到了"，实际换了话题。
//   · 换成 DeepSeek 原生搜索后暴露另一个毛病：它的"可核实范围"停在 2026-05，
//     问今天的赛事比分一律答"还没开赛"；但解释类问题（这梗是什么）答得不错。
//   · 所以改成混合：Bing 先上，答非所问才 fallback 到 DeepSeek。
//
// 这个测试只覆盖**纯函数**判定（不打网络）。真实链路的验证方式见文件末尾注释。
//
// 运行：node test/web-search-hybrid-test.mjs
import assert from 'node:assert';
import { looksDegenerate, webSearch, bingSearch, deepSeekSearch } from '../src/web-search.js';

const pass = [], fail = [];
function check(name, fn) {
  try { fn(); pass.push(name); console.log(`  ✓ ${name}`); }
  catch (e) { fail.push(name); console.error(`  ✗ ${name}\n      ${e.message}`); }
}

// ── 1. 退化判定：必须抓到（这些是实测回来的真样本）──────────────────────────
check('「绝区零 星徽骑士EP」→ 汉字百科结果判为退化', () => {
  const results = [
    { title: '绝（汉语文字）_百度百科', snippet: '绝，汉语一级字，读作jué…', url: 'https://baike.baidu.com/item/绝/22366' },
    { title: '绝的意思,绝的解释,绝的拼音,绝的部首', snippet: '汉语国学字典', url: 'https://www.hanyuguoxue.com/zidian/zi-32477' },
    { title: '绝_绝怎么读_绝的意思 - 汉语字典', snippet: '查古诗词语典', url: 'https://www.chagushici.com/zidian/绝' }
  ];
  assert.equal(looksDegenerate(results, '绝区零 星徽骑士EP'), true);
});

check('「影之刃零 评测 9.8」→ 电影《影》结果判为退化', () => {
  const results = [
    { title: '影（2018年张艺谋执导的武侠动作电影）_百度百科', snippet: '张艺谋执导' },
    { title: '影 (豆瓣)', snippet: '豆瓣电影' },
    { title: '影（汉语文字）_百度百科', snippet: '汉字' }
  ];
  assert.equal(looksDegenerate(results, '影之刃零 评测 9.8'), true);
});

// ── 2. 不许误判：这些是正常结果，不该白等一次 DeepSeek ────────────────────
check('「绝区零」单词查询的正常结果不判退化', () => {
  const results = [{ title: '《绝区零》官网-3.3全新版本', snippet: '绝区零官方网站' }];
  assert.equal(looksDegenerate(results, '绝区零'), false);
});

check('「S16 瑞士轮 IG HLE 结果」的赛程指南不判退化（拉丁词命中）', () => {
  const results = [
    { title: '2026英雄联盟全球总决赛 (S16) 观赛全指南：赛程/赛制', snippet: '瑞士轮…' },
    { title: '赛程中心 - S16 英雄联盟总决赛', snippet: '赛程' }
  ];
  assert.equal(looksDegenerate(results, 'S16 瑞士轮 IG HLE 结果'), false);
});

check('半退化但相关的（只回来官网）不判退化——宁可留也不白等十几秒', () => {
  const results = [{ title: '《鸣潮》官方网站 - Wuthering Waves', snippet: '鸣潮官网' }];
  assert.equal(looksDegenerate(results, '鸣潮 新版本PV'), false);
});

check('空结果不算退化（应报"没搜到"，而不是去兜底）', () => {
  assert.equal(looksDegenerate([], '绝区零 星徽骑士EP'), false);
});

check('单个词/无中文 bigram 的查询没有判断意义', () => {
  assert.equal(looksDegenerate([{ title: '无关内容', snippet: '' }], 'S16'), false);
});

// ── 3. 入口契约 ───────────────────────────────────────────────────────────
check('三个入口都是函数（混合模式的接线没断）', () => {
  for (const fn of [webSearch, bingSearch, deepSeekSearch, looksDegenerate]) {
    assert.equal(typeof fn, 'function');
  }
});

// ── 收尾 ─────────────────────────────────────────────────────────────────
console.log(`\n通过 ${pass.length} / ${pass.length + fail.length}`);
if (fail.length) {
  console.error(`失败 ${fail.length} 项：${fail.join('、')}`);
  process.exit(1);
}
console.log('全部通过 ✅');
console.log('\n（真实链路验证：设 provider=hybrid 后，用「绝区零 星徽骑士EP」应看到 provider=deepseek + fellBack=true，');
console.log('  用「绝区零」应看到 provider=bing 且带 url —— 这一步会打网络，不放进自动测试。）');
