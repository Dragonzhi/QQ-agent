#!/usr/bin/env node
// QQ-Agent 实例重启（Windows）：停旧实例 → 拉起 → 校验就绪。
//
// 为什么要有这个脚本：手工重启踩过两次坑 ——
//   ① 本机常见环境变量 ELECTRON_RUN_AS_NODE=1：直接起 electron.exe 会被当普通 Node 跑，
//      报 cjsPreparseModuleExports / "Cannot read properties of undefined"；
//   ② 只杀主进程不杀树：SnowLuma 子进程成孤儿、下一次启动抢端口。
// 细节与手工步骤见 .agents/skills/qq-agent-restart/SKILL.md。
//
// 用法：
//   node scripts/restart-app.mjs              # 自动识别原实例（electron / headless node）
//   node scripts/restart-app.mjs --electron   # 强制桌面端
//   node scripts/restart-app.mjs --headless   # 强制 node src/server.js
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(ROOT, 'data', 'qq-agent.lock');
const CONFIG = path.join(ROOT, 'data', 'config.json');
const argv = new Set(process.argv.slice(2));
const FORCE_ELECTRON = argv.has('--electron');
const FORCE_HEADLESS = argv.has('--headless');
const TIMEOUT_MS = 90_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}

function readLockPid() {
  try {
    const n = Number(fs.readFileSync(LOCK, 'utf8').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

/** 进程镜像名（electron.exe / node.exe）；拿不到返回空串。 */
function imageOf(pid) {
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  const first = String(r.stdout || '').trim().split(/\r?\n/)[0] || '';
  const m = first.match(/^"([^"]+)"/);
  return m ? m[1].toLowerCase() : '';
}

function portOf() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const p = Number(cfg?.server?.port);
    return Number.isInteger(p) && p > 0 ? p : 3210;
  } catch { return 3210; }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function todayLog() {
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(ROOT, 'data', 'logs', `qq-agent-${key}.log`);
}

function logTail(lines = 15) {
  try {
    const text = fs.readFileSync(todayLog(), 'utf8');
    return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
  } catch { return '(读不到今天日志)'; }
}

function fail(message) {
  const error = new Error(message);
  error.logTail = logTail();
  throw error;
}

async function main() {
  const oldPid = readLockPid();
  let mode = FORCE_HEADLESS ? 'node' : 'electron';

  if (oldPid && pidAlive(oldPid)) {
    const image = imageOf(oldPid);
    // 原来的实例是 headless（node src/server.js）就沿用，别把运行方式换掉
    if (!FORCE_ELECTRON && !FORCE_HEADLESS && image && !image.includes('electron')) mode = 'node';
    console.log(`[restart] 停止旧实例 PID ${oldPid}（${image || '未知进程'}）…`);
    spawnSync('taskkill', ['/PID', String(oldPid), '/T', '/F'], { windowsHide: true });
    const stopBy = Date.now() + 15_000;
    while (pidAlive(oldPid) && Date.now() < stopBy) await sleep(250);
    if (pidAlive(oldPid)) fail(`PID ${oldPid} 15 秒内没有退出`);
    console.log('[restart] 已停止');
  } else if (oldPid) {
    console.log(`[restart] 锁文件 PID ${oldPid} 已不在运行（上次强杀留下的残留锁），直接启动`);
  } else {
    console.log('[restart] 没有发现运行中的实例，直接启动');
  }

  // 关键坑：带 ELECTRON_RUN_AS_NODE=1 时 electron.exe 会退化成 Node
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  let child;
  if (mode === 'node') {
    child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
      cwd: ROOT, detached: true, stdio: 'ignore', env
    });
  } else {
    const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    if (!fs.existsSync(exe)) fail('找不到 node_modules/electron/dist/electron.exe —— 先 npm install');
    child = spawn(exe, [ROOT], { cwd: ROOT, detached: true, stdio: 'ignore', env, windowsHide: false });
  }
  child.unref();
  console.log(`[restart] 已拉起 ${mode}（启动器 PID ${child.pid}），等待就绪…`);

  const port = portOf();
  const deadline = Date.now() + TIMEOUT_MS;
  let lockPid = null;
  let config = null;
  while (Date.now() < deadline) {
    await sleep(500);
    const pid = readLockPid();
    if (!pid || pid === oldPid || !pidAlive(pid)) continue;
    try {
      const res = await getJson(`http://127.0.0.1:${port}/api/config`);
      if (res.status === 200) {
        const parsed = JSON.parse(res.body);
        config = parsed.config || parsed;
        lockPid = pid;
        break;
      }
    } catch { /* 还没起来 */ }
  }
  if (!lockPid || !config) fail(`等不到就绪（控制台 http://127.0.0.1:${port} 无 200，或新实例没写锁）`);

  // OneBot 连接是异步的：再给最多 20 秒，看日志里是否有「连接成功」
  let onebotOk = false;
  const onebotBy = Date.now() + 20_000;
  while (Date.now() < onebotBy) {
    if (/\[onebot\][^\n]*连接成功/.test(logTail(40))) { onebotOk = true; break; }
    await sleep(1000);
  }

  const review = config?.persona?.review || {};
  console.log(`[restart] 就绪：实例 PID ${lockPid}，控制台 http://127.0.0.1:${port} 返回 200`);
  console.log(`[restart] OneBot：${onebotOk ? '已连接' : '20 秒内未见「连接成功」日志（可能刚启动，稍后看日志）'}`);
  console.log(`[restart] 复盘阈值：minConfidence=${review.minConfidence ?? '(未返回)'}，maxMemesPerChat=${review.maxMemesPerChat ?? '(未返回)'}`);
  if (review.minConfidence === undefined) {
    console.log('[restart] 注意：/api/config 里没有新阈值键 —— 代码可能没被加载（检查是否起错目录/旧进程未停）');
  }
  console.log(`[restart] 日志：data/logs/${path.basename(todayLog())}`);
}

main().catch((error) => {
  console.error(`[restart] 失败：${error.message}`);
  if (error.logTail) console.error(`\n--- 今天日志末尾 ---\n${error.logTail}`);
  process.exitCode = 1;
});
