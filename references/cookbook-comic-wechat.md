# Cookbook：连环画（角色一致）→ 烤字 → 微信公众号「贴图」发布

把 doubao-brain 的生图能力，接到一条可复用的下游流水线：

> **生成角色一致的连环画（参考图锁人）→ 把每帧文案烤进图下方 → 去水印 → 作为微信公众号「贴图（图片消息 / newspic）」发布**

适用场景：用户要做一组风格统一、人物一致的小人书 / 四格 / 连环画，并发布到自己的公众号（贴图形态，滑动看图时图文一体）。

> 本 cookbook 只覆盖「生图之后的处理与发布」；生图前的能力切换、登录等仍走 `SKILL.md` 与 `references/` 通用章节。

---

## 0. 总览与产物

| 阶段 | 工具 | 关键产物 |
| --- | --- | --- |
| ① 生图（角色一致） | doubao-brain（`gen_ref.mjs`） | `cover.png` ~ `shotNN.png` |
| ② 烤字进图 | ffmpeg `drawtext`（`bake_captions.mjs`） | `baked/*.png`（图下两行中文） |
| ③ 去水印（可选） | ffmpeg（`bake_captions.mjs --clean`） | `baked/*.png`（纯黑白 + 裁底） |
| ④ 发贴图 | md2wechat `WeChatApi`（`publish_wechat_tietu.mjs`） | 公众号「贴图」草稿（newspic） |

脚本位置：`<skill-root>/scripts/recipes/`（`gen_ref.mjs` / `bake_captions.mjs` / `publish_wechat_tietu.mjs` / `fonts.conf`）。
运行前把一张中文 CJK 字体（如 `C:/Windows/Fonts/simhei.ttf` 黑体）拷到 `scripts/recipes/` 下命名为 `simhei.ttf`。

---

## 1. 生图：用参考图锁定人物（角色一致性）

**痛点**：豆包每次生图都是独立采样，同一角色跨图长相漂移，连环画会"换头"。

**已验证方法**：走「对话模式 + 上传参考图 + 明确保留/改变」，而**不是**「图像生成」面板（面板无参考图控件，仅头像上传 input）。

核心四步（详见 `gen_ref.mjs`）：

1. 每张图开**新对话**（`site.newThread`）避免上下文污染参考图。
2. 通过 `input[type=file]` 上传参考图，等待缩略图出现。
3. 发送前**快照**当前所有产物图 URL（含参考缩略图）作为"非新增"基准。
4. 注入 prompt 并发送后，**只取发送后新增、且不在基准中的产物图**（否则会抓到常驻 UI 图 / 参考缩略图，导致多张同 MD5）。

prompt 写法（关键）：以参考图为**唯一身份锚点**，先声明"保留脸型/五官/发型/年龄气质/辨识度"，再写"重绘为 XX 风格 + 本帧场景"。例如封面：

```
使用参考图中的人物作为唯一身份锚点，保留其脸型、五官比例、发型、年龄气质与辨识度，
将其重绘为纯黑白钢笔线描的小人书风格；画面为……（本帧场景描述）。
```

取图逻辑必须用「发送前后快照差异」：

```js
const preImgs = await artifactUrls(page);        // 发送前
// ... 发送 ...
const cur = await artifactUrls(page);
const fresh = cur.filter((u) => !seen.has(u));  // 只取新增
const target = fresh[fresh.length - 1];         // 最新生成的那张
```

> 不这么做会踩坑：初版用"页面任意 width>200 图片"取到常驻 UI 图，导致 cover/shot01/shot02 同 MD5。
> `extractArtifacts` + `filterArtifacts`（识别 `flow-imagex`/`byteimg` 域名、排除头像/图标）已内置在 `site.mjs`。

**角色一致性四法**（按可靠度）：锁文字锚点 > 锁参考图 > 锁 seed（豆包未开放）> 后期换脸 LoRA。

---

## 2. 烤字进图：ffmpeg `drawtext`（中文）

**为什么**：公众号「贴图（newspic）」只有 **1 个标题 + 1 个摘要**，**没有"每张图下方单独配文"字段**。要实现"滑动图片、下面文字跟着动"，只能把文案**直接烤进每张图底部**，再整组发贴图。

布局：原图缩放 → 底部加 220px 白边 → 浅灰分隔线 → 两行中文（上行"第X幅·标题"、下行"一句描述"）。

```bash
ffmpeg -y -i in.png -vf "
scale=1080:-1,
pad=1080:ih+220:0:0:color=white,
drawbox=x=80:y=h-185:w=iw-160:h=2:color=0xcccccc:t=fill,
drawtext=fontfile=simhei.ttf:text='第一幅 · 异乡少年':fontcolor=0x1a1a1a:fontsize=46:x=(w-tw)/2:y=h-156,
drawtext=fontfile=simhei.ttf:text='走下大巴，怯懦而专注':fontcolor=0x555555:fontsize=32:x=(w-tw)/2:y=h-96
" out.png
```

### ffmpeg 中文渲染三坑（已解决，必看）

1. **fontconfig 缺默认配置**：本机 ffmpeg 启用 fontconfig 但无默认 config，`drawtext` 直接报 `Error initializing filters`。
   → 自建最小 `fonts.conf`（含 `<dir>` 指向字体目录），并设 `FONTCONFIG_FILE` / `FONTCONFIG_PATH` 环境变量。
2. **fontfile 路径不能含冒号**：`C:/Windows/Fonts/simhei.ttf` 里的 `:` 会被滤镜解析当参数分隔符 → 报错。
   → 把字体拷到工作目录，用相对名 `simhei.ttf`。
3. **中文需 `simhei.ttf`（黑体）等 CJK 字体**；单值用单引号 `text='中文'`；两行用两个 `drawtext` 串联，居中 `x=(w-tw)/2`。

`scripts/recipes/fonts.conf` 已备好，脚本会自动注入环境变量。字体请自行拷入 `simhei.ttf`。

---

## 3. 去水印（B 方案，可选）

豆包产物带「豆包AI生成」水印（多在右下角底部带），部分图有模型色偏（如淡红血点）。一次性处理：

```bash
ffmpeg -y -i in.png -vf "
hue=s=0,                              # 去色（顺带消淡红血点）
crop=iw:ih*0.90:0:0,                # 裁掉底部10%（含水印带）
scale=1080:-1,
pad=1080:ih+220:0:0:color=white,
drawbox=...,drawtext=...             # 同第2节烤字
" out.png
```

> 实测 8 张水印都在右下角底部约 10% 区域，一刀切 `crop=iw:ih*0.90` 干净无残留。去色后彩色血点自然转灰融进墨线。

---

## 4. 发公众号「贴图」（newspic）

**关键认知**：用户要的"贴图" = 微信**图片消息** = `article_type:"newspic"`，**不是**图文文章。

- md2wechat 的 `sync-md` **只能建图文(news)**，建不出贴图——贴图必须直发 `draft/add`。
- 结构（最多 20 张图，首张即封面；图片必须是**永久 MediaID**）：

```json
{
  "articles": [{
    "article_type": "newspic",
    "title": "≤32字", "author": "≤16字", "digest": "≤128字",
    "image_info": { "image_list": [ {"image_media_id":"..."}, ... ] },
    "need_open_comment": 0, "only_fans_can_comment": 0
  }]
}
```

### 账号环境变量映射（重要坑）

md2wechat 只读 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`，**不认** `.md2wechat/.env.jdqx` 里的 `WECHAT_APPID_JDQX` 等后缀变量。
运行须**内联导出**目标账号的 appid/secret：

```bash
export WECHAT_APP_ID=wxf6c4d9bd43660878
export WECHAT_APP_SECRET=xxxxxxxxxxxxxxxx
node scripts/recipes/publish_wechat_tietu.mjs
```

### 流程（`publish_wechat_tietu.mjs`）

1. `new WeChatApi({ appId, appSecret })` → `getAccessToken()`。
2. 逐张 `uploadImage(<baked>.png)`（永久素材）→ 收集 `media_id`。
3. `request({ path: '/cgi-bin/draft/add?access_token=...', method:'POST', data:{ articles:[{article_type:'newspic', ...}] } })` → 拿到新草稿 `media_id`。
4. （可选）`fetch('/cgi-bin/draft/delete', { media_id: OLD })` 删旧草稿。

### 核验草稿（易错点）

- `draft/batchget` **只列举图文(news)草稿**，贴图(newspic)不在其列——返回 0 条 ≠ 贴图丢失。
- 必须用 `draft/get?media_id=<新ID>` 单独核验：`news_item[0].article_type === 'newspic'` 且 `image_info.image_list.length === 8`。

### Windows ESM 注意

脚本 import md2wechat 的 `wechat-api.js` 时，静态 `import` 报 `UNSUPPORTED_ESM_URL_SCHEME`，
须用 `import(pathToFileURL(PKG).href)` **动态 import**；`PKG` 路径通过 env `MD2WECHAT_PKG` 传入（默认指向本机已装路径）。

### 群发

草稿建好**还不算发出**。两条路：
- 自己在公众号后台「草稿箱 → 群发」点一下；
- 或调 `cgi-bin/freepublish/submit`（不可逆，且图带水印时建议先审）。

---

## 5. 端到端示例（参数化调用）

```bash
# ① 生图（参考图锁人）：REF / PROMPTS_DIR / OUT_DIR 用环境变量
REF="$HOME/Desktop/小人书/童年.jpg" \
PROMPTS_DIR="./prompts" OUT_DIR="./raw" \
node scripts/recipes/gen_ref.mjs

# ② 烤字 + 去水印：IN_DIR / OUT_DIR / FRAMES(json) 用环境变量
IN_DIR="./raw" OUT_DIR="./baked" \
FRAMES_JSON='[{"src":"cover.png","title":"《荒原少年》","desc":"南非荒原上的孤独少年"}, ...]' \
node scripts/recipes/bake_captions.mjs --clean

# ③ 发贴图：WECHAT 账号 + md2wechat 包路径
export WECHAT_APP_ID=xxxx WECHAT_APP_SECRET=xxxx
MD2WECHAT_PKG="/path/to/md2wechat/dist/core/wechat-api.js" \
BAKED_DIR="./baked" \
node scripts/recipes/publish_wechat_tietu.mjs
```

---

## 6. 失败与坑速查

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 多张图同 MD5 | 取图抓到常驻 UI 图 / 参考缩略图 | 「发送前后快照差异」只取新增（`gen_ref.mjs`） |
| `Error initializing filters` | ffmpeg 缺 fontconfig 配置 | 自建 `fonts.conf` + 设 `FONTCONFIG_FILE` |
| drawtext 报 `invalid` | fontfile 含 `:` | 字体拷本地用相对名 |
| 建出的是"文章"不是"贴图" | 用了 `sync-md` | 直发 `draft/add` + `article_type:newspic` |
| `invalid appid` | 读了 `.env.jdqx` 后缀变量 | 内联导出 `WECHAT_APP_ID/SECRET` |
| batchget 返回 0 条 | 它只列图文草稿 | 用 `draft/get?media_id=` 核验 newspic |
| thumb 上传失败 | 封面 >64KB | 无需封面（贴图用首图当封面，不单独传 thumb） |

---

## 维护者注

- 本 cookbook 对应的原始工程：`D:/AIworkspace/workbuddy/1105-批量小人书/publish/`（含 `gen_ref.mjs`、`bake.mjs`、`clean_bake.mjs`、`publish_tietu_baked2.mjs`、原图与成品）。
- 脚本已从绝对路径改为**环境变量参数化**，可跨工程复用；md2wechat 包路径用 `MD2WECHAT_PKG` 注入。
- 版本：纳入 doubao-brain **3.1.0**。
