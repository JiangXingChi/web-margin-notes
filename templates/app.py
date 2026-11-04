#!/usr/bin/env python
"""draft-review —— 初稿批注与改稿回环

Flask + 原生 JS，无构建、无 npm。
只读被批注的 markdown，批注数据全部写在 data/notes.json。
"""
import difflib
import hashlib
import json
import os
import re
import shutil
import threading
import uuid
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
EXPORT = os.path.join(BASE, "export")
CFG = os.path.join(DATA, "config.json")
NOTES = os.path.join(DATA, "notes.json")
BAK = NOTES + ".bak"
LOCK = threading.Lock()

app = Flask(__name__, static_folder=os.path.join(BASE, "static"), static_url_path="/s")

DEFAULT_REF_HEAD = "## 参考文献"


# ---------------------------------------------------------------- 基础读写

def load_cfg():
    with open(CFG, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def load_notes():
    if not os.path.exists(NOTES):
        return {"doc": load_cfg()["manuscript"], "version": 1, "notes": []}
    with open(NOTES, encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("notes", [])
    return data


def save_notes(data):
    if os.path.exists(NOTES):
        shutil.copyfile(NOTES, BAK)
    save_json(NOTES, data)


def now():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


# ---------------------------------------------------------------- 文稿解析

def strip_bold(raw):
    """去掉 **粗体** 标记，返回 (纯文本, 粗体区间列表)。区间以纯文本下标计。"""
    out, spans, i = [], [], 0
    for m in re.finditer(r"\*\*(.+?)\*\*", raw, flags=re.S):
        out.append(raw[i:m.start()])
        start = sum(len(x) for x in out)
        out.append(m.group(1))
        spans.append([start, start + len(m.group(1))])
        i = m.end()
    out.append(raw[i:])
    return "".join(out), spans


def _media_of(raw, text):
    """抽出本段里的图片引用。路径相对文稿所在目录，由 /media/<path> 提供。"""
    out = []
    for m in re.finditer(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", raw):
        src = m.group(2).strip()
        if src.startswith(("http://", "https://", "data:")):
            out.append({"src": src, "alt": m.group(1), "external": True})
        else:
            out.append({"src": src, "alt": m.group(1), "external": False})
    # 去掉图片引用后所剩无几，就当这一段是图
    only = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", "", text).strip()
    return out, not only


def _is_table(text):
    """连续两行以上以 | 开头即当表格。"""
    rows = [l for l in text.split("\n") if l.strip().startswith("|")]
    return len(rows) >= 2


def parse_doc():
    """切段：首行当标题，按空行分段；ref_head 之后的内容作为文献区单独返回。
    段落文本去掉 ** 标记（粗体位置另给），保证正文/前端的字符偏移一致。
    图片与表格只加标记，不动 text，否则锚点偏移会对不上。"""
    cfg = load_cfg()
    path = cfg["manuscript"]
    ref_head = cfg.get("ref_head", DEFAULT_REF_HEAD)
    with open(path, encoding="utf-8") as f:
        md = f.read()
    body = md.split(ref_head)[0] if ref_head in md else md
    refs_raw = md.split(ref_head)[1] if ref_head in md else ""
    lines = body.strip("\n").split("\n")
    title = re.sub(r"^#\s*", "", lines[0].strip())
    rest = "\n".join(lines[1:])
    raw_paras = [p.strip() for p in re.split(r"\n\s*\n", rest)
                 if p.strip() and not re.fullmatch(r"-{3,}", p.strip())]
    cjk = lambda s: len(re.findall(r"[\u4e00-\u9fff]", s))
    paras = []
    for n, raw in enumerate(raw_paras):
        # 小标题去掉 # 号再算文本，正文/前端偏移才一致；级别单独给前端做样式
        head, body_raw = 0, raw
        mh = re.match(r"^(#{1,6})\s+", raw)
        if mh:
            head = len(mh.group(1))
            body_raw = raw[mh.end():]
        text, bold = strip_bold(body_raw)
        media, fig_only = _media_of(body_raw, text)
        paras.append({"i": n + 1, "text": text, "bold": bold, "chars": cjk(text),
                      "head": head,
                      "media": media, "figure": bool(fig_only and media),
                      "table": _is_table(text)})
    refs = [r.strip() for r in re.split(r"\n\s*\n", refs_raw) if r.strip()]
    return {
        "title": title,
        "path": path,
        "media_root": os.path.dirname(os.path.abspath(path)),
        "hash": hashlib.sha1("\n\n".join(p["text"] for p in paras).encode("utf-8")).hexdigest()[:12],
        "paras": paras,
        "refs": refs,
        "mtime": datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d %H:%M"),
    }


# ---------------------------------------------------------------- 锚点重定位

def _norm_map(s):
    """去掉标点与空白，返回 (归一化串, 归一化下标 -> 原串下标)。"""
    out, idx = [], []
    for i, ch in enumerate(s):
        if ch.isspace() or not (ch.isalnum()):
            continue
        out.append(ch.lower())
        idx.append(i)
    return "".join(out), idx


def _fuzzy(text, quote):
    """在 text 中模糊定位 quote，返回 (start, end, similarity) 或 None。"""
    nq, _ = _norm_map(quote)
    nt, idx = _norm_map(text)
    if not nq or not nt:
        return None
    sm = difflib.SequenceMatcher(None, nq, nt, autojunk=False)
    m = sm.find_longest_match(0, len(nq), 0, len(nt))
    if m.size == 0:
        return None
    sim = m.size / max(len(nq), 1)
    # 中文短引文按"最长公共块占比"判断：占比 ≥0.7 且至少 5 个字，即视为同一处
    if m.size < 5 or sim < 0.7:
        return None
    # 用最长公共块反推原串区间；块可能不覆盖 quote 的头尾，按比例补齐
    start_n = m.b - max(0, m.a)
    end_n = m.b + m.size + max(0, len(nq) - (m.a + m.size))
    start_n = max(0, min(start_n, len(nt) - 1))
    end_n = start_n + len(nq)          # 引文长度不变，按归一化长度补齐窗口
    end_n = max(start_n + 1, min(end_n, len(nt)))
    return idx[start_n], idx[end_n - 1] + 1, sim


def _find_quote(text, quote, offset, prefix, suffix):
    """同一段里同一个词可能出现多次。先认存下的偏移，再用前后文消歧，
    最后才退到 find()，否则「候选」这类词全被吸到第一次出现的位置。"""
    off = int(offset or 0)
    if 0 <= off <= len(text) - len(quote) and text[off:off + len(quote)] == quote:
        return off
    if prefix or suffix:
        first = -1
        i = text.find(quote)
        while i >= 0:
            head_ok = not prefix or text[max(0, i - len(prefix)):i] == prefix
            tail_ok = not suffix or text[i + len(quote):i + len(quote) + len(suffix)] == suffix
            if head_ok and tail_ok:
                return i
            if first < 0:
                first = i
            i = text.find(quote, i + 1)
        if first >= 0:
            return first
    return text.find(quote)


def relocate(note, paras):
    """返回 (para_no, offset, quote, status)。status: exact/relocated/fuzzy/orphan"""
    quote = note.get("quote", "")
    para_no = int(note.get("para") or 0)
    text = paras[para_no - 1]["text"] if 1 <= para_no <= len(paras) else None

    if not quote:                      # 段落级 / 全文级
        if para_no == 0:
            return 0, 0, "", "exact"
        if text is not None:
            return para_no, 0, "", "exact"
        # 段落已不存在：保留原段号，标失效，不要伪装成全文意见
        return para_no, 0, "", "orphan"

    if text is not None:
        p = _find_quote(text, quote, note.get("offset"), note.get("prefix"), note.get("suffix"))
        if p >= 0:
            same = note.get("docHash") == note.get("_hash")
            return para_no, p, quote, "exact" if same else "relocated"

    for p_obj in paras:                # 全文精确
        p = p_obj["text"].find(quote)
        if p >= 0:
            return p_obj["i"], p, quote, "relocated"

    for p_obj in paras:                # 模糊
        hit = _fuzzy(p_obj["text"], quote)
        if hit:
            s, e, _ = hit
            return p_obj["i"], s, p_obj["text"][s:e], "fuzzy"

    return para_no, 0, quote, "orphan"


def decorate(doc, data):
    paras = doc["paras"]
    out = []
    for n in data["notes"]:
        n = dict(n)
        n["_hash"] = doc["hash"]
        para, off, quote, st = relocate(n, paras)
        n.pop("_hash", None)
        n["para_anchor"] = para
        n["offset"] = off
        n["quote_anchor"] = quote
        n["anchor"] = st
        text = paras[para - 1]["text"] if 1 <= para <= len(paras) else ""
        n["para_head"] = text[:16]
        out.append(n)
    out.sort(key=lambda x: (x["para_anchor"], x["offset"], x["createdAt"]))
    return out


# ---------------------------------------------------------------- 路由

@app.after_request
def no_cache(resp):
    """本地工具：页面与静态文件都不缓存，改完刷新即生效。"""
    if request.path == "/" or request.path.startswith("/s/"):
        resp.headers["Cache-Control"] = "no-store, must-revalidate"
    return resp


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


def _media_root():
    """ config.json 可用 media_root 指定图片根目录（相对路径按实例目录解），
    默认取文稿所在目录。"""
    cfg = load_cfg()
    root = cfg.get("media_root") or os.path.dirname(os.path.abspath(cfg["manuscript"]))
    if not os.path.isabs(root):
        root = os.path.normpath(os.path.join(BASE, root))
    return root


@app.get("/media/<path:p>")
def media(p):
    """图片只读，send_from_directory 自身已挡 ../ 越界。"""
    return send_from_directory(_media_root(), p, max_age=0)


@app.get("/api/health")
def health():
    return jsonify(ok=True, notes_path=NOTES)


@app.get("/api/notes")
def api_notes():
    doc = parse_doc()
    return jsonify(doc=doc["path"], hash=doc["hash"], notes=decorate(doc, load_notes()))


@app.get("/api/doc")
def api_doc():
    doc = parse_doc()
    doc["app_title"] = load_cfg().get("app_title", "初稿批注")
    data = load_notes()
    notes = decorate(doc, data)
    doc["totals"] = {
        "chars": sum(p["chars"] for p in doc["paras"]),
        "paras": len(doc["paras"]),
        "open": sum(1 for n in notes if n["status"] == "open" and n["anchor"] != "orphan"),
        "done": sum(1 for n in notes if n["status"] == "done"),
        "orphan": sum(1 for n in notes if n["anchor"] == "orphan"),
    }
    doc["notes"] = notes
    return jsonify(doc)


@app.post("/api/notes")
def api_create():
    body = request.get_json(force=True) or {}
    text = (body.get("text") or "").strip()
    if not text:
        return jsonify(error="意见不能为空"), 400
    with LOCK:
        data = load_notes()
        doc = parse_doc()
        nid = body.get("id")
        if nid:
            for n in data["notes"]:
                if n["id"] == nid:
                    n.update({"text": text,
                              "tags": body.get("tags", n.get("tags", [])),
                              "updatedAt": now()})
                    save_notes(data)
                    return jsonify(ok=True, id=nid)
            return jsonify(error="找不到该批注"), 404
        note = {
            "id": "n_" + uuid.uuid4().hex[:6],
            "para": int(body.get("para") or 0),
            "quote": body.get("quote", ""),
            "prefix": body.get("prefix", ""),
            "suffix": body.get("suffix", ""),
            "offset": int(body.get("offset") or 0),
            "tags": body.get("tags", []),
            "text": text,
            "status": "open",
            "docHash": doc["hash"],
            "createdAt": now(),
            "updatedAt": now(),
        }
        data["notes"].append(note)
        save_notes(data)
        return jsonify(ok=True, id=note["id"])


@app.delete("/api/notes/<nid>")
def api_delete(nid):
    with LOCK:
        data = load_notes()
        before = len(data["notes"])
        data["notes"] = [n for n in data["notes"] if n["id"] != nid]
        if len(data["notes"]) == before:
            return jsonify(error="找不到该批注"), 404
        save_notes(data)
    return jsonify(ok=True)


@app.post("/api/notes/<nid>/status")
def api_status(nid):
    body = request.get_json(force=True) or {}
    status = body.get("status", "open")
    with LOCK:
        data = load_notes()
        for n in data["notes"]:
            if n["id"] == nid:
                n["status"] = status
                n["updatedAt"] = now()
                if status == "done":
                    n["doneAt"] = now()
                    if body.get("reply") is not None:
                        n["reply"] = str(body["reply"]).strip()
                else:
                    n.pop("reply", None)
                    n.pop("doneAt", None)
                save_notes(data)
                return jsonify(ok=True)
    return jsonify(error="找不到该批注"), 404


@app.post("/api/export")
def api_export():
    cfg = load_cfg()
    doc = parse_doc()
    notes = decorate(doc, load_notes())
    os.makedirs(EXPORT, exist_ok=True)
    path = os.path.join(EXPORT, "意见清单.md")
    opened = [n for n in notes if n["status"] == "open"]
    lines = [
        f"# {cfg.get('app_title', '初稿批注')}清单",
        "",
        f"文档：`{doc['path']}`（{sum(p['chars'] for p in doc['paras'])} 字，{len(doc['paras'])} 段，hash {doc['hash']}）",
        f"导出：{datetime.now().strftime('%Y-%m-%d %H:%M')}　待处理 {len(opened)} 条／已处理 {len(notes) - len(opened)} 条",
        "",
    ]
    cur = None
    for n in notes:
        key = n["para_anchor"]
        if key != cur:
            head = n["para_head"] or "（全文）"
            lines.append(f"## {'全文意见' if key == 0 else f'P{key}　{head}…'}")
            lines.append("")
            cur = key
        flag = "" if n["status"] == "open" else "（已处理）"
        tags = "·".join(n.get("tags") or []) or "—"
        lines.append(f"- **{n['id']}** ［{tags}］{flag}")
        if n["quote_anchor"]:
            q = n["quote_anchor"].replace("\n", " ")
            lines.append(f"  > 「{q}」")
        if n["anchor"] == "orphan":
            lines.append("  > ⚠ 定位可能失效，请人工确认")
        lines.append(f"  {n['text']}")
        lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return jsonify(ok=True, path=path, count=len(notes))


if __name__ == "__main__":
    port = int(load_cfg().get("port", 5178))
    app.run(host="127.0.0.1", port=port, debug=False)
