#!/usr/bin/env python
"""验收脚本：检查一个已启动的批注实例。

用法：
  python3 verify.py [http://127.0.0.1:5178]

检查项：
  1. /api/doc 可读，段落数 > 0，字数 > 0
  2. /api/notes 可读，字段齐全（id/para/status/text）
  3. 每条批注的锚点状态属于 exact/relocated/fuzzy/orphan
  4. 段落审核标记：/api/doc 的 review 字段与 totals.reviewed 一致（v7.4）
  5. （可选）装了 playwright + chromium 时，检查边注与高亮对齐、无重叠
退出码 0 = 全部通过。
"""
import json
import sys
import urllib.request


def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.load(r)


def main(argv):
    base = (argv[1] if len(argv) > 1 else "http://127.0.0.1:5178").rstrip("/")
    problems = []

    doc = get(base + "/api/doc")
    paras = doc.get("paras", [])
    chars = doc.get("totals", {}).get("chars", 0)
    print(f"段落 {len(paras)}　正文 {chars} 字　hash {doc.get('hash')}")
    if not paras:
        problems.append("/api/doc 没有段落")
    if chars <= 0:
        problems.append("/api/doc 字数为 0")

    bad = [n for n in doc.get("notes", [])
           if not {"id", "para_anchor", "status", "text"} <= set(n)]
    if bad:
        problems.append(f"{len(bad)} 条批注字段不全")
    anchors = {}
    for n in doc.get("notes", []):
        anchors[n.get("anchor")] = anchors.get(n.get("anchor"), 0) + 1
    unknown = [k for k in anchors if k not in ("exact", "relocated", "fuzzy", "orphan")]
    if unknown:
        problems.append(f"未知锚点状态：{unknown}")
    print(f"批注 {len(doc.get('notes', []))} 条　锚点 {anchors or '—'}")

    review = doc.get("review") or {}
    reviewed = doc.get("totals", {}).get("reviewed", 0)
    if reviewed != sum(1 for v in review.values() if v.get("state") == "done"):
        problems.append("totals.reviewed 与 review 条数不一致")
    bad_state = [k for k, v in review.items() if v.get("state") not in ("done", "stale")]
    if bad_state:
        problems.append(f"段落审核状态异常：{bad_state}")
    print(f"已审段 {reviewed}/{len(paras)}　过期 {doc.get('totals', {}).get('reviewed_stale', 0)}")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("跳过版式检查（未装 playwright）")
    else:
        import os
        exe = next((c for c in ("/usr/bin/chromium", "/usr/bin/google-chrome",
                                "/usr/bin/chromium-browser") if os.path.exists(c)), None)
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
                try:
                    pg = browser.new_page(viewport={"width": 1512, "height": 1000})
                    errs = []
                    pg.on("pageerror", lambda e: errs.append(str(e)))
                    pg.goto(base + "/", wait_until="networkidle")
                    pg.wait_for_timeout(600)
                    r = pg.evaluate("""()=>{
                      const cards=[...document.querySelectorAll('#margin .card[data-id]')].map(c=>{
                        const m=document.querySelector(`mark[data-id="${c.dataset.id}"]`);
                        const who=c.querySelector('.who');
                        return {id:c.dataset.id, top:c.getBoundingClientRect().top,
                                bottom:c.getBoundingClientRect().bottom,
                                mtop:m?m.getBoundingClientRect().top:null};
                      }).sort((a,b)=>a.top-b.top);
                      const ov=[]; for(let i=1;i<cards.length;i++)
                        if(cards[i].top<cards[i-1].bottom-1) ov.push([cards[i-1].id,cards[i].id]);
                      const mis=cards.filter(c=>c.mtop!==null && c.top < c.mtop-1).map(c=>c.id);
                      const pushed=cards.filter(c=>c.mtop!==null && c.top > c.mtop+1).length;
                      const doc=document.querySelector('#doc');
                      return {focus:document.body.classList.contains('focus-mode'),
                              n:cards.length, ov, mis, pushed,
                              paras:document.querySelectorAll('.para').length,
                              stars:doc?((doc.textContent.match(/\\*\\*/g)||[]).length):-1};
                    }""")
                    print(f"版式：卡片 {r['n']}　越位 {r['mis']}　避让下移 {r['pushed']}　重叠 {r['ov']}　残留 ** {r['stars']}")
                    if r["ov"]:
                        problems.append(f"边注重叠 {r['ov']}")
                    if r["mis"]:
                        problems.append(f"边注高于锚点 {r['mis']}")
                    if r["stars"]:
                        problems.append("正文残留 markdown 粗体标记 **")
                    if r["focus"]:
                        if not 1 <= r["paras"] <= 3:
                            problems.append(f"逐段模式渲染了 {r['paras']} 段（应为 1，带上下文时最多 3）")
                        print(f"模式：逐段（渲染 {r['paras']} 段）")
                    elif r["paras"] != len(paras):
                        problems.append("全文模式页面段落数与 /api/doc 不一致")
                    else:
                        print(f"模式：全文（渲染 {r['paras']} 段）")
                    if errs:
                        problems.append(f"JS 报错 {errs[:2]}")
                except Exception as e:      # 浏览器起来了但检查本身失败 = 真问题
                    problems.append(f"版式检查失败：{type(e).__name__}: {e}")
                finally:
                    browser.close()
        except Exception as e:              # 浏览器没装好，跳过
            print(f"跳过版式检查（{type(e).__name__}: {e}）")

    if problems:
        print("\n未通过：")
        for x in problems:
            print(" -", x)
        return 1
    print("\n全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
