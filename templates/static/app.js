/* draft-review 前端：原生 JS，无构建 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  doc: null,
  notes: [],
  filter: "open",
  tags: [],
  draft: null,
  mode: "all",     // all | focus
  cur: 1,          // 逐段模式的当前段
  read: new Set(), // 已读段落号（本机）
  review: {},      // 段落审核状态（服务端 review.json）：{para: {state:"done"|"stale", at}}
  showCtx: false,
};
const TAGS = ["数字", "术语", "结构", "文字", "越界", "删"];
const docEl = $("#doc");
const marginEl = $("#margin");
const pillEl = $("#pill");

/* ------------------------------------------------------------ 已读 / 地图 */
function readKey() {
  // 按文稿路径记，改稿后 hash 变了也不丢"已读"进度
  return `wmn:read:${state.doc?.path || "x"}`;
}
function loadRead() {
  try {
    state.read = new Set(JSON.parse(localStorage.getItem(readKey()) || "[]"));
  } catch {
    state.read = new Set();
  }
}
function saveRead() {
  localStorage.setItem(readKey(), JSON.stringify([...state.read]));
}
function markRead(i, val = true) {
  if (!i) return;
  if (val) state.read.add(i);
  else state.read.delete(i);
  saveRead();
  renderMap();
}

function isReviewed(i) { return state.review[i]?.state === "done"; }
function isStale(i) { return state.review[i]?.state === "stale"; }

async function toggleReview(i) {
  if (!i) return;
  const done = !isReviewed(i);
  await api(`/api/review/${i}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  if (done) state.review[i] = { state: "done", at: new Date().toISOString() };
  else delete state.review[i];
  renderMap();
  const el = $(`.para[data-i="${i}"]`, docEl);
  if (el) {
    el.classList.toggle("rev", done);
    const b = el.querySelector(".pmark");
    if (b) { b.textContent = done ? "✓ 已改" : "标为已改"; b.classList.toggle("on", done); }
  }
  syncDoneBtn();
  toast(done ? `P${i} 已标为改完` : `P${i} 已撤销`);
}

function syncDoneBtn() {
  const b = $("#f-done");
  if (!b) return;
  const on = isReviewed(state.cur);
  b.classList.toggle("on", on);
  b.textContent = on ? "✓ 本段已改" : "标本段为已改";
  b.title = on ? "再点一次撤销（m）" : "标为改完，之后可跳过（m）";
}

function noteCount(i) {
  return state.notes.filter((n) => n.para_anchor === i).length;
}

function renderMap() {
  const map = $("#map");
  map.innerHTML = "";
  for (const p of state.doc.paras) {
    const b = document.createElement("button");
    b.className = "cell";
    b.textContent = p.i;
    b.title = `P${p.i}　${p.text.slice(0, 24)}…` + (noteCount(p.i) ? `（${noteCount(p.i)} 条批注）` : "");
    if (noteCount(p.i)) b.classList.add("has");
    if (state.notes.some((n) => n.para_anchor === p.i && n.status === "done" && n.reply)) b.classList.add("fixed");
    if (state.read.has(p.i)) b.classList.add("read");
    if (isReviewed(p.i)) b.classList.add("rev");
    else if (isStale(p.i)) b.classList.add("revstale");
    if (state.mode === "focus" && p.i === state.cur) b.classList.add("cur");
    b.onclick = () => gotoPara(p.i);
    map.appendChild(b);
  }
  const total = state.doc.paras.length;
  const read = state.read.size;
  const fixed = state.notes.filter((n) => n.status === "done" && n.reply).length;
  const open = state.notes.filter((n) => n.status === "open" && n.anchor !== "orphan").length;
  const orphan = state.notes.filter((n) => n.anchor === "orphan").length;
  const rev = state.doc.paras.filter((p) => isReviewed(p.i)).length;
  $("#mapinfo").textContent = `已读 ${read}/${total}　已审 ${rev}/${total}　待处理 ${open}　已改 ${fixed}` + (orphan ? `　失效 ${orphan}` : "");
}

function gotoPara(i, opts = {}) {
  // 逐段翻页时把状态同步到「本段已改」按钮
  queueMicrotask(syncDoneBtn);
  const total = state.doc.paras.length;
  i = Math.min(total, Math.max(1, i));
  if (state.mode === "focus" && opts.markRead !== false && state.cur !== i) markRead(state.cur);
  state.cur = i;
  if (state.mode !== "focus") {
    const el = $(`.para[data-i="${i}"]`, docEl);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    markRead(i);
    renderMap();
    return;
  }
  renderDoc();
  renderCards();
  renderMap();
  $("#f-pos").textContent = `P${i} / ${total}`;
  markRead(i);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyModeChrome() {
  const focus = state.mode === "focus";
  document.body.classList.toggle("focus-mode", focus);
  docEl.classList.toggle("focus", focus);
  $("#focusbar").hidden = !focus;
  $("#btn-mode").textContent = focus ? "全文" : "逐段";
  $("#f-pos").textContent = `P${state.cur} / ${state.doc.paras.length}`;
}

function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("wmn:mode", mode);
  if (mode === "focus") {
    const exists = state.doc.paras.some((p) => p.i === state.cur);
    if (!exists) {
      const first = state.doc.paras.find((p) => !state.read.has(p.i));
      state.cur = first ? first.i : 1;
    }
  }
  applyModeChrome();
  renderDoc();
  renderCards();
  renderMap();
  syncDoneBtn();
}

/* ------------------------------------------------------------ 工具 */
async function api(url, opt) {
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), ms);
}
function esc(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/* markdown 表格转 <table>；纯展示，选区偏移按原 text 反查 */
function tableEl(text) {
  const rows = text.split("\n").filter((l) => l.trim().startsWith("|"));
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const t = document.createElement("table");
  t.className = "mdtable";
  rows.forEach((line) => {
    if (/^[\s:|-]+$/.test(line.trim().replace(/^\|/, "").replace(/\|$/, ""))) return;
    const tr = document.createElement("tr");
    for (const c of cells(line)) {
      const td = document.createElement(t.querySelector("tr") ? "td" : "th");
      td.textContent = c;
      tr.appendChild(td);
    }
    t.appendChild(tr);
  });
  return t;
}

/* ------------------------------------------------------------ 行内批注 */
/* 批注卡片紧跟在「被批注那句」的下一行，不再放到右侧边注列 */
function sentenceEnd(text, pos) {
  const re = /[。！？；\n]/g;
  re.lastIndex = Math.max(0, pos - 1);
  const r = re.exec(text);
  return r ? r.index + 1 : text.length;
}

/* 卡片插哪：优先贴着最近的逗号/顿号/分号（离被批注的词最近），
   整句内没有分隔符时才退到句末。 */
function cutPoint(text, pos) {
  const end = sentenceEnd(text, pos);
  const re = /[，、；：]/g;
  re.lastIndex = Math.max(0, pos);
  const m = re.exec(text);
  return m && m.index < end ? m.index + 1 : end;
}

function renderSeg(text, bold, marks, from, to) {
  const seg = text.slice(from, to);
  const bs = bold
    .map(([a, b]) => [Math.max(0, a - from), Math.min(seg.length, b - from)])
    .filter(([a, b]) => b > a);
  const ms = marks
    .map((m) => ({ ...m, s: Math.max(0, m.s - from), e: Math.min(seg.length, m.e - from) }))
    .filter((m) => m.e > m.s);
  return renderRich(seg, bs, ms);
}

function inlineCard(n) {
  const c = cardEl(n);
  c.classList.add("inline");
  return c;
}

/* ------------------------------------------------------------ 渲染正文 */
function renderRich(text, bold, marks) {
  const cuts = new Set([0, text.length]);
  for (const [s, e] of bold) { cuts.add(s); cuts.add(e); }
  for (const m of marks) { cuts.add(m.s); cuts.add(m.e); }
  const pts = [...cuts].sort((a, b) => a - b);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    if (e <= s) continue;
    let node = document.createTextNode(text.slice(s, e));
    // 允许区间重叠：外层先包（范围大的在外），内层后包，两条批注都能点
    // 嵌套时最内层画在最上面：小范围先包（成为子元素），大范围后包（成为父元素）。
    // 同范围时 open 优先，保证新加的黄批注不会被旧的绿批注盖住。
    const covering = marks
      .filter((m) => s >= m.s && e <= m.e)
      .sort((a, b) =>
        (a.e - a.s) - (b.e - b.s) ||
        ((a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0)));
    for (const mk of covering) {
      const el = document.createElement("mark");
      el.className = "hl" + (mk.anchor === "fuzzy" ? " fuzzy" : "") + (mk.status === "done" ? " done" : "");
      el.dataset.id = mk.id;
      el.title = mk.text || "";
      el.appendChild(node);
      node = el;
    }
    if (bold.some(([a, b]) => s >= a && e <= b)) {
      const st = document.createElement("strong");
      st.appendChild(node);
      node = st;
    }
    frag.appendChild(node);
  }
  return frag;
}

function highlightFragment(text, paraNo, bold) {
  const marks = state.notes
    // orphan 的 offset 不可信（常为 0），照画会在段首糊成一片，压住别的高亮
    .filter((n) => n.para_anchor === paraNo && n.quote_anchor && n.anchor !== "orphan")
    .map((n) => ({ n, s: n.offset, e: n.offset + n.quote_anchor.length }))
    .filter((x) => x.s >= 0 && x.e <= text.length && x.e > x.s)
    .sort((a, b) => a.s - b.s);
  return renderRich(text, bold || [], marks.map((m) => ({
    ...m, id: m.n.id, anchor: m.n.anchor, status: m.n.status, text: m.n.text,
  })));
}

function renderDoc() {
  docEl.innerHTML = "";
  const list = state.mode === "focus"
    ? state.doc.paras.filter((p) => p.i === state.cur ||
        (state.showCtx && Math.abs(p.i - state.cur) === 1))
    : state.doc.paras;
  let shownNotes = 0;
  for (const p of list) {
    const isCur = state.mode !== "focus" || p.i === state.cur;
    const el = document.createElement("div");     // div：内部要插行内卡片
    el.className = "para" + (state.mode === "focus" ? (isCur ? " cur" : " ctx") : "");
    el.dataset.i = p.i;
    const no = document.createElement("span");
    no.className = "pno";
    no.innerHTML = `<b>P${p.i}</b>`;
    no.title = "点此加段落意见";
    no.onclick = () => (state.mode === "focus" && !isCur
      ? gotoPara(p.i)
      : openComposer({ para: p.i, quote: "", prefix: "", suffix: "", offset: 0 }));
    el.append(no);

    const mk = document.createElement("button");
    mk.className = "pmark" + (isReviewed(p.i) ? " on" : "");
    mk.textContent = isReviewed(p.i) ? "✓ 已改" : "标为已改";
    mk.title = isReviewed(p.i) ? "本段已审，再点撤销（m）" : "标为改完，之后可跳过（m）";
    mk.onclick = (e) => { e.stopPropagation(); toggleReview(p.i); };
    el.append(mk);
    if (isReviewed(p.i)) el.classList.add("rev");
    else if (isStale(p.i)) el.classList.add("revstale");

    const mine = state.notes.filter((n) => visible(n) && n.para_anchor === p.i);
    const rendered = new Set();
    const inline = mine.filter((n) => n.quote_anchor && n.anchor !== "orphan");
    const whole = mine.filter((n) => !n.quote_anchor || n.anchor === "orphan");

    if (p.figure) {
      const tx = document.createElement("span");
      tx.className = "ptext";
      const box = document.createElement("div");
      box.className = "figbox";
      for (const m of p.media) {
        const img = document.createElement("img");
        img.className = "fig";
        img.src = m.external ? m.src : "/media/" + m.src.split("/").map(encodeURIComponent).join("/");
        img.alt = m.alt || "";
        img.loading = "lazy";
        img.onclick = (e) => { e.stopPropagation(); openComposer({ para: p.i, quote: "", prefix: "", suffix: "", offset: 0 }); };
        box.appendChild(img);
      }
      const cnt = noteCount(p.i);
      const btn = document.createElement("button");
      btn.className = "figbtn";
      btn.textContent = cnt ? `图意见 ${cnt} 条｜再加` : "＋ 图意见";
      btn.onclick = (e) => { e.stopPropagation(); openComposer({ para: p.i, quote: "", prefix: "", suffix: "", offset: 0 }); };
      box.appendChild(btn);
      if (!isCur) box.onclick = () => gotoPara(p.i);
      tx.appendChild(box);
      el.append(tx);
    } else if (p.head || p.table) {
      const tx = document.createElement("span");
      tx.className = "ptext";
      if (p.head) tx.classList.add("hd" + p.head);
      if (p.table) tx.appendChild(isCur ? tableEl(p.text) : document.createTextNode(p.text));
      else tx.appendChild(isCur ? highlightFragment(p.text, p.i, p.bold) : document.createTextNode(p.text));
      el.append(tx);
      // 表格/标题不能按句切开，卡片统一放在整块之后（否则这些段落里的批注会整条丢失）
      for (const n of inline) { el.append(inlineCard(n)); rendered.add(n.id); shownNotes++; }
    } else if (!isCur) {
      const tx = document.createElement("span");
      tx.className = "ptext";
      tx.textContent = p.text;
      el.append(tx);
    } else {
      // 按「被批注句」的句末切段，卡片插在切点之后
      const marks = inline.map((n) => ({
        n, s: n.offset, e: n.offset + (n.quote_anchor || "").length,
        id: n.id, anchor: n.anchor, status: n.status, text: n.text,
      })).map((m) => ({ ...m, e: Math.min(m.e, p.text.length) }))
        .filter((m) => m.e > m.s && m.s >= 0);
      const groups = new Map();
      for (const m of marks) {
        const cut = cutPoint(p.text, m.e);
        if (!groups.has(cut)) groups.set(cut, []);
        groups.get(cut).push(m.n);
      }
      const cuts = [...groups.keys()].sort((a, b) => a - b);
      let cursor = 0;
      for (const cut of cuts) {
        const sp = document.createElement("span");
        sp.className = "ptext";
        sp.appendChild(renderSeg(p.text, p.bold || [], marks, cursor, cut));
        el.append(sp);
        for (const n of groups.get(cut)) { el.append(inlineCard(n)); rendered.add(n.id); shownNotes++; }
        cursor = cut;
      }
      if (cursor < p.text.length || !cuts.length) {
        const sp = document.createElement("span");
        sp.className = "ptext";
        sp.appendChild(cursor ? renderSeg(p.text, p.bold || [], marks, cursor, p.text.length)
                              : highlightFragment(p.text, p.i, p.bold));
        el.append(sp);
      }
    }

    // 兜底：偏移不可信、又没落进上面任何分支的批注，仍要显示出来
    for (const n of mine) {
      if (rendered.has(n.id) || whole.includes(n)) continue;
      el.append(inlineCard(n)); rendered.add(n.id); shownNotes++;
    }
    for (const n of whole) { el.append(inlineCard(n)); rendered.add(n.id); shownNotes++; }
    docEl.appendChild(el);
  }

  // 全文意见：放在正文最末
  const generals = state.notes.filter((n) => visible(n) && !(n.para_anchor > 0));
  for (const n of generals) { docEl.appendChild(inlineCard(n)); shownNotes++; }

  if (state.mode === "focus" && !shownNotes) {
    const empty = document.createElement("div");
    empty.className = "card empty inline";
    empty.innerHTML = `<div class="body" style="color:var(--dim)">本段还没有批注。划词后按 <kbd>Ctrl+K</kbd> 或点「＋批注」。</div>`;
    docEl.appendChild(empty);
  }

  if (state.mode !== "focus" && (state.doc.refs || []).length) {
    const d = document.createElement("details");
    d.className = "refs";
    d.innerHTML = `<summary>参考文献（${state.doc.refs.length} 条）</summary>` +
      state.doc.refs.map((r) => `<p>${esc(r)}</p>`).join("");
    docEl.appendChild(d);
  }
  $$(".hl", docEl).forEach((m) => {
    m.onclick = (e) => {
      e.stopPropagation();
      focusCard(m.dataset.id);
    };
  });
}

/* ------------------------------------------------------------ 渲染边注 */
function visible(n) {
  if (state.filter === "all") return true;
  if (state.filter === "orphan") return n.anchor === "orphan";
  if (state.filter === "done") return n.status === "done";
  return n.status === "open" && n.anchor !== "orphan";
}

function cardEl(n) {
  const c = document.createElement("div");
  c.className = "card" + (n.status === "done" ? " done" : "") + (n.anchor === "orphan" ? " orphan" : "");
  c.dataset.id = n.id;
  c.tabIndex = 0;
  const quote = n.quote_anchor || "";
  const head = n.para_anchor ? `P${n.para_anchor}` : "全文";
  c.innerHTML = `
    <div class="head">
      <span class="who">${head}</span>
      ${quote ? `<span>· 引文</span>` : `<span>· ${n.para_anchor ? "整段" : "全文"}</span>`}
      <span class="acts">
        <button class="icon" data-a="done" title="标记已处理">${n.status === "done" ? "↺" : "✓"}</button>
        <button class="icon" data-a="edit" title="编辑">✎</button>
        <button class="icon" data-a="del" title="删除">×</button>
      </span>
    </div>
    ${quote ? `<div class="quote">「<em>${esc(quote)}</em>」</div>` : ""}
    ${n.anchor === "orphan" ? `<div class="orphan-note">⚠ 定位可能失效，请确认原文已改</div>` : ""}
    <div class="body">${esc(n.text)}</div>
    ${n.status === "done" && n.reply ? `<div class="reply"><b>改：</b>${esc(n.reply)}</div>` : ""}
    ${(n.tags || []).length ? `<div class="tags">${n.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}`;
  c.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "done") return setStatus(n);
    if (a === "edit")
      return openComposer(
        { para: n.para_anchor, quote: n.quote_anchor || "", prefix: n.prefix || "",
          suffix: n.suffix || "", offset: n.offset || 0 },
        n.id
      );
    if (a === "del") return del(n);
    scrollToAnchor(n);
    focusCard(n.id);
  });
  return c;
}

function renderCards() { /* 行内批注：卡片随 renderDoc 一起生成 */ }

function layoutCards() { /* 行内批注：不再需要像素级对齐 */ }

/* ------------------------------------------------------------ 交互 */
function scrollToAnchor(n) {
  const t = (n.quote_anchor && n.anchor !== "orphan")
    ? $(`mark[data-id="${n.id}"]`, docEl)
    : $(`.para[data-i="${n.para_anchor}"]`, docEl);
  if (t) t.scrollIntoView({ block: "center", behavior: "smooth" });
}
function focusCard(id) {
  $$(".hl", docEl).forEach((m) => m.classList.toggle("on", m.dataset.id === id));
  $$(".card", docEl).forEach((c) => c.classList.toggle("on", c.dataset.id === id));
}

async function setStatus(n) {
  await api(`/api/notes/${n.id}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: n.status === "done" ? "open" : "done" }),
  });
  await reload();
}
async function del(n) {
  if (!confirm("删除这条批注？")) return;
  await api(`/api/notes/${n.id}`, { method: "DELETE" });
  await reload();
}

/* 选区 → 批注 */
function selectionInfo() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const ptext = range.startContainer.parentElement?.closest(".ptext");
  if (!ptext) return null;
  const paraEl = ptext.closest(".para");
  if (!paraEl) return null;
  const paraNo = +paraEl.dataset.i;
  // 段落被行内卡片切成多个 .ptext，偏移必须按「整段」累加，不能只看当前片段
  const segs = Array.from(paraEl.querySelectorAll(".ptext")).filter((s) => s.isConnected);
  const full = segs.map((s) => s.textContent).join("");
  const offsetIn = (node, off) => {
    let acc = 0;
    for (const s of segs) {
      if (s.contains(node)) {
        const r = document.createRange();
        r.selectNodeContents(s);
        r.setEnd(node, off);
        return acc + r.toString().length;
      }
      acc += s.textContent.length;
    }
    return acc;
  };
  let startOff = offsetIn(range.startContainer, range.startOffset);
  // 选区若跨段，只取本段内那部分（否则引文在段内找不到，锚点必然降级）
  let endOff = full.length;
  if (paraEl.contains(range.endContainer)) {
    endOff = offsetIn(range.endContainer, range.endOffset);
  }
  let text = full.slice(Math.min(startOff, endOff), Math.max(startOff, endOff));
  if (!text.trim()) return null;
  let off = Math.min(startOff, endOff);
  // 表格渲染后 DOM 文本与原文不同（少了竖线），偏移会偏：
  // 从记录下的偏移附近往后找，别从段首找，否则同词在前文时锚点会跳句。
  const paraObj = state.doc.paras.find((x) => x.i === paraNo);
  const raw = paraObj ? paraObj.text : full;
  if (raw.slice(off, off + text.length) !== text) {
    const near = raw.indexOf(text, Math.max(0, off - 30));
    const k = near >= 0 ? near : raw.indexOf(text);
    if (k >= 0) off = k;
  }
  return {
    para: paraNo,
    quote: text,
    prefix: raw.slice(Math.max(0, off - 20), off),
    suffix: raw.slice(off + text.length, off + text.length + 20),
    offset: off,
    rect: range.getBoundingClientRect(),
  };
}

document.addEventListener("mouseup", () => {
  setTimeout(() => {
    const info = selectionInfo();
    if (!info) return (pillEl.hidden = true);
    state.draft = info;
    pillEl.hidden = false;
    pillEl.style.top = window.scrollY + info.rect.top - 34 + "px";
    pillEl.style.left = window.scrollX + Math.max(12, info.rect.left) + "px";
  }, 10);
});
document.addEventListener("mousedown", (e) => {
  if (!pillEl.contains(e.target)) pillEl.hidden = true;
});
pillEl.onclick = () => {
  pillEl.hidden = true;
  const d = state.draft;
  if (d) openComposer({ ...d });
};

/* 编辑器 */
function openComposer(anchor, editId = null) {
  $("#composer")?.remove();
  const n = editId ? state.notes.find((x) => x.id === editId) : null;
  const c = document.createElement("div");
  c.className = "card composer";
  c.id = "composer";
  c.innerHTML = `
    <div class="head"><span class="who">${anchor.para ? "P" + anchor.para : "全文"}</span>
      <span>${anchor.quote ? "· 引文" : `· ${anchor.para ? "整段" : "全文"}`}</span></div>
    ${anchor.quote ? `<div class="quote">「<em>${esc(anchor.quote.slice(0, 80))}</em>」</div>` : ""}
    <div class="editor">
      <textarea placeholder="写意见…（Ctrl+Enter 保存，Esc 取消）"></textarea>
      <div class="row">
        ${TAGS.map((t) => `<button class="tagbtn" data-t="${t}">${t}</button>`).join("")}
        <span class="hint">Ctrl+↵</span>
      </div>
    </div>`;
  document.body.appendChild(c);
  const ta = $("textarea", c);
  ta.value = n ? n.text : "";
  state.tags = n ? [...(n.tags || [])] : [];
  $$(".tagbtn", c).forEach((b) => {
    if (state.tags.includes(b.dataset.t)) b.classList.add("on");
    b.onclick = () => {
      b.classList.toggle("on");
      const t = b.dataset.t;
      state.tags = b.classList.contains("on")
        ? [...new Set([...state.tags, t])]
        : state.tags.filter((x) => x !== t);
    };
  });
  // 定位：贴着被批注的那一行浮出（fixed，不占正文流）
  let rect = anchor.rect || null;
  if (!rect && editId) {
    const m = $(`mark[data-id="${editId}"]`, docEl);
    if (m) rect = m.getBoundingClientRect();
  }
  if (!rect && anchor.para) {
    const p = $(`.para[data-i="${anchor.para}"]`, docEl);
    if (p) rect = p.getBoundingClientRect();
  }
  const W = 380, H = 200;
  const top = rect ? Math.min(window.innerHeight - 40, rect.bottom + 6)
                   : window.innerHeight / 2 - H / 2;
  const left = rect ? Math.max(12, Math.min(rect.left, window.innerWidth - W - 12))
                    : window.innerWidth / 2 - W / 2;
  c.style.position = "fixed";
  c.style.width = W + "px";
  c.style.left = left + "px";
  c.style.top = Math.max(64, Math.min(top, window.innerHeight - H)) + "px";
  c.style.zIndex = 90;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.onkeydown = async (e) => {
    if (e.key === "Escape") return c.remove();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      try {
        await api("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          para: anchor.para, quote: anchor.quote || '',
          prefix: anchor.prefix || '', suffix: anchor.suffix || '',
          offset: anchor.offset || 0, text, tags: state.tags, id: editId,
        }),
        });
      } catch (err) {
        return toast("保存失败：" + err.message, 4000);   // 不关编辑器，草稿还在
      }
      c.remove();
      window.getSelection()?.removeAllRanges();
      await reload();
      toast(editId ? "已更新" : "已保存");
    }
  };
  c.onkeydown = (e) => {
    if (e.key === "Escape") c.remove();
  };
}

/* 视图与逐段导航 */
$("#btn-mode").onclick = () => setMode(state.mode === "focus" ? "all" : "focus");
$("#f-prev").onclick = () => gotoPara(state.cur - 1);
$("#f-next").onclick = () => gotoPara(state.cur + 1);
$("#f-ctx").onchange = (e) => { state.showCtx = e.target.checked; renderDoc(); layoutCards(); };
$("#f-note").onclick = () => jumpNextNote(1);
$("#f-done").onclick = () => toggleReview(state.cur);
$("#f-undone").onclick = () => jumpNextUnreviewed();
function jumpNextUnreviewed() {
  const list = state.doc.paras;
  const start = state.cur;
  const next = list.find((p) => p.i > start && !isReviewed(p.i))
    || list.find((p) => !isReviewed(p.i));
  if (!next) return toast("全部段落都标为已改了");
  if (state.mode !== "focus") setMode("focus");
  gotoPara(next.i);
}
$("#f-unread").onclick = () => {
  const p = state.doc.paras.find((x) => !state.read.has(x.i));
  if (p) { setMode("focus"); gotoPara(p.i); } else toast("全部读完了");
};
function jumpNextNote(dir = 1) {
  const withNote = [...new Set(state.notes
    .filter((n) => n.para_anchor > 0 && (state.filter !== "open" || n.status === "open"))
    .map((n) => n.para_anchor))].sort((a, b) => a - b);
  if (!withNote.length) return toast("没有批注");
  const next = dir > 0
    ? withNote.find((i) => i > state.cur) ?? withNote[0]
    : [...withNote].reverse().find((i) => i < state.cur) ?? withNote[withNote.length - 1];
  if (state.mode === "focus") gotoPara(next);
  else { gotoPara(next); focusCard(state.notes.find((n) => n.para_anchor === next)?.id); }
}

/* 全文意见 */
$("#btn-general").onclick = () => openComposer({ para: 0, quote: "", prefix: "", suffix: "", offset: 0 });

/* 顶栏 */
$("#filters").onclick = (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  $$(".chip").forEach((x) => x.classList.toggle("on", x === b));
  state.filter = b.dataset.f;
  renderCards();
};

$("#btn-export").onclick = async () => {
  const r = await api("/api/export", { method: "POST" });
  toast(`已写入 ${r.path}（${r.count} 条）`, 3200);
};

$("#btn-copy").onclick = async () => {
  const lines = [`# ${state.doc.app_title}（${state.doc.title}）`, ""];
  let cur = null;
  for (const n of state.notes) {
    const k = n.para_anchor;
    if (k !== cur) {
      lines.push(`## ${k ? `P${k} ${n.para_head}…` : "全文"}`, "");
      cur = k;
    }
    lines.push(`- [${(n.tags || []).join("·") || "—"}]${n.status === "done" ? "（已处理）" : ""}`);
    if (n.quote_anchor) lines.push(`  > 「${n.quote_anchor.replace(/\n/g, " ")}」`);
    if (n.anchor === "orphan") lines.push("  > ⚠ 定位可能失效");
    lines.push(`  ${n.text}`, "");
  }
  await navigator.clipboard.writeText(lines.join("\n"));
  toast(`已复制 ${state.notes.length} 条意见`);
};

/* 键盘 */
document.addEventListener("keydown", (e) => {
  const inInput = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
  if (inInput) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    const info = selectionInfo();
    openComposer(info || { para: 0, quote: "", prefix: "", suffix: "", offset: 0 });
    return;
  }
  if (e.key === "Escape") {
    $("#composer")?.remove();
    pillEl.hidden = true;
    return;
  }
  if (e.key === "f") { setMode(state.mode === "focus" ? "all" : "focus"); return; }
  if (e.key === "m") { toggleReview(state.cur); return; }
  if (e.key === "u") { jumpNextUnreviewed(); return; }
  if (e.key === "n") { jumpNextNote(1); return; }
  if (e.key === "p") { jumpNextNote(-1); return; }
  if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
    const down = e.key === "j" || e.key === "ArrowDown";
    if (state.mode === "focus") {
      e.preventDefault();
      gotoPara(state.cur + (down ? 1 : -1));
      return;
    }
    const cards = $$(".card.inline", docEl).filter((c) => c.offsetParent);
    if (!cards.length) return;
    const i = cards.findIndex((c) => c.classList.contains("on"));
    const next = cards[Math.min(cards.length - 1, Math.max(0, down ? i + 1 : i - 1))];
    if (next) {
      next.focus({ preventScroll: false });
      const n = state.notes.find((x) => x.id === next.dataset.id);
      if (n) { focusCard(n.id); scrollToAnchor(n); }
    }
  }
});

/* ------------------------------------------------------------ 启动 */
async function reload() {
  const d = await api("/api/doc");
  state.doc = d;
  state.notes = d.notes;
  state.review = d.review || {};
  document.title = `${d.app_title} · ${d.title}`;
  $("#doc-title").textContent = `${d.app_title} · ${d.title}`;
  $("#doc-meta").textContent = `${d.totals.chars} 字 · ${d.totals.paras} 段 · ${d.hash} · ${d.mtime}`;
  $("#c-open").textContent = d.totals.open;
  $("#c-all").textContent = d.notes.length;
  $("#c-done").textContent = d.totals.done;
  $("#c-orphan").textContent = d.totals.orphan;
  const firstLoad = !state.doc;
  loadRead();
  state.mode = localStorage.getItem("wmn:mode") === "all" ? "all" : "focus";
  if (state.mode === "focus" && (firstLoad || !state.cur)) {
    const first = d.paras.find((p) => !state.read.has(p.i));
    state.cur = first ? first.i : 1;
  }
  state.cur = Math.min(Math.max(1, state.cur || 1), d.paras.length);
  applyModeChrome();
  renderDoc();
  renderCards();
  renderMap();
  syncDoneBtn();
}

window.addEventListener("resize", () => layoutCards());
document.fonts?.ready.then(() => layoutCards());
reload().catch((e) => toast("加载失败：" + e.message, 6000));
