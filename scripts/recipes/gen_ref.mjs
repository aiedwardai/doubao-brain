#!/usr/bin/env node
// gen_ref.mjs — 用 doubao-brain 参考图生图（角色一致性批量生成）
//
// 方法（已验证）：对话模式 + 上传参考图 + 发送前后快照差异取图。
// 依赖 dbb 内部模块（scripts/dbb/src），自动按本脚本位置解析 skill 根目录，跨机可复用。
//
// 环境变量：
//   REF           参考图绝对路径（必填）
//   PROMPTS_DIR   各帧 prompt 文本目录（默认 ./prompts，含 cover.txt ~ shotNN.txt）
//   OUT_DIR       输出目录（默认 ./raw）
//   SHOTS         "name:file,name:file,..." 帧定义（默认 cover:cover,shot01:shot01,...,shot07:shot07）
//   TIMEOUT_MS    单帧超时（默认 600000）

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..', '..');             // scripts/recipes -> skill root
const DBB_SRC = path.join(SKILL_ROOT, 'scripts', 'dbb', 'src');
const { launchBrowser, openPage } = await import(pathToFileURL(path.join(DBB_SRC, 'browser.mjs')).href);
const site = await import(pathToFileURL(path.join(DBB_SRC, 'site.mjs')).href);

const REF = process.env.REF;
const PROMPTS_DIR = process.env.PROMPTS_DIR || path.join(process.cwd(), 'prompts');
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'raw');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 600000);

if (!REF || !fs.existsSync(REF)) {
  console.error('FATAL: 环境变量 REF 必须指向存在的参考图'); process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOTS = (process.env.SHOTS || 'cover:cover,shot01:shot01,shot02:shot02,shot03:shot03,shot04:shot04,shot05:shot05,shot06:shot06,shot07:shot07')
  .split(',').map((s) => { const [name, file] = s.split(':'); return { name, file: (file || name) + '.txt' }; });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function artifactUrls(page) {
  const art = await site.extractArtifacts(page, { autoScroll: false });
  const f = site.filterArtifacts(art);
  return f.images.map((i) => i.url).filter(Boolean);
}
async function getCookieHeader(context) {
  const cookies = await context.cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
async function download(url, cookieHeader) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36',
      referer: 'https://www.doubao.com/',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error('DOWNLOAD_FAIL ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function genOne(page, context, name, promptFile) {
  await site.newThread(page);
  await sleep(2500);
  await site.waitForEditor(page, { timeoutMs: 90000, pollMs: 2000 });

  await page.locator('input[type="file"]').first().setInputFiles([REF], { timeout: 60000 });
  await sleep(4000);

  const preImgs = await artifactUrls(page);
  const inj = await site.injectPrompt(page, fs.readFileSync(promptFile, 'utf8').trim());
  if (!inj.ok) throw new Error('INJECT_FAIL ' + JSON.stringify(inj));
  const sent = await site.sendPrompt(page);
  if (!sent.ok) throw new Error('SEND_FAIL ' + JSON.stringify(sent));

  const cookieHeader = await getCookieHeader(context);
  const seen = new Set(preImgs);
  let target = null;
  const polls = Math.ceil(TIMEOUT_MS / 5000);
  for (let i = 0; i < polls; i++) {
    await sleep(5000);
    const cur = await artifactUrls(page);
    const fresh = cur.filter((u) => !seen.has(u));
    if (fresh.length) { target = fresh[fresh.length - 1]; break; }
  }
  if (!target) throw new Error('NO_NEW_IMAGE_TIMEOUT');

  const buf = await download(target, cookieHeader);
  const out = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(out, buf);
  console.log(`  [${name}] 已保存 ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
}

(async () => {
  const context = await launchBrowser({ headless: false });
  const page = await openPage(context);
  await site.gotoSite(page, site.SITE_URL);
  await sleep(4000);

  let ok = 0; const fail = [];
  for (const s of SHOTS) {
    const pf = path.join(PROMPTS_DIR, s.file);
    if (!fs.existsSync(pf)) { console.log(`  [${s.name}] 跳过：找不到 ${pf}`); fail.push(s.name); continue; }
    console.log(`\n=== 生成 ${s.name} ===`);
    try { await genOne(page, context, s.name, pf); ok++; }
    catch (e) { console.log(`  [${s.name}] 失败: ${e.message}`); fail.push(s.name); }
  }
  await context.close();
  console.log(`\n==== 完成：成功 ${ok}/${SHOTS.length}，失败 [${fail.join(', ')}] ====`);
  if (fail.length) process.exitCode = 2;
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
