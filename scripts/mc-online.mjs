// 一键开服：不等机器人、不聊 QQ，直接让小鲸鱼的世界上线。
// 用法：node scripts/mc-online.mjs   （或双击 启动MC世界.bat）
// 原理：复用 skills/minecraft 的 bringGameOnline（和 mc_online 工具同一条路），
//       并手动把 skill.json 的 settings 喂给 setup，保证皮肤/Java 等配置一致。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mod = await import('../skills/minecraft/index.js');
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'skills', 'minecraft', 'skill.json'), 'utf8'));
mod.setup({ config: () => manifest.settings || {}, registerTool: () => {} });

console.log('\u6b63\u5728\u62c9\u8d77 MC \u4e16\u754c\uff08\u9996\u6b21\u5927\u7ea6 15~40 \u79d2\uff09\u2026');
try {
  const r = await mod.bringGameOnline();
  console.log('\u2705 ' + r.content);
  console.log('\u73b0\u5728\u53ef\u4ee5\u6253\u5f00 PCL2 \u542f\u52a8 1.20.1 \u5ba2\u6237\u7aef\uff0c\u8fdb\u300c\u5c0f\u9cb2\u9c7c\u7684\u4e16\u754c\u300d\u3002');
} catch (e) {
  console.error('\u274c \u5f00\u670d\u5931\u8d25\uff1a' + (e && e.message ? e.message : e));
  process.exit(1);
}