// 通话结束后的"记忆归档"（2026-10-11 M2）。
//
// 背景：通话会话是 `call:private:<QQ号>`，和文字私聊 `private:<QQ号>` 是**两个会话**，
// 消息也各存各的。结果是"打完电话它完全不记得"——记忆库 data/memory/ 里根本没有
// call_* 目录。这里在挂断时把这通电话压成 1-2 条「关于对方的记忆」，写进**文字私聊**
// 的记忆里，之后聊天就能被检索到。
//
// 三条边界：
//   ① 只写**摘要**，不写原文（用户选的）——以后它引用到的是"我们电话里聊过X"，
//      而不是逐字复述；
//   ② 太短的电话不总结（默认 <4 句），免得一句"喂？"也留一条记忆；
//   ③ 全程不抛错：摘要失败只记日志。挂断路径不能因为记忆归档而出问题。
import { chatCompletionWithRetry } from './llm.js';

/** 少于这么多句就不总结了（试音、误触发的电话没什么可记）。 */
export const CALL_SUMMARY_MIN_MSGS = 4;
/** 喂给模型的转写上限（字符）：够写摘要即可，太长只是白烧 token。 */
export const CALL_SUMMARY_MAX_CHARS = 2400;

/**
 * 取这通电话的转写文本。
 *
 * @param {object} store  消息存档
 * @param {string} chatKey 通话会话 key（call:private:<QQ号>）
 * @param {number} since   通话开始时刻（毫秒）；0/缺失 = 不限
 * @returns {{count:number, text:string}}
 */
export function collectCallTranscript(store, chatKey, since = 0) {
  let msgs = [];
  try {
    msgs = store.recent(chatKey, { limit: 300 }) || [];
  } catch {
    return { count: 0, text: '' };
  }
  const from = Number(since) || 0;
  const picked = msgs
    .filter((m) => !m?.recalled && String(m?.text ?? '').trim())
    .filter((m) => !from || (Number(m?.ts) || 0) >= from);
  const lines = picked.map((m) => `${m?.self ? '我' : '对方'}：${String(m.text).trim()}`);
  let text = lines.join('\n');
  if (text.length > CALL_SUMMARY_MAX_CHARS) text = text.slice(-CALL_SUMMARY_MAX_CHARS);
  return { count: picked.length, text };
}

/** 摘要用的提示词。要求短、只留事实、不要寒暄。 */
export function buildSummaryMessages(peerLabel, transcript) {
  return [
    {
      role: 'system',
      content: '你把一通语音通话的转写压缩成「关于对方的记忆」。'
        + '只写有长期价值的信息：对方提到的事实、偏好、约定、情绪大事、正在做的事。'
        + '不要写寒暄、不要写"对方说你好"这种废话、不要复述原句、不要评价语气。'
        + '输出 1-3 条，每条一行，以「- 」开头，每条不超过 40 字，用第三人称（对方/他）或直接写事实。'
        + '没有任何值得记的内容就输出「- （无）」这一行。'
    },
    {
      role: 'user',
      content: `【通话对象】${peerLabel || '对方'}\n【通话转写】\n${transcript}`
    }
  ];
}

/**
 * 把这通电话归档成记忆。
 *
 * @param {object}   o
 * @param {object}   o.store     消息存档
 * @param {object}   o.memory    MemoryStore
 * @param {string}   o.chatKey   通话会话 key
 * @param {string}   o.target    对方 QQ 号
 * @param {string}   [o.peerLabel] 对方显示名
 * @param {number}   [o.since]   通话开始时刻（毫秒）
 * @param {Function} [o.log]
 * @param {Function} [o.complete] 注入用（测试替身）；默认 chatCompletionWithRetry
 * @returns {Promise<{ok:boolean, count:number, summary?:string, skip?:string}>}
 */
export async function summarizeCall({ store, memory, chatKey, target, peerLabel = '', since = 0,
  log = () => {}, complete = null } = {}) {
  try {
    const { count, text } = collectCallTranscript(store, chatKey, since);
    if (count < CALL_SUMMARY_MIN_MSGS) {
      log(`通话记忆：只 ${count} 句（<${CALL_SUMMARY_MIN_MSGS}），不总结`);
      return { ok: false, count, skip: 'too-short' };
    }
    const call = complete || chatCompletionWithRetry;
    const res = await call({
      messages: buildSummaryMessages(peerLabel, text),
      temperature: 0.3,
      // ⚠️ 不能给太小：主模型多半是思考模型，推理也吃 max_tokens。实测 220 时
      //    finishReason=length、content 全空（220 个 token 全花在思考上）；700 时
      //    短转写能出结果，长一点的转写还是会被推理吃光。给 1500 留足余量 ——
      //    摘要本身只有几十个 token，多给的额度不花钱（按实际生成计费）。
      maxTokens: 1500
    });
    // ⚠️ chatCompletionWithRetry 的返回形状是 { message, finishReason, usage, model, raw }
    //    —— **不是**顶层 OpenAI 的 { choices:[...] }（2026-10-11 踩坑，真机验证才发现）。
    const raw = String(res?.message?.content ?? '').trim();
    if (!raw) {
      const why = res?.finishReason === 'length' ? 'truncated' : 'empty';
      log(`通话记忆：摘要${why === 'truncated' ? '被推理吃光（max_tokens 不够）' : '为空'}，跳过`);
      return { ok: false, count, skip: why };
    }
    // 只收「- 」开头的行；模型偶尔会带前言，过滤掉
    const lines = raw.split('\n').map((x) => x.trim()).filter((x) => /^[-*·]\s*\S/.test(x))
      .map((x) => x.replace(/^[-*·]\s*/, '').trim())
      .filter((x) => x && x !== '（无）' && x !== '(无)' && x !== '无');
    if (!lines.length) {
      log('通话记忆：摘要里没有可记的条目，跳过');
      return { ok: false, count, skip: 'nothing' };
    }
    const summary = `电话里聊到：${lines.slice(0, 3).join('；')}`;
    memory.append(`private:${target}`, 'memberImpression', summary, { userId: String(target), target: String(target) });
    log(`通话记忆已归档（${count} 句 → ${lines.length} 条）：${summary.slice(0, 60)}`);
    return { ok: true, count, summary };
  } catch (e) {
    log(`通话记忆归档失败（不影响通话）：${e?.message ?? e}`);
    return { ok: false, count: 0, skip: 'error' };
  }
}
