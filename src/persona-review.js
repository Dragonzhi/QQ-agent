// 每晚 LLM 复盘（doc/persona-meme-plan.md P2，B 路线）。
// 到点扫当天会话存档：① 起草候选回复示例（进 config.persona.examples，pending）
// ② 收集各群自产梗（写 data/group-memes/<gid>.json，pending）。全部只进待审区，
// 人工晋升后才生效 —— 复盘自嗨（把平凡的回复当宝）的代价被审批闸拦住。
//
// 设计口径：
// - runReviewOnce 绝不 throw：所有错误收进 summary.errors 并记日志。
//   定时器在服务进程里跑，抛错就是 unhandledRejection；手动触发也该拿到结构化结果。
// - 用量走 sessions.addExternalUsage 记入 usage-today.json（不占 runs），
//   复盘成本在用量页可见。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getConfig, updateConfig } from './config.js';
import { chatCompletion, addUsage, emptyUsage } from './llm.js';
import { todayKey, normTrigger } from './util.js';   // todayKey 与 sessions.js 的 localDayKey 同一算法
import { loadMemes, saveMemes } from './group-memes.js';

// 防重启后同一天重跑：lastRunDayKey 持久化在数据目录（与 usage-today.json 同级）
const STATE_FILE = path.join(DATA_DIR, 'persona-review-state.json');
// 全部群样本总量截断（先到先得）：复盘是「挑亮点」不是「读全文」，塞太多
// 又贵又让模型抓不住重点；6000 字符约等于一次普通会话的已读信息量。
const MAX_SAMPLES = 40;
const MAX_SAMPLE_CHARS = 6000;
// 单群喂给群梗任务的当天聊天文本上限（tail 保留，最近的更能反映当下在玩的梗）
const MEME_SAMPLE_CHARS = 4000;

function loadReviewState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* 首次运行 */ }
  return {};
}

function saveReviewState(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 原子写：与 usage-today.json 同一套 tmp+rename，防半截 JSON
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch { /* 记不上最坏 = 同一天重启后再跑一次，可接受 */ }
}

/**
 * 容忍弱模型输出的 JSON 解析：剥 ```json 围栏；还不行就取第一个 { 到最后一个 }
 * （模型爱在前后加「好的，以下是结果」之类的说明）。
 */
function parseLooseJson(text) {
  const s = String(text ?? '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const raw = fence ? fence[1].trim() : s;
  try { return JSON.parse(raw); } catch { /* 继续尝试截取 */ }
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(raw.slice(a, b + 1)); } catch { /* 放弃 */ }
  }
  return null;
}

/**
 * 取模型正文。chatCompletion 返回的是扁平结构 { message, usage, raw, … }，
 * **不是** OpenAI 原始响应的 { choices:[…] } —— 照抄原始 API 形状会永远取到 undefined，
 * 表现为「模型输出不是可解析的 JSON」把每次复盘都丢掉（src 里 call-memory.js 同口径）。
 */
const replyText = (resp) => String(resp?.message?.content ?? '');

/** 单行化 + 截断：note 要渲染进提示词的一行里，换行/超长会打乱示例块格式。 */
const oneLine = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ── 收梗/示例质量闸（2026-10-23）────────────────────────────────────────
// 用户反馈：复盘把普通聊天、随机字符串、一次性玩笑都收进待审，人工筛不过来。
// 只靠提示词约束弱模型不够，落盘前再叠一层本地闸：可信度门槛 + 内容启发式 + 每群上限。
// 阈值可在 config.persona.review.minConfidence / maxMemesPerChat 调（设置页有输入框）。
const DEFAULT_MIN_CONFIDENCE = 0.72;

/** 水回复：只有语气词/标点/一两个字，学不到东西（对应核心规则「接话要有内容」）。 */
const FILLER_WORDS = new Set(['确实', '受着', '草', '哈哈', '哈哈哈', '笑死', '好家伙', '这啥', '？这啥',
  '？', '。', 'ok', '好', '行', '嗯', '哦', '牛', '6']);
function isFillerReply(text) {
  const s = String(text ?? '').trim();
  if (!s) return true;
  const bare = s.replace(/^[?？!！。…\s]+|[?？!！。…\s]+$/g, '');
  if (FILLER_WORDS.has(s) || FILLER_WORDS.has(bare)) return true;
  return bare.length <= 2;
}

/** 触发句/梗名是不是占位符、纯数字、URL、@、纯标点——这类没有复用价值。 */
function looksLikeNoise(text) {
  const s = String(text ?? '').trim();
  if (!s) return true;
  // 去掉占位符/@/链接/纯标点后还剩不剩「真内容」（"[图片] [图片]""19959878509 405360" 都会剩空）
  const stripped = s
    .replace(/\[(?:图片|视频|语音|表情|动画表情|文件|链接)\]/g, '')
    .replace(/@\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\d\s.．,，:：;；!！?？~～\-—_()（）[\]【】]/g, '');
  if (!stripped) return true;
  return /^\d{6,}$/.test(s);   // 纯长数字串
}

/** 模型自评可信度：缺省 0（不给分就按不合格处理，宁缺毋滥）。 */
function confidenceOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/** 读复盘阈值并夹到合法范围（手改配置写坏也不炸）。 */
function reviewThresholds() {
  const review = getConfig().persona?.review ?? {};
  const rawConf = Number(review.minConfidence);
  const minConfidence = Number.isFinite(rawConf) ? Math.min(0.95, Math.max(0.5, rawConf)) : DEFAULT_MIN_CONFIDENCE;
  const rawCap = Math.round(Number(review.maxMemesPerChat) || 2);
  const maxMemesPerChat = Math.min(5, Math.max(1, Number.isFinite(rawCap) ? rawCap : 2));
  return { minConfidence, maxMemesPerChat };
}

/** 一次复盘 LLM 调用的用量入账（calls 计 1，runs 不动）。记账失败不影响复盘。 */
function recordUsage(resp, sessions) {
  try {
    const u = addUsage(emptyUsage(), resp?.usage);
    u.calls = 1;
    sessions?.addExternalUsage?.(u);
  } catch { /* 记账失败可容忍 */ }
}

let memeSeq = 0;
const newMemeId = () => `gm_${Date.now().toString(36)}_${(++memeSeq).toString(36)}`;
let exampleSeq = 0;
const newReviewExampleId = () => `ex_${Date.now().toString(36)}_${(++exampleSeq).toString(36)}`;

/**
 * 收集当天各群样本。返回 [{ chatKey, chatId, samples, text }]：
 * samples = 给任务一的回复样本（触发上下文 + 我的回复 + 群友反应），text = 给任务二的当天全文。
 * 跳过 self 消息少于 3 条的群（样本太少复盘不出来东西）；全群样本按 MAX_* 先到先得截断。
 */
function collectGroups(store, now) {
  const d = new Date(now);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const chatKeys = (store.listChats() || []).filter((k) => String(k).startsWith('group:'));
  const groups = [];
  let totalSamples = 0;
  let totalChars = 0;
  for (const chatKey of chatKeys) {
    const msgs = (store.recent(chatKey, { limit: 1000, includeSelf: true }) || [])
      .filter((m) => (Number(m?.ts) || 0) >= dayStart);
    const selfCount = msgs.filter((m) => m.self).length;
    if (selfCount < 3) continue;
    const chatId = chatKey.split(':')[1] || '';
    const samples = [];
    for (let i = 0; i < msgs.length && totalSamples < MAX_SAMPLES; i++) {
      const m = msgs[i];
      if (!m.self) continue;
      const reply = String(m.text ?? '').trim();
      if (!reply) continue;
      // 前最多 2 条非 self（倒着找满即停）+ 后最多 3 条非 self：群友接话 = 正信号
      const before = [];
      for (let j = i - 1; j >= 0 && before.length < 2; j--) if (!msgs[j].self) before.unshift(msgs[j]);
      const after = [];
      for (let j = i + 1; j < msgs.length && after.length < 3; j++) if (!msgs[j].self) after.push(msgs[j]);
      // 2026-10-23：没人接话的回复不喂给任务一 —— 没有正信号，模型只能硬挑，
      // 实测产出一堆「九格那个也行」「？这啥」式垃圾。任务二仍用当天全文。
      if (!after.length) continue;
      const sample = {
        chatId,
        triggerContext: before.map((x) => String(x.text ?? '').trim()).filter(Boolean),
        reply,
        reactions: after.map((x) => String(x.text ?? '').trim()).filter(Boolean)
      };
      const len = reply.length + sample.triggerContext.join('').length + sample.reactions.join('').length;
      // 字符预算先到先得：这条会爆预算就整轮收工（后面的群今天等下一次）
      if (totalChars + len > MAX_SAMPLE_CHARS) break;
      samples.push(sample);
      totalSamples++;
      totalChars += len;
    }
    const text = msgs.map((m) => String(m.text ?? '').trim()).filter(Boolean).join('\n').slice(-MEME_SAMPLE_CHARS);
    if (samples.length || text) groups.push({ chatKey, chatId, samples, text });
  }
  return groups;
}

/** 任务一：一次 LLM 调用起草候选示例。返回 { drafts, dropped }。 */
function validateDraftedExamples(rawList, existingExamples, maxDrafts, now, minConfidence = DEFAULT_MIN_CONFIDENCE) {
  // 去重口径与 P1 晋升闸一致：normTrigger 比对。2026-10-23 起 rejected 也挡 ——
  // 用户驳回/删过的东西换皮再交 = 扰民（此前留痕不拦，导致同样的废水句反复出现）。
  const seen = new Set((Array.isArray(existingExamples) ? existingExamples : [])
    .map((e) => e && normTrigger(e.trigger)).filter(Boolean));
  const drafts = [];
  let dropped = 0;
  for (const item of (Array.isArray(rawList) ? rawList : [])) {
    if (drafts.length >= maxDrafts) break;
    const trigger = String(item?.trigger ?? '').trim().slice(0, 60);
    const confidence = confidenceOf(item?.confidence);
    if (!trigger || confidence < minConfidence) { dropped++; continue; }
    if (looksLikeNoise(trigger) || trigger.length < 4) { dropped++; continue; }
    // 水回复一律剔掉；剔完没有正例就整条丢（反例条目渲染层也不展示，留着只是人工负担）
    const good = (Array.isArray(item?.good) ? item.good : [])
      .map((s) => String(s ?? '').trim().slice(0, 40)).filter((s) => s && !isFillerReply(s)).slice(0, 3);
    if (!good.length) { dropped++; continue; }
    // 回复只是复读触发句 → 学不到新东西
    if (good.every((g) => normTrigger(g) === normTrigger(trigger))) { dropped++; continue; }
    const norm = normTrigger(trigger);
    if (!norm || seen.has(norm)) { dropped++; continue; }
    seen.add(norm);
    const bad = (Array.isArray(item?.bad) ? item.bad : [])
      .map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 2);
    const tags = (Array.isArray(item?.tags) ? item.tags : [])
      .map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 3);
    // note（梗解释）可缺省；why 是模型自证「这条为什么值得学」，只用于面板人工判断
    const note = oneLine(item?.note);
    const why = oneLine(item?.why, 120);
    drafts.push({
      id: newReviewExampleId(), status: 'pending', trigger, good, bad, note, why,
      confidence: Number(confidence.toFixed(2)), tags, source: 'review', createdAt: now, usedAt: 0
    });
  }
  return { drafts, dropped };
}

/** 任务二：单群梗校验。返回 { fresh, dropped }。 */
function validateMemes(rawList, existing, now, { maxPerChat = 2, minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  // 去重：任何 status 都挡（rejected 的也不再重收）
  const seen = new Set((Array.isArray(existing) ? existing : [])
    .map((m) => normTrigger(m?.name)).filter(Boolean));
  const fresh = [];
  let dropped = 0;
  for (const item of (Array.isArray(rawList) ? rawList : [])) {
    if (fresh.length >= maxPerChat) break;
    const name = String(item?.name ?? '').trim().slice(0, 20);
    const meaning = oneLine(item?.meaning, 120);
    const evidence = oneLine(item?.evidence, 120);
    const confidence = confidenceOf(item?.confidence);
    // 没有自证依据 / 可信度不够 = 模型自己都没把握，别拿来占待审位
    if (!name || confidence < minConfidence) { dropped++; continue; }
    if (looksLikeNoise(name) || name.length < 2) { dropped++; continue; }
    if (meaning.length < 4) { dropped++; continue; }
    if (normTrigger(meaning) === normTrigger(name)) { dropped++; continue; }   // 解释只是复读名字
    if (evidence.length < 4) { dropped++; continue; }
    const norm = normTrigger(name);
    if (!norm || seen.has(norm)) { dropped++; continue; }
    seen.add(norm);
    const example = oneLine(item?.example, 120);
    fresh.push({
      id: newMemeId(), name, meaning, example, evidence,
      confidence: Number(confidence.toFixed(2)), status: 'pending', source: 'review', createdAt: now
    });
  }
  return { fresh, dropped };
}

/**
 * 完整跑一轮复盘。所有异常都收进 summary.errors（绝不 throw）——
 * 调用方有两类：分钟级定时器（无人看管）和设置页手动按钮（要拿到可展示的结果）。
 * 返回 { examplesDrafted, examplesDropped, memesDrafted, memesDropped, chatsScanned, errors }。
 */
export async function runReviewOnce({ log = () => {}, store, sessions, llmCall = chatCompletion, now = Date.now() } = {}) {
  const summary = { examplesDrafted: 0, examplesDropped: 0, memesDrafted: 0, memesDropped: 0, chatsScanned: 0, errors: [] };
  const note = (what, error) => {
    const msg = `${what}：${String(error?.message ?? error)}`;
    summary.errors.push(msg);
    log(`[人设复盘] ${msg}`);
  };
  try {
    if (!store || typeof store.listChats !== 'function') {
      note('复盘中止', new Error('store 不可用'));
      return summary;
    }
    const review = getConfig().persona?.review ?? {};
    // 数字兜底：手改 config.json 出现小数/负数/字符串都拉回合法范围
    const rawMax = Math.round(Number(review.maxDrafts) || 5);
    const maxDrafts = Math.min(10, Math.max(1, Number.isFinite(rawMax) ? rawMax : 5));
    const { minConfidence, maxMemesPerChat } = reviewThresholds();

    const groups = collectGroups(store, now);
    summary.chatsScanned = groups.length;
    if (!groups.length) {
      log('[人设复盘] 今天没有足够的群聊样本（self 消息 ≥3 条的群为 0），跳过');
      return summary;
    }

    // ── 任务一：起草示例（一次调用）──
    try {
      const lines = [];
      let n = 0;
      for (const g of groups) {
        for (const s of g.samples) {
          n++;
          lines.push(`【样本${n}】（群${g.chatId}）`);
          if (s.triggerContext.length) lines.push(`触发上下文：${s.triggerContext.join(' / ')}`);
          lines.push(`我的回复：${s.reply}`);
          if (s.reactions.length) lines.push(`之后群友反应：${s.reactions.join(' / ')}`);
        }
      }
      const resp = await llmCall({
        messages: [
          { role: 'system', content: '你是数据整理员。只输出一个 JSON 对象，不要输出任何解释文字。' },
          {
            role: 'user',
            content: [
              '下面是 QQ 机器人今天在群聊里的回复样本（触发上下文 / 我的回复 / 之后群友反应）。',
              '只挑真正值得学的回复：回复本身有具体内容或有梗，且「之后群友反应」里有接话、复述、追问、笑（正信号）。',
              '不要收：① 一次性的具体问答（换个群友问同样的话未必适用）；② 没信息量的水回复（"？这啥""确实""九格那个也行"）；③ 触发句是 [图片]/随机数字/无意义碎片的；④ 只是复读群友原话。',
              '宁缺毋滥：最多 ' + maxDrafts + ' 条，通常 1~3 条；一条都不达标就给空数组。',
              '每条给 confidence（0~1，你对「换成同样情境这回复仍然好」的把握）和 why（一句话证据：群友当时怎么接的）。低于 ' + minConfidence + ' 的不要输出。',
              '另外给每条示例补一句 note：这个梗/这轮对话的背景和含义，用大白话讲清「群友在玩什么、为什么这样接」。看不出梗就留空字符串，不要硬编；note 是给模型看的，不要写成说教、也不要重复 good 的内容。',
              '只输出 JSON，格式：',
              '{"examples":[{"trigger":"群友说的话","good":["推荐回复"],"bad":[],"note":"这个梗是什么意思/什么背景（没有就留空）","why":"群友怎么接的","confidence":0.8,"tags":["标签"]}]}',
              '',
              ...lines
            ].join('\n')
          }
        ],
        temperature: 0.4,   // 结构化整理任务，不需要发散
        // 思考型端点（如 step_plan）的 reasoning 会先吃掉 3~5k token：预算给小了正文直接被截成空串
        // （finishReason=length、正文 0 字），下游只看到「模型输出不是可解析的 JSON」。
        // 实测 reasoning≈7k 字 + 正文≈650 字 ≈ 8000 顶格 —— 8000 已无余量，提 12000。
        // maxTokens 只是上限：finishReason=stop 时按实际用量计费，提上限不增加成本。
        maxTokens: 12000
      });
      recordUsage(resp, sessions);
      const parsed = parseLooseJson(replyText(resp));
      if (!parsed) {
        note('起草示例', new Error(`模型输出不是可解析的 JSON，已丢弃（finishReason=${resp?.finishReason || '?'}、正文 ${replyText(resp).length} 字）`));
      } else {
        const { drafts, dropped } = validateDraftedExamples(parsed.examples, getConfig().persona?.examples, maxDrafts, now, minConfidence);
        summary.examplesDropped += dropped;
        // 与 P1 同一条 updateConfig 路径：读全量 → 追加 → 整体替换
        if (drafts.length) {
          const list = getConfig().persona?.examples;
          updateConfig({ persona: { examples: [...(Array.isArray(list) ? list : []), ...drafts] } });
          summary.examplesDrafted = drafts.length;
        }
      }
    } catch (error) {
      note('起草示例失败', error);
    }

    // ── 任务二：群梗收集（每群一次调用）──
    // 选了逐群调用而不是批量返回：把多群塞进一个 JSON 里让弱模型对错群号
    // 的风险，比多花几次调用的成本更伤（梗挂错群直接违反 per-chat 隔离）。
    if (review.groupMemes !== false) {
      for (const g of groups) {
        if (!g.text) continue;
        try {
          const resp = await llmCall({
            messages: [
              { role: 'system', content: '你是数据整理员。只输出一个 JSON 对象，不要输出任何解释文字。' },
              {
                role: 'user',
                content: [
                  `下面是一个 QQ 群（群号 ${g.chatId}）今天的聊天记录。`,
                  '任务：只找出这个群真正在用的「群内自产梗」——群里反复出现、有固定说法和含义、外部搜索引擎查不到：内部黑话、群友绰号、共同经历的事件。',
                  '必须同时满足：① 记录里出现 2 次以上，或能看出群体共同使用/沿用；② 有稳定含义或用法，不是一次性玩笑；③ 新群友不看解释会听不懂。',
                  '不要收：普通聊天/吐槽/事实问答；一次性的谐音玩笑；通用网络梗（外部能查到）；纯 @ 称呼或完整昵称；随机字符串/数字/链接；一个人随口说的一句。',
                  '宁缺毋滥：每群最多 ' + maxMemesPerChat + ' 条，没有就输出 {"memes":[]}。',
                  '每条给 evidence（记录里支持它是梗的原话或出现次数）和 confidence（0~1，低于 ' + minConfidence + ' 的不要输出）。',
                  '正例：群内海南话黑话「胶固」——多次出现、有固定含义、外部查不到。反例：「九格物品栏」只是一次普通游戏讨论，没有内部含义，不要收。',
                  '只输出 JSON，格式：',
                  '{"memes":[{"name":"梗名","meaning":"含义解释","example":"群里实际用法的原话","evidence":"凭什么判定它是群梗","confidence":0.8}]}',
                  '',
                  g.text
                ].join('\n')
              }
            ],
            temperature: 0.4,
            // 同上，但这个任务更吃预算：通读 4000 字密集群聊找梗，思考量比起草示例大。
            // 2026-10-17 实测：活跃大群 8000 预算下 reasoning 吃穿预算、正文 0 字。
            maxTokens: 12000
          });
          recordUsage(resp, sessions);
          const parsed = parseLooseJson(replyText(resp));
          if (!parsed) {
            note(`群 ${g.chatId} 群梗收集`, new Error(`模型输出不是可解析的 JSON，已丢弃（finishReason=${resp?.finishReason || '?'}、正文 ${replyText(resp).length} 字）`));
            continue;
          }
          const { memes: existing } = loadMemes(g.chatKey);
          const { fresh, dropped } = validateMemes(parsed.memes, existing, now, { maxPerChat: maxMemesPerChat, minConfidence });
          summary.memesDropped += dropped;
          if (fresh.length) {
            saveMemes(g.chatKey, [...existing, ...fresh]);
            summary.memesDrafted += fresh.length;
          }
        } catch (error) {
          note(`群 ${g.chatId} 群梗收集失败`, error);
        }
      }
    }
  } catch (error) {
    note('复盘异常', error);
  }
  log(`[人设复盘] 完成：示例 ${summary.examplesDrafted} 条（质量闸拦下 ${summary.examplesDropped}）、` +
    `群梗 ${summary.memesDrafted} 条（质量闸拦下 ${summary.memesDropped}）、扫描 ${summary.chatsScanned} 个会话` +
    (summary.errors.length ? `（${summary.errors.length} 个错误）` : ''));
  return summary;
}

/**
 * 分钟级对表循环（先例：telemetry.js）。启用且当前小时 === review.hour 且
 * 今天还没跑过时触发一轮。lastRunDayKey **先记后跑**：
 * 复盘是分钟级检查 + 分钟级长任务，先落盘才能保证「同一小时内 tick 反复进来 /
 * 任务跑一半进程重启」都不会同一天重跑（最坏丢一次复盘，比重跑安全）。
 */
export function startPersonaReviewLoop({ log = console.log, store, sessions } = {}) {
  const tick = () => {
    try {
      const review = getConfig().persona?.review ?? {};
      if (!review.enabled) return;
      const rawHour = Number(review.hour);
      const hour = Number.isFinite(rawHour) ? Math.min(23, Math.max(0, Math.round(rawHour))) : 4;
      if (new Date().getHours() !== hour) return;
      const state = loadReviewState();
      const today = todayKey();
      if (state.lastRunDayKey === today) return;
      saveReviewState({ ...state, lastRunDayKey: today });
      log(`[人设复盘] 到点（${hour} 点），开始复盘…`);
      runReviewOnce({ log, store, sessions }).catch((e) => log(`[人设复盘] 异常: ${e?.message ?? e}`));
    } catch (error) {
      log(`[人设复盘] 定时检查失败: ${error?.message ?? error}`);
    }
  };
  // 启动先查一次：4 点的复盘碰上 4:30 重启的服务也能补上（当天没跑过就跑）
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
}
