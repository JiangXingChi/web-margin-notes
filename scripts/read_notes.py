#!/usr/bin/env python
"""把批注读成改稿清单。

用法：
  python3 read_notes.py <notes.json> [--all] [--json]

默认只输出 status=open 的条目，按段落号排序；--all 含已处理；--json 原样输出。
"""
import json
import sys

def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    path = argv[1]
    only_open = "--all" not in argv
    raw = "--json" in argv

    data = json.load(open(path, encoding="utf-8"))
    notes = [n for n in data.get("notes", []) if not only_open or n.get("status") == "open"]
    notes.sort(key=lambda n: (n.get("para") or 0, n.get("offset") or 0))

    if raw:
        json.dump(notes, sys.stdout, ensure_ascii=False, indent=1)
        return 0

    print(f"# 改稿清单（{len(notes)} 条，{data.get('doc', '?')}）\n")
    cur = None
    for n in notes:
        para = n.get("para") or 0
        if para != cur:
            print(f"## {'全文' if para == 0 else 'P%d' % para}\n")
            cur = para
        tags = "·".join(n.get("tags") or []) or "—"
        print(f"- **{n.get('id')}** ［{tags}］")
        if n.get("quote"):
            print(f"  > 「{n['quote']}」")
        print(f"  {n.get('text', '').strip()}\n")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
