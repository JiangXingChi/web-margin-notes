---
name: "web-margin-notes"
description: "生成可复用的「Word 式边注」批注网页（Flask + 原生 JS，无 npm），指向任意 markdown 文稿：作者划词写意见，代理人读 notes.json 逐条改稿并回写状态；作者可手动标「这段改完了」，下次打开自动跳过。触发语：做一个批注/标注工具、让作者在稿子上划词提意见、Word 里那种边注、批注后按意见改稿、标已改/段落审完、下次别再让我看这些段、annotate a markdown draft with margin comments、mark paragraphs as reviewed、read annotation feedback and revise。"
version: 7.8
license: MIT
created: "2026-11-02"
updated: "2026-11-12"
---
## When to Use

作者需要在长篇 markdown（专著章节、论文、方案、PLAN）上逐句提修改意见，而代理人要能直接读到这些意见并按条改稿时使用。

典型信号：

- "我要对着稿子提意见"／"能不能划词批注"／"像 Word 一样在右边写修改意见"
- "批注完你来改"／"按我的批注改稿"
- annotate a markdown draft with margin comments, then revise from the feedback

不适用：需要在线协同编辑正文（用 docx/Google Docs）、需要 track changes 双栏对照、需要多人账号体系。

## Procedure

1. 确认文稿路径与端口：一份 markdown，一个未被占用的本地端口（默认 5178，多实例依次 5179/5180）。
2. 生成实例：`bash scripts/scaffold.sh <目标目录> <文稿.md> [端口]`。脚本复制 `templates/`、写好 `data/config.json` 与空的 `data/notes.json`，不覆盖已存在目录。
3. 起服务：`cd <目标目录> && bash start.sh`（或 `setsid python app.py > tmp.log 2>&1 &`）。只监听 127.0.0.1。
4. 自测：`python3 scripts/verify.py http://127.0.0.1:<端口>`，应输出「全部通过」（段落数、字数、锚点状态、边注对齐、无残留 `**`、无 JS 报错）。
5. 交付给作者，说明操作：划词 →「＋批注」→ `Ctrl+Enter`；点段号提段落意见；顶栏「＋ 全文意见」提整篇意见；**打开页面会自动跳到第一个没审完的段**；**段落左侧行号下方的小方框（`☐`→`☑ 已审`，已审后正文又改过则显示 `↻`，快捷键 `m`）把这一段标成审完**，段落地图变绿、顶栏显示「已审 n/总数」，底栏「下一段待审」（`u`）直接跳到下一个没标过的段。**图可直接批**：`![](path)` 段落渲染为图片，点图或「＋ 图意见」建段落级意见（`quote=""`）；`|` 表格渲染为三线表，单元格内仍可划词。**默认就是逐段模式**：打开只显示当前这一段和它自己的批注（默认不带上下段，可用底栏勾选临时带上下文），`j`/`k`/`↑↓` 翻段，`n`/`p` 跳到下/上一条批注，顶栏「全文」/`f` 切回全篇（选择记在 localStorage）；顶栏下的一排格子是段落地图（橙=有批注、灰=已读、深绿=已审、绿=已改），点格跳段。正文高亮：**待处理＝字色改橙并加粗（不铺底、不划线）**，**已改＝浅绿背景**，**段落已审＝左侧绿边＋行号下「☑ 已审」**，两种状态各占一个视觉通道；段落地图同为橙／绿。**批注卡片就地插在「被批注那一句」的下一行**（v7 起不再有右侧边注列），编辑器也在划词处浮出。
6. 读批注：`python3 scripts/read_notes.py <实例>/data/notes.json`（默认只出 `status=open`，按段排序；`--all` 含已处理，`--json` 原样输出）。
7. 改稿：只改文稿源文件；改完跑该项目自己的构建（如 docx/pdf 重建），再把处理过的条目 `status` 置 `done`，并写 `reply` 一句话说明"改成了什么"——`POST /api/notes/<id>/status {"status":"done","reply":"…"}`。页面会用绿框显示这句，作者回看时就知道改动落在哪。
8. 回环：作者 `F5` 刷新，批注按 `quote + prefix + suffix` 自动重定位；`orphan` 条目必须人工确认，不许静默丢弃。

## 段落审核（v7.4）

`data/review.json` 存作者手动标的"这段改完了"，与批注无关、与 localStorage 的「已读」也无关：

```json
{"doc": "…/稿子.md", "paras": {"12": {"hash": "ab12cd34", "at": "2026-11-12T15:13:51"}}}
```

- 写入：`POST /api/review/<para>`，body `{"done": true|false}`；`/api/doc` 回 `review` 与 `totals.reviewed`。
- 每个段落在解析时算 `phash`（正文 sha1 前 8 位）。存的 hash 与当前不一致 → 该段标 `stale`（正文改过，需重看），地图上画虚线橙框。
- 前端：段落行号下方小方框 `☐` → `☑ 已审`（正文改过显示 `↻`，悬停有提示），`m` 切换当前段；`u` 跳下一个未审段；地图 `.cell.rev` 实心绿。
- 用途：作者不必每次从头翻；代理人改完稿顺手把对应段标掉，作者回看时只管没标的。
- **筛选必须重画正文**：v7 起批注卡片随 `renderDoc()` 生成，`renderCards()` 是空函数；改 `state.filter` 后要 `renderDoc()`，否则点了「失效/已处理」什么都不变。
- **进入即跳过**：`reload()` 首次加载时按 `firstUnreviewed()` 选起跳段（全标完则退到未读段/首段），底部提示"已跳过 n 段已审，从 P# 继续"。注意只在首次加载做，保存批注后的 `reload()` 不能跳走。

## 行间公式（v7.8）

整段只有 `$$…$$` 的段落用 KaTeX 渲染（`templates/static/vendor/katex/`，本地自带，离线可用），编号 `\tag{12-1a}` 也照常显示。原文放在隐藏的 `.ptext.mathsrc` 里，锚点偏移不变；这种段落**不能划词**，只能用段号提整段意见。行内 `$…$` 仍按原文显示。

## Pitfalls

- **图片路径相对 `media_root`**：`![](figures/x.png)` 由 `/media/<path>` 供给，根目录取 `config.json` 的 `media_root`（默认是文稿所在目录）。文稿若是从 `sections/` 合并到另一个目录的快照，`media_root` 必须指回源项目目录，否则图片 404。外部 http(s) 链接直接引用，不走本路由。
- **图片/表格段不改 `text`**：只用 `figure`／`table` 标记交给前端渲染，段落文本保持原 markdown。若把 `![](a.png)` 删成空串，段号与偏移全乱，已有批注集体降级。
- **表格渲染后必须反查偏移**：DOM 里没有 `|`，`ptext.textContent` 与原文不同。`selectionInfo()` 发现 `text` 在原 markdown 的该偏移处对不上时，用 `indexOf` 反查一次再算 prefix/suffix，否则引文写入即错位。
- **orphan 批注不许画高亮**：`relocate()` 定位失败时 `offset` 常回落到 0，前端若照画，十几条失效批注会在段首叠成一大片绿，把新加的黄批注整片盖住，作者只会说「黄色看不见」。`highlightFragment()` 必须过滤 `anchor === "orphan"`，`scrollToAnchor()` 同时回退到段落。
- **两种状态不要共用背景色**：待处理若也用底色，会和已改的绿底在同一段里互相遮盖，作者分不清哪条还没处理。约定：待处理＝`color:var(--accent)` ＋加粗，已改＝`background:var(--hl-done)`；`.hl.on` 只做加深，不换通道。
- **嵌套 `<mark>` 的层次别排反**：`renderRich()` 逐个包裹，最后包的在最外层（父元素），父元素的背景画在子元素下面。想「范围小的批注颜色压在上面」，就得按范围**升序**包；同范围时让 `open` 先包，新批注才不会被旧的 `done` 盖住。
- **小标题要在解析期就去 `#`**：`## 摘要` 若原样进段落，页面会把 `##` 当正文显示，选区和偏移也会带上井号。`parse_doc()` 先剥 `^#{1,6}\s+` 再算 `text`，级别放 `head` 字段给前端做字号。
- **Markdown 粗体必须先去标记**：`**词**` 原样渲染会露星号，且 DOM 偏移与引文对不上。`app.py` 的 `strip_bold()` 返回纯文本 + `bold` 区间，前后端统一用去标记文本算偏移。
- **别用 `data-top=1e9` 表示"排到最底"**：浏览器会钳制成 33554432px，页面高度爆炸。`layoutCards()` 按 `(是否全文意见, top)` 两级排序。
- **编辑批注时传 `para_anchor`/`quote_anchor`**，不能传 `para`/`quote`——后者是原始字段，传错会把句级批注写成全文批注。
- **改完服务代码必须重启**：`fuser -k <端口>/tcp` 后再起，否则测到的还是旧逻辑；静态文件走缓存时 `Ctrl+Shift+R`。
- **公式段别删原文**：`.mathbox` 只是渲染层，隐藏的 `.mathsrc` 必须保留原 TeX，否则 `offset` 全乱；KaTeX 只对「整段是 $$…$$」生效，别对行内 `$…$` 用，否则选区偏移算不准。
- **`start.sh` 不要写死解释器**：用 `${PYTHON:-python3}`，别把某台机器的 conda 路径带进模板。
- **起跳位置不能靠 localStorage**：`已读` 是浏览器本地的浏览痕迹，不等于"改完了"；进入页面要按服务端 `review.json` 选段，否则换机器就又把已改段翻一遍。
- **「已审」不能存 localStorage**：已读进度是按浏览器的，换机器/换浏览器就丢；标「审完了」必须落 `data/review.json`，作者才敢关页面。
- **审完标记要带段落哈希**：只存段号，正文一改就对不上；存 `phash` 并回 `stale`，否则作者以为看过、其实那段已经变了。
- **字数口径要说明**：`/api/doc` 的 `chars` 不含标题行，构建脚本打印的含标题，差值等于标题字数，属正常。
- **重叠批注要嵌套渲染**：同段两条批注的区间可能相交，`renderRich()` 先按边界切段、每条覆盖该段的批注由外到内嵌套 `<mark>`，否则后一条没有高亮、用户找不到锚点。
- **同一个词一段里出现多次时，`relocate()` 不能只用 `text.find(quote)`**：那样所有「候选」都被吸到第一次出现的位置，前端算得再对也没用。必须「存下的 offset → 前后文 prefix/suffix → find() 兜底」三级消歧（`_find_quote()`）。
- **段落被行内卡片切段后，选区偏移要按整段累加**：`selectionInfo()` 若用 `ptext.textContent` 取长度，偏移只是当前片段的，写进库就整体错位，卡片自然跑到别的句子下面。要遍历该段所有 `.ptext` 依次累加。
- **改锚点不能走 `/api/notes` 的编辑分支**：带 `id` 的 POST 只更新 `text`/`tags`，`offset`/`prefix`/`suffix` 一律忽略。要挪锚点只能直接改 `data/notes.json`。
- **表格段与标题段不能按句切**：`p.table`／`p.head` 走整块渲染分支，若只画文本不补卡片，作者在这些段落里划的词就会「点了保存却什么都没出现」。整块渲染完必须把该段所有 inline 批注依次 append 上去。
- **偏移越界的高亮要夹紧不能丢**：`offset + quote.length > 段长` 时若直接 `filter` 掉，卡片会连高亮一起消失。先 `e = min(e, 段长)` 再判断，并在段末加一道「未渲染兜底」，保证任何可见批注至少以卡片形式出现一次。
- **切点取「最近的分隔符」而不是「句末」**：只按句号切，标句中一个词时卡片会落到两三行之外，作者会说「不在对应句子下面」。现用 `cutPoint()`：在引文之后找第一个 `，、；：`，比句末近就用它，整句没有分隔符才退到 `sentenceEnd()`。代价是卡片插进句子中间、后文另起一段，这是为了贴近被批注的词。
- **遗留的 `!important` 会压过内联样式**：老版响应式规则里的 `.card{position:static!important}` 会让 `element.style.position="fixed"` 失效（`cssText` 看着对，`getComputedStyle` 仍是 static），表现是编辑器跑到页面最底部。改版式时先清掉旧媒体查询里的 `!important`。
- **别把"下移"判成错位**：两条批注靠得近时后一条必然被推下去，判据应是"卡片不得高于锚点"。
- **grid 拉伸会让高度自锁**：`.layout` 是两列 grid，边注列 `min-height` 撑高后，正文列被 stretch 到同高；若下一次又用 `docEl.offsetHeight` 算 `min-height`，就会一层层放大（实测 970 → 4413px）。修法：`layoutCards()` 先把 `marginEl.style.minHeight = "0px"` 再测量。
- **默认视图要是逐段**：作者面对长稿打开就看见 24 段会直接放弃；`state.mode` 默认 `focus`，末次选择写 `localStorage`。
- **本地工具必须禁缓存**：`after_request` 给 `/` 与 `/s/*` 加 `Cache-Control: no-store`，否则改了前端作者刷新看不到。
- **不要写回稿件目录**：工具只读 markdown，所有写入限制在实例的 `data/` 与 `export/`。

## Verification

- `scripts/verify.py <base_url>` 退出码 0 且打印「全部通过」。
- 图片可见：`curl -s -o /dev/null -w '%{http_code}' <base>/media/<fig>` 得 200；`<base>/media/../app.py` 得 404。
- 点图建的意见可落盘：POST `/api/notes` 带 `quote:""`、`para`=图段号后，`/api/doc` 回 `anchor=exact`。
- 全文模式段落数与 `/api/doc` 一致；逐段模式只渲染 1 段（勾"带上下段"时 ≤3）；正文无 `**` 残留；参考文献区可折叠（逐段模式不显示）。
- 建一条批注 → `F5` 仍在；杀进程重启 → 仍在（`data/notes.json` 持久）。
- 图段：`curl -s -o /dev/null -w "%{http_code}" <base>/media/<fig>` 得 200，`<base>/media/../app.py` 得 404；`/api/doc` 的 `figure`／`table` 段数与文稿里的 `![](...)`／`|` 表一致。
- 点图建的意见能落盘：POST 带 `quote:""`、`para`=图段号后，`/api/doc` 回 `anchor=exact`。
- 手工改动文稿约 10% 文字后刷新：未受影响批注仍精确对齐；轻微改动标 `fuzzy`；删掉/乱改标 `orphan`；不静默丢失。
- 边注卡片不得高于其锚点；相邻卡片不重叠（1280/1512/1920 三档）。**因避让前一条而下移是正常的**，`verify.py` 单列"避让下移"计数，别当错位。
- 逐段模式（默认）：**只渲染当前段**（勾选"带上下段"才显示 ±1 段淡显），`j`/`k` 翻段，`n`/`p` 跳批注，底栏显示 `P# / N`；页面不滚动（scrollHeight ≈ 视口高）；段落地图与已读计数同步。
- `export/意见清单.md` 与 `notes.json` 的条数、顺序、引文一致。
- 已读进度按**文稿路径**记（`wmn:read:<path>`）；"待处理"计数不含 `orphan`，失效条目单列。
- 打开页面（逐段模式）：底部显示 `P#`，该段不是第一个已改段（前面有已改段则自动跳过并在 toast 里报告跳过数）；全篇都标完时落回首段。
- 段落审核（v7.4）：`POST /api/review/<para>` 标 `done` 后，`/api/doc` 的 `review` 出现该段、`totals.reviewed` 加一；再 POST `{"done": false}` 撤销。改这段正文后刷新，状态变 `stale`（`reviewed_stale` 加一），地图画虚线橙框。
- `reply` 只在 `status=done` 时显示；撤回 done 时后端会清掉 `reply`/`doneAt`。

## 模板与脚本

本 skill（web-margin-notes）自带可运行代码，不依赖任何外部仓库：

```
web-margin-notes/
├── templates/
│   ├── app.py              Flask：文稿解析 + 批注 CRUD + 四级锚点重定位 + 导出
│   ├── static/             index.html / app.js / style.css（原生 JS，无构建）
│   ├── start.sh            一条命令起服务
│   └── data/config.json    manuscript / port / app_title / ref_head
└── scripts/
    ├── scaffold.sh         新建实例：scaffold.sh <目录> <md> [端口]
    ├── read_notes.py       把 notes.json 读成改稿清单（--all / --json）
    └── verify.py           验收：API + 锚点 + 边注对齐 + 无残留 **
```

## 数据契约

`data/notes.json` 是批注的唯一真源，`data/review.json` 是段落审核状态，代理人和页面共用：

```json
{"doc": "…/稿子.md", "version": 1,
 "notes": [{"id":"n_0656","para":1,"quote":"人类对河流的改造","prefix":"","suffix":"",
            "offset":0,"tags":["文字"],"text":"开头这句可以更具体","status":"open",
            "docHash":"272347ec9618","createdAt":"…","updatedAt":"…"}]}
```

- `para`：段落号（1 起）；`0` = 全文意见。图意见也是段落级（`quote` 为空，`para` 指向图片所在段）。
- `/api/doc` 的每段另有 `media`（图引用，含 `src`／`alt`／`external`）、`figure`（纯图片段）、`table`（markdown 表格）三字段，供前端渲染，不参与锚点计算。
- `quote`：选中的原文，空串表示整段/全文意见。
- `prefix`/`suffix`：前后各 20 字。
- `status`：`open` / `done`；`reply`：代理人写的改法；`doneAt`：完成时间。
- 读接口返回的是重定位后的副本：`para_anchor`、`quote_anchor`、`offset`、`anchor`（`exact`/`relocated`/`fuzzy`/`orphan`）。

## 锚点四级回退

1. 段内精确命中 → `exact`（`docHash` 未变）或 `relocated`（文稿已改但原文还在）
2. 全文精确命中 → `relocated`（段落可能已换）
3. 去标点后最长公共块 ≥5 字且占比 ≥0.7 → `fuzzy`（数字被改、加了空格等）
4. 都不中 → `orphan`：卡片标红「⚠ 定位可能失效」，必须人工确认

## 定制点

- 换文稿：改 `data/config.json` 的 `manuscript`，刷新即可（无需重启）。
- 换文献标记：改 `ref_head`（默认 `## 参考文献`），该行之后的内容折叠显示、不参与批注。
- 换端口/标题：`port`、`app_title`。
- 想加字段（紧急度、回复）：改 `app.py` 的 POST 分支与 `static/app.js` 的 `cardEl`；不要动锚点算法。

## 同类与差异
拉过 GitHub 上同期同类（2026-11 检索），按"能不能被代理人直接读"分两类：

**已有 SKILL.md 的**

- `metavert-io/markupmarkdown` — Google Docs 式批注，代理可读/回复/resolve 并触发改写。最接近，但依赖其托管或自建服务。
- `backnotprop/plannotator`（`plannotator-annotate`）— 打开批注 UI，回传 JSON 决策；偏"批准/否决"。
- `FuzzyTG/doc-review-skill` — 部署到 Cloudflare Pages + D1，W3C TextQuoteSelector，带密码。适合给别人看，不适合本地单机。
- `itssan14/md-review`、`buminduyasith/la-peace`、`tdimino/claude-code-minoan` 的 `mdpreview` — 单文件或轻前端，靠"Done & Copy"把意见复制出去。

**纯应用**

- `Seiraiyu/md-review-plus`、`jacquardlabs/viva`、`dru89/margin`（桌面编辑器）。

**本 skill 的差异点**（选型时用）

1. **零构建**：Flask + 原生 JS，没有 npm/bun/vite，也没有云端依赖。
2. **单一真源**：一个 `notes.json`，人和代理读同一份，代理可直接改 `status` 完成闭环（不用剪贴板）。
3. **改稿后仍能定位**：`quote + prefix + suffix + 段号` 四级回退，文稿被改 10% 仍能对上；同类多数按行号或内容哈希，改一次就全失效。
4. **三粒度**：选区／整段／全文，且边注与高亮像素级对齐。

**没做的**：回复线程、多人协作、track changes、导出 docx、MCP。