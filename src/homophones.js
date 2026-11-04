// 谐音梗提示（2026-11-04）。
//
// 用户反馈 bot 常常按字面理解谐音梗。取证（van♂游群 11-03）：
//   · 群友「你🐋玉玉了同学」→ 它只回了"心疼钱包"，完全没读出「玉玉＝抑郁」；
//   · 群友「肥鱼真是区啊」→ 它的思考里写"'区'可能是'菜'的意思"，回了
//     "区也是勤勤恳恳的区"（自说自话）。「区」在这个群是「蛆」的谐音用法。
//
// 做法：一张高置信度的小表（**只收多字、避免单字误伤**——"区""蚌"这种单字
// 会误命中"区域""蚌埠住了"以外的正常词），命中未读消息时给一行提示。
// 提示只负责把"这是谐音"这条信息摆到模型眼前，接不接、怎么接仍由它判断；
// 表里没有的谐音，靠系统提示里的通用规则 + 「查网络梗」工具。

export const HOMOPHONES = [
  { term: '玉玉', meaning: '抑郁', note: '「抑郁了」的谐音，调侃情绪低落' },
  { term: '蚌埠住了', meaning: '绷不住了', note: '忍不住笑 / 情绪绷不住' },
  { term: '蚌埠', meaning: '绷不住', note: '同上，简写' },
  { term: '尊嘟假嘟', meaning: '真的假的', note: '卖萌谐音' },
  { term: '尊嘟', meaning: '真的', note: '卖萌谐音' },
  { term: '栓Q', meaning: 'thank you', note: '表面道谢、实际无语' },
  { term: '拴q', meaning: 'thank you', note: '同上' },
  { term: '夺笋', meaning: '多损', note: '损人 / 挖苦' },
  { term: '雨女无瓜', meaning: '与你无关', note: '口音梗' },
  { term: '深井冰', meaning: '神经病', note: '骂人谐音，多为玩笑' },
  { term: '蓝瘦香菇', meaning: '难受想哭', note: '口音梗' },
  { term: '蕉绿', meaning: '焦虑', note: '香蕉相关玩梗' },
  { term: '真不戳', meaning: '真不错', note: '夸赞' },
  { term: '针不戳', meaning: '真不错', note: '同上' },
  { term: '耗子尾汁', meaning: '好自为之', note: '出自马保国' }
];

/**
 * 命中哪些谐音梗。
 * 长词优先：出现「蚌埠住了」时不再重复报「蚌埠」；同一句最多 max 条。
 * @param {string} text
 * @param {number} max
 * @returns {Array<{term:string, meaning:string, note:string}>}
 */
export function matchHomophones(text, max = 3) {
  const hay = String(text ?? '').toLowerCase().replace(/[\s\u3000]+/g, '');
  if (!hay) return [];
  const hits = HOMOPHONES
    .filter((h) => hay.includes(h.term.toLowerCase()))
    .sort((a, b) => b.term.length - a.term.length);
  const kept = [];
  for (const h of hits) {
    // 已被更长的同族词覆盖（蚌埠住了 ⊃ 蚌埠）就跳过
    if (kept.some((k) => k.term.includes(h.term) || h.term.includes(k.term))) continue;
    kept.push(h);
    if (kept.length >= Math.max(1, max)) break;
  }
  return kept;
}

/** 命中时渲染的提示块；没命中返回空串（调用方据此不注入）。 */
export function formatHomophoneHint(list) {
  const items = (Array.isArray(list) ? list : []).filter((h) => h && h.term);
  if (!items.length) return '';
  return [
    '【这句里有谐音，别按字面接】',
    ...items.map((h) => `- ${h.term} = ${h.meaning}（${h.note || ''}）`),
    '按谐音的意思理解这句话；不确定就用「查网络梗」查一下或反问一句，别装懂，也别把谐音解释给群友听。'
  ].join('\n');
}
