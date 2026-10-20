// Minecraft 冒烟测试：起服 → bot 进服 → observe → chat → dig → stop。
// 不接进 npm test（要起 JVM + 世界生成，约 1 分钟），手动跑：
//   node test/minecraft-spike.mjs
// 退出码 0 = 全链路通。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(APP_ROOT, 'skills', 'minecraft', 'runner.mjs');
const PID_FILE = path.join(APP_ROOT, 'data', 'minecraft-runner.pid');
const PORT = Number(process.env.MC_CONTROL_PORT || 25580);

const fail = (msg) => { console.error('❌ ' + msg); process.exit(1); };
const ok = (msg) => console.log('✅ ' + msg);

async function post(p, body) {
  const r = await fetch('http://127.0.0.1:' + PORT + p, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000)
  });
  return r.json();
}

try { fs.unlinkSync(PID_FILE); } catch {}

const child = spawn(process.execPath, [RUNNER], { cwd: APP_ROOT, windowsHide: true, stdio: 'ignore', detached: true });
child.unref();

const t0 = Date.now();
let st = null;
while (Date.now() - t0 < 180000) {
  st = await post('/status').catch(() => ({}));
  if (st.phase === 'playing') break;
  if (st.phase === 'stopped') fail('runner \u542f\u52a8\u5931\u8d25\uff1a' + st.lastError);
  await new Promise(s => setTimeout(s, 2500));
}
if (!st || st.phase !== 'playing') fail('\u7b49\u5f85\u5c31\u7eea\u8d85\u65f6');
ok('runner \u5c31\u7eea\uff08' + Math.round((Date.now() - t0) / 1000) + 's\uff09');

let obs = await post('/observe', {});
if (obs.error || !obs.body) { await new Promise(s => setTimeout(s, 2000)); obs = await post('/observe', {}); }
if (obs.error || !obs.body) fail('observe \u5931\u8d25\uff1a' + JSON.stringify(obs).slice(0, 300));
ok('observe\uff1a\u4f4d\u7f6e ' + obs.body.position.x + ',' + obs.body.position.y + ',' + obs.body.position.z + ' \u8840' + obs.body.health + ' \u80cc\u5305' + obs.body.inventory.length + ' \u6839');

const chat = await post('/act', { action: 'chat', message: 'smoke test ping' });
if (chat.error) fail('chat \u5931\u8d25：' + chat.error);
ok('chat');

const dig = await post('/act', { action: 'dig', dy: -1 });
if (dig.error) fail('dig \u5931\u8d25：' + dig.error);
ok('dig\uff1a' + dig.content);

await post('/stop', {});
ok('stop \u5df2\u89e6\u53d1');

// 等 runner 干净退出
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  let alive = false;
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (!alive) break;
  await new Promise(s => setTimeout(s, 1500));
}
ok('runner \u5df2\u9000\u51fa\uff0c\u4e16\u754c\u5df2\u4fdd\u5b58');
console.log('\n\ud83c\udfae Minecraft \u5199\u771f\u6d4b\u8bd5\u5168\u901a\u8fc7');
process.exit(0);
