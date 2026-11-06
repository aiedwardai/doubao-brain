#!/usr/bin/env node
// publish_wechat_tietu.mjs — 把烤好文字的图作为微信公众号「贴图（newspic）」发布
//
// 关键：md2wechat 的 sync-md 只能建图文(news)，贴图必须直发 draft/add + article_type:newspic。
//
// 环境变量：
//   WECHAT_APP_ID / WECHAT_APP_SECRET   目标公众号凭据（md2wechat 只认这两个名，不认 .env.jdqx 后缀变量）
//   MD2WECHAT_PKG                       md2wechat 的 wechat-api.js 绝对路径
//                                     （默认 D:/WorkBuddyData/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/md2wechat/dist/core/wechat-api.js）
//   BAKED_DIR                          烤好文字的图目录（默认 ./baked）
//   FILES                             "cover.png,shot01.png,..." 帧顺序（默认 cover + shot01..shot07）
//   TITLE / AUTHOR / DIGEST           贴图标题/作者/摘要
//   DELETE_OLD                        旧贴图草稿 media_id（填则发布后删除，避免草稿箱两版并存）
//
// 注意：Windows 下须用 import(pathToFileURL(PKG).href) 动态 import，静态 import 报 UNSUPPORTED_ESM_URL_SCHEME。

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PKG = process.env.MD2WECHAT_PKG ||
  'D:/WorkBuddyData/.workbuddy/binaries/node/versions/22.22.2-6/node_modules/md2wechat/dist/core/wechat-api.js';
const { WeChatApi } = await import(pathToFileURL(PKG).href);

const BAKED_DIR = process.env.BAKED_DIR || path.join(process.cwd(), 'baked');
const files = (process.env.FILES || 'cover.png,shot01.png,shot02.png,shot03.png,shot04.png,shot05.png,shot06.png,shot07.png')
  .split(',').map((s) => s.trim()).filter(Boolean);
const TITLE = process.env.TITLE || '连环画';
const AUTHOR = process.env.AUTHOR || '剑胆琴新';
const DIGEST = process.env.DIGEST || '';
const DELETE_OLD = process.env.DELETE_OLD || '';

if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) {
  console.error('FATAL: 须 export WECHAT_APP_ID / WECHAT_APP_SECRET'); process.exit(1);
}

const api = new WeChatApi({ appId: process.env.WECHAT_APP_ID, appSecret: process.env.WECHAT_APP_SECRET });
const token = await api.getAccessToken();

const mediaIds = [];
for (const f of files) {
  process.stdout.write(`uploading ${f} ... `);
  const r = await api.uploadImage(path.join(BAKED_DIR, f));
  mediaIds.push(r.mediaId);
  console.log('media_id =', r.mediaId);
}

const article = {
  article_type: 'newspic',
  title: TITLE,
  author: AUTHOR,
  digest: DIGEST,
  image_info: { image_list: mediaIds.map((id) => ({ image_media_id: id })) },
  need_open_comment: 0,
  only_fans_can_comment: 0,
};
const addRes = await api.request({
  path: `/cgi-bin/draft/add?access_token=${token}`,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  data: { articles: [article] },
});
console.log('NEW 贴图草稿 media_id =', addRes.media_id);

if (DELETE_OLD) {
  const delRes = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/delete?access_token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media_id: DELETE_OLD }),
  });
  console.log('DELETE 旧贴图草稿 =>', JSON.stringify(await delRes.json()));
}
console.log('DONE');
