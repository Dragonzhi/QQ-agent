// 〔游戏页签〕—— AI 玩游戏的实时实况。
//
// 设计约束：本页面游戏无关。它只渲染 /api/game/state 返回的标准快照
//（vitals 键值对 / feed 动态流 / chat 聊天流 / stats），不出现任何 MC 概念。
// 当前提供数据的是 skills/minecraft；以后换成别的游戏，页面零改动。
//
// 轮询：只在页签活跃时每 3s 拉一次（离开就停，不白烧请求）。
// 模型视角：点动态流里任意一轮，看那一轮的思考/提示词/原始输出/执行链。

let gameTimer = null;
let gameSelectedT = 0;   // 选中的轮次（0 = 跟随最新）
const GAME_POLL_MS = 3000;

function fmtAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return s + 's\u524d';
  if (s < 3600) return Math.round(s / 60) + 'min\u524d';
  return Math.round(s / 3600) + 'h\u524d';
}

function fmtUptime(sec) {
  if (!sec) return '-';
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  if (h > 0) return h + '\u5c0f\u65f6' + (m % 60) + '\u5206';
  return m + '\u5206\u949f';
}

function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}


/** 页签骨架（首次进入时建一次，之后只更新数值）。 */
function gameSkeleton() {
  return [
    '<div class="game-head">',
    '  <div class="game-title-row">',
    '    <span id="game-dot" class="game-dot off"></span>',
    '    <span id="game-title" class="game-title">\u52a0\u8f7d\u4e2d\u2026</span>',
    '    <span id="game-phase" class="game-phase"></span>',
    '    <span class="game-spacer"></span>',
    '    <button id="game-btn-online" class="btn btn-primary">\u4e0a\u7ebf</button>',
    '    <button id="game-btn-offline" class="btn btn-danger">\u4e0b\u7ebf</button>',
    '  </div>',
    '  <div id="game-stats" class="game-stats"></div>',
    '</div>',
    '<div class="game-grid">',
    '  <div class="game-card">',
    '    <div class="game-card-title">\u5f53\u524d\u72b6\u6001</div>',
    '    <div id="game-vitals" class="game-vitals"></div>',
    '  </div>',
    '  <div class="game-card">',
    '    <div class="game-card-title">\u52a8\u6001\uff08\u70b9\u67d0\u4e00\u8f6e\u770b\u6a21\u578b\u89c6\u89d2\uff09</div>',
    '    <div id="game-feed" class="game-feed"></div>',
    '  </div>',
    '  <div class="game-card">',
    '    <div class="game-card-title">\u6e38\u620f\u5185\u804a\u5929</div>',
    '    <div id="game-chat" class="game-feed"></div>',
    '  </div>',
    '</div>',
    '<div class="game-card game-detail-card">',
    '  <div class="game-card-title">\u6a21\u578b\u89c6\u89d2\uff08\u9009\u4e2d\u7684\u90a3\u4e00\u8f6e\uff0c\u9ed8\u8ba4\u6700\u65b0\uff09</div>',
    '  <div id="game-detail"></div>',
    '</div>',
    '<div id="game-err" class="game-err"></div>',
  ].join('');
}

function bindGameButtons() {
  const on = $('#game-btn-online');
  if (on) on.addEventListener('click', async () => {
    on.disabled = true;
    try {
      const r = await api('/api/game/control', { method: 'POST', body: JSON.stringify({ action: 'online' }) });
      if (r && r.ok === false) showAppAlert(r.error || '\u4e0a\u7ebf\u5931\u8d25');
    } catch (e) { showAppAlert('\u4e0a\u7ebf\u5931\u8d25\uff1a' + (e.message || e)); }
    on.disabled = false;
    loadGameView({ quiet: true });
  });
  const off = $('#game-btn-offline');
  if (off) off.addEventListener('click', async () => {
    const yes = await uiConfirm('\u786e\u5b9a\u8ba9\u5b83\u4e0b\u7ebf\uff1f\u4e16\u754c\u4f1a\u4fdd\u5b58\u3002');
    if (!yes) return;
    off.disabled = true;
    try {
      await api('/api/game/control', { method: 'POST', body: JSON.stringify({ action: 'offline' }) });
    } catch (e) { showAppAlert('\u4e0b\u7ebf\u5931\u8d25\uff1a' + (e.message || e)); }
    off.disabled = false;
    loadGameView({ quiet: true });
  });
}

/** 模型视角：某一轮的完整过程（思考/提示词/原始输出/执行链）。 */
function renderGameDetail(f) {
  const box = $('#game-detail');
  if (!box) return;
  if (!f) { box.innerHTML = '<div class="game-empty">\u8fd8\u6ca1\u5f00\u59cb\uff0c\u4e0a\u7ebf\u540e\u8fd9\u91cc\u663e\u793a\u5b83\u6bcf\u8f6e\u7684\u601d\u8003\u548c\u52a8\u4f5c</div>'; return; }
  const sec = (title, body, open) => {
    if (!body) return '';
    return '<details class="game-sec"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><pre>' + esc(body) + '</pre></details>';
  };
  const chain = (f.results || []).map((r, i) => {
    const a = (f.actionsRaw && f.actionsRaw[i]) || {};
    const args = Object.entries(a).filter(([k]) => k !== 'action').map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ');
    return '<div class="game-step"><b>' + esc(a.action || '?') + '</b>' + (args ? '<span class="game-step-args">' + esc(args) + '</span>' : '') + '<span class="game-step-res">' + esc(r) + '</span></div>';
  }).join('');
  box.innerHTML =
    '<div class="game-detail-head">' +
      '<span class="game-round">\u7b2c ' + esc(f.round) + ' \u8f6e</span>' +
      '<span class="game-item-t">' + fmtAgo(f.t) + '</span>' +
      '<span class="game-dur">\u8017\u65f6 ' + ((f.durationMs || 0) / 1000).toFixed(1) + 's</span>' +
      '<span class="game-tok">' + fmtTokens(f.usage && f.usage.total_tokens) + ' tokens</span>' +
    '</div>' +
    (f.think ? '<div class="game-think"><b>\u5b83\u60f3\uff1a</b>' + esc(f.think) + '</div>' : '') +
    sec('\u6a21\u578b\u601d\u8003', f.reasoning, true) +
    sec('\u63d0\u793a\u8f93\u5165\uff08\u5b83\u770b\u5230\u7684\u4e16\u754c\uff09', f.promptUser) +
    sec('\u539f\u59cb\u8f93\u51fa', f.raw) +
    (chain ? '<div class="game-chain">' + chain + '</div>' : '<div class="game-empty">\u8fd9\u4e00\u8f6e\u6ca1\u6709\u52a8\u4f5c</div>');
}

function renderGame(d) {
  const dot = $('#game-dot');
  if (!dot) return;   // 页签已经切走，不要写进已隐藏的 DOM
  const on = d.active === true;
  dot.className = 'game-dot ' + (on ? 'on' : 'off');
  const title = $('#game-title');
  if (title) title.textContent = d.title || (d.game || '\u6e38\u620f');
  const phase = $('#game-phase');
  if (phase) phase.textContent = on ? (d.loopRunning ? '\u6b63\u5728\u73a9' : '\u5728\u7ebf') : '\u672a\u4e0a\u7ebf';
  const s = d.stats || {};
  const stats = $('#game-stats');
  if (stats) {
    const rows = [
      ['\u8f6e\u6b21', s.rounds || 0],
      ['tokens', fmtTokens(s.tokens)],
      ['\u5df2\u73a9', fmtUptime(s.uptimeSec)],
      ['\u5206\u4eab', s.shares || 0],
      ['\u73a9\u5bb6', (d.players || []).join('\u3001') || '-'],
    ];
    stats.innerHTML = rows.map(r => '<span class="game-stat"><b>' + esc(r[1]) + '</b>' + esc(r[0]) + '</span>').join('');
  }
  const vitals = $('#game-vitals');
  if (vitals) {
    const list = d.vitals || [];
    vitals.innerHTML = list.length
      ? list.map(v => '<div class="game-vital"><span>' + esc(v.label) + '</span><b>' + esc(v.value) + '</b></div>').join('')
      : '<div class="game-empty">\u672a\u4e0a\u7ebf\uff0c\u70b9\u53f3\u4e0a\u89d2\u300c\u4e0a\u7ebf\u300d\u5f00\u59cb</div>';
  }
  // 动态流（可点选，选中态）
  const feed = $('#game-feed');
  if (feed) {
    const list = d.feed || [];
    feed.innerHTML = list.length
      ? list.map(f => '<div class="game-item game-item-btn' + (f.t === gameSelectedT ? ' sel' : '') + '" data-t="' + f.t + '"><span class="game-item-t">' + fmtAgo(f.t) + '</span><b>' + esc(f.title) + '</b>' + (f.detail ? '<span class="game-item-d">' + esc(f.detail) + '</span>' : '') + '</div>').join('')
      : '<div class="game-empty">\u8fd8\u6ca1\u5f00\u59cb</div>';
    $$('.game-item-btn', feed).forEach(el => el.addEventListener('click', () => {
      gameSelectedT = Number(el.dataset.t) || 0;
      const picked = (d.feed || []).find(x => x.t === gameSelectedT);
      renderGameDetail(picked || null);
      $$('.game-item-btn', feed).forEach(x => x.classList.toggle('sel', Number(x.dataset.t) === gameSelectedT));
    }));
  }
  // 聊天流
  const chat = $('#game-chat');
  if (chat) {
    const list = d.chat || [];
    chat.innerHTML = list.length
      ? list.slice().reverse().map(c => '<div class="game-item"><span class="game-item-t">' + fmtAgo(c.t) + '</span><span>' + esc(c.text) + '</span></div>').join('')
      : '<div class="game-empty">\u5b89\u9759</div>';
  }
  // 模型视角：选中轮（0=最新）
  const list2 = d.feed || [];
  const cur = gameSelectedT ? list2.find(x => x.t === gameSelectedT) : list2[0];
  renderGameDetail(cur || null);
  const err = $('#game-err');
  if (err) err.textContent = d.lastError || '';
}


async function loadGameView({ quiet = false } = {}) {
  const page = $('#game-page');
  if (!page) return;
  if (!page.dataset.built) {
    page.innerHTML = gameSkeleton();
    page.dataset.built = '1';
    bindGameButtons();
  }
  try {
    const d = await api('/api/game/state');
    renderGame(d);
  } catch (e) {
    if (!quiet) showAppAlert('\u52a0\u8f7d\u5931\u8d25\uff1a' + (e.message || e));
  }
}

function startGamePoller() {
  if (gameTimer) return;
  gameTimer = setInterval(() => {
    if (state.tab !== 'game') return;   // 不在这个页签就不请求
    loadGameView({ quiet: true });
  }, GAME_POLL_MS);
}

function stopGamePoller() {
  if (gameTimer) clearInterval(gameTimer);
  gameTimer = null;
}
