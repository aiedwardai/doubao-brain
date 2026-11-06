#!/usr/bin/env node
// bake_captions.mjs — 用 ffmpeg 把每帧文案烤进图下方白边，可选去水印
//
// 环境变量：
//   IN_DIR        原图目录（默认 ./raw）
//   OUT_DIR       输出目录（默认 ./baked）
//   FRAMES_JSON   JSON 数组 [{"src":"cover.png","title":"...","desc":"..."}, ...]（必填或走 FRAMES_FILE）
//   FRAMES_FILE   含上述 JSON 的文件路径（与 FRAMES_JSON 二选一）
//   FONT          CJK 字体文件名（默认 simhei.ttf，须与本脚本同目录；或给绝对路径）
//   CLEAN         设为 1 开启去水印：去色(hue=s=0) + 裁底部10%(crop=iw:ih*0.90)
//   FONTCONFIG_FILE / FONTCONFIG_PATH 自动指向本脚本同目录的 fonts.conf
//
// 用法：
//   FRAMES_JSON='[{"src":"cover.png","title":"《荒原少年》","desc":"南非荒原上的孤独少年"}]' \
//     node bake_captions.mjs            # 仅烤字
//   CLEAN=1 FRAMES_JSON='[...]' node bake_captions.mjs   # 去水印 + 烤字

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IN_DIR = process.env.IN_DIR || path.join(process.cwd(), 'raw');
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'baked');
const CLEAN = process.env.CLEAN === '1' || process.env.CLEAN === 'true';
const FONT = process.env.FONT || 'simhei.ttf';
const fontPath = path.isAbsolute(FONT) ? FONT : path.join(HERE, FONT);

let frames;
if (process.env.FRAMES_JSON) frames = JSON.parse(process.env.FRAMES_JSON);
else if (process.env.FRAMES_FILE) frames = JSON.parse(fs.readFileSync(process.env.FRAMES_FILE, 'utf8'));
else { console.error('FATAL: 须提供 FRAMES_JSON 或 FRAMES_FILE'); process.exit(1); }

if (!fs.existsSync(fontPath)) {
  console.error(`FATAL: 字体不存在 ${fontPath}（把 CJK 字体拷到脚本目录命名为 simhei.ttf，或用 FONT=绝对路径 指定）`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// 底部留白 + 分隔线 + 两行文字
function buildFilter(f) {
  const pre =
    (CLEAN ? 'hue=s=0,crop=iw:ih*0.90:0:0,' : '') +
    'scale=1080:-1,pad=1080:ih+220:0:0:color=white,';
  const box = 'drawbox=x=80:y=h-185:w=iw-160:h=2:color=0xcccccc:t=fill,';
  const t1 = `drawtext=fontfile=${fontPath}:text='${f.title}':fontcolor=0x1a1a1a:fontsize=46:x=(w-tw)/2:y=h-156`;
  const t2 = `drawtext=fontfile=${fontPath}:text='${f.desc}':fontcolor=0x555555:fontsize=32:x=(w-tw)/2:y=h-96`;
  return pre + box + t1 + ',' + t2;
}

let fail = 0;
for (const f of frames) {
  const inPath = path.join(IN_DIR, f.src);
  const outPath = path.join(OUT_DIR, f.src);
  if (!fs.existsSync(inPath)) { console.error(`SKIP ${f.src}: 不存在`); fail++; continue; }
  const r = spawnSync('ffmpeg', ['-y', '-i', inPath, '-vf', buildFilter(f), outPath], {
    cwd: HERE,
    env: { ...process.env,
      FONTCONFIG_FILE: path.join(HERE, 'fonts.conf'),
      FONTCONFIG_PATH: HERE },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(`FAIL ${f.src}:`, (r.stderr || '').split('\n').filter((l) => /error|fail|invalid|font/i.test(l)).slice(-5).join(' | '));
    fail++;
  } else {
    console.log(`OK   ${f.src} -> ${path.basename(OUT_DIR)}/${f.src} (${fs.statSync(outPath).size} bytes)${CLEAN ? ' [clean]' : ''}`);
  }
}
console.log(fail ? `DONE with ${fail} failure(s)` : 'DONE');
if (fail) process.exitCode = 2;
