---
name: "web-margin-notes"
description: "生成可复用的「Word 式边注」批注网页（Flask + 原生 JS，无 npm），指向任意 markdown 文稿：作者划词写意见，代理人读 notes.json 逐条改稿并回写状态。触发语：做一个批注/标注工具、让作者在稿子上划词提意见、Word 里那种边注、批注后按意见改稿、annotate a markdown draft with margin comments、read annotation feedback and revise。"
version: 4
license: MIT
created: "2026-11-02"
updated: "2026-11-02"
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
5. 交付给作者，说明操作：划词 →「＋批注」→ `Ctrl+Enter`；点段号提段落意见；顶栏「＋ 全文意见」提整篇意见。**默认就是逐段模式**：打开只显示当前这一段和它自己的批注（默认不带上下段，可用底栏勾选临时带上下文），`j`/`k`/`↑↓` 翻段，`n`/`p` 跳到下/上一条批注，顶栏「全文」/`f` 切回全篇（选择记在 localStorage）；顶栏下的一排格子是段落地图（橙=有批注、灰=已读、绿=已改），点格跳段。
6. 读批注：`python3 scripts/read_notes.py <实例>/data/notes.json`（默认只出 `status=open`，按段排序；`--all` 含已处理，`--json` 原样输出）。
7. 改稿：只改文稿源文件；改完跑该项目自己的构建（如 docx/pdf 重建），再把处理过的条目 `status` 置 `done`，并写 `reply` 一句话说明"改成了什么"——`POST /api/notes/<id>/status {"status":"done","reply":"…"}`。页面会用绿框显示这句，作者回看时就知道改动落在哪。
8. 回环：作者 `F5` 刷新，批注按 `quote + prefix + suffix` 自动重定位；`orphan` 条目必须人工确认，不许静默丢弃。

## Pitfalls

- **Markdown 粗体必须先去标记**：`**词**` 原样渲染会露星号，且 DOM 偏移与引文对不上。`app.py` 的 `strip_bold()` 返回纯文本 + `bold` 区间，前后端统一用去标记文本算偏移。
- **别用 `data-top=1e9` 表示"排到最底"**：浏览器会钳制成 33554432px，页面高度爆炸。`layoutCards()` 按 `(是否全文意见, top)` 两级排序。
- **编辑批注时传 `para_anchor`/`quote_anchor`**，不能传 `para`/`quote`——后者是原始字段，传错会把句级批注写成全文批注。
- **改完服务代码必须重启**：`fuser -k <端口>/tcp` 后再起，否则测到的还是旧逻辑；静态文件走缓存时 `Ctrl+Shift+R`。
- **字数口径要说明**：`/api/doc` 的 `chars` 不含标题行，构建脚本打印的含标题，差值等于标题字数，属正常。
- **重叠批注要嵌套渲染**：同段两条批注的区间可能相交，`renderRich()` 先按边界切段、每条覆盖该段的批注由外到内嵌套 `<mark>`，否则后一条没有高亮、用户找不到锚点。
- **别把"下移"判成错位**：两条批注靠得近时后一条必然被推下去，判据应是"卡片不得高于锚点"。
- **grid 拉伸会让高度自锁**：`.layout` 是两列 grid，边注列 `min-height` 撑高后，正文列被 stretch 到同高；若下一次又用 `docEl.offsetHeight` 算 `min-height`，就会一层层放大（实测 970 → 4413px）。修法：`layoutCards()` 先把 `marginEl.style.minHeight = "0px"` 再测量。
- **默认视图要是逐段**：作者面对长稿打开就看见 24 段会直接放弃；`state.mode` 默认 `focus`，末次选择写 `localStorage`。
- **本地工具必须禁缓存**：`after_request` 给 `/` 与 `/s/*` 加 `Cache-Control: no-store`，否则改了前端作者刷新看不到。
- **不要写回稿件目录**：工具只读 markdown，所有写入限制在实例的 `data/` 与 `export/`。

## Verification

- `scripts/verify.py <base_url>` 退出码 0 且打印「全部通过」。
- 全文模式段落数与 `/api/doc` 一致；逐段模式只渲染 1 段（勾"带上下段"时 ≤3）；正文无 `**` 残留；参考文献区可折叠（逐段模式不显示）。
- 建一条批注 → `F5` 仍在；杀进程重启 → 仍在（`data/notes.json` 持久）。
- 手工改动文稿约 10% 文字后刷新：未受影响批注仍精确对齐；轻微改动标 `fuzzy`；删掉/乱改标 `orphan`；不静默丢失。
- 边注卡片不得高于其锚点；相邻卡片不重叠（1280/1512/1920 三档）。**因避让前一条而下移是正常的**，`verify.py` 单列"避让下移"计数，别当错位。
- 逐段模式（默认）：**只渲染当前段**（勾选"带上下段"才显示 ±1 段淡显），`j`/`k` 翻段，`n`/`p` 跳批注，底栏显示 `P# / N`；页面不滚动（scrollHeight ≈ 视口高）；段落地图与已读计数同步。
- `export/意见清单.md` 与 `notes.json` 的条数、顺序、引文一致。
- 已读进度按**文稿路径**记（`wmn:read:<path>`），改稿后 hash 变了也不清零；"待处理"计数不含 `orphan`，失效条目单列。
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

`data/notes.json` 是唯一真源，代理人和页面共用：

```json
{"doc": "…/稿子.md", "version": 1,
 "notes": [{"id":"n_0656","para":1,"quote":"人类对河流的改造","prefix":"","suffix":"",
            "offset":0,"tags":["文字"],"text":"开头这句可以更具体","status":"open",
            "docHash":"272347ec9618","createdAt":"…","updatedAt":"…"}]}
```

- `para`：段落号（1 起）；`0` = 全文意见。
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