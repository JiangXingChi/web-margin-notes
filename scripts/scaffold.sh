#!/usr/bin/env bash
# 在任意目录新建一个批注实例
#   bash scaffold.sh <目标目录> <要批注的 markdown> [端口]
# 例：bash scaffold.sh ~/Agent/Temp/notes-review ~/Agent/Temp/x/manuscript.md 5179
set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,4p' "$0"
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"
src="$here/../templates"
dst="$1"
md="$(realpath "$2")"
port="${3:-5178}"

[ -f "$md" ] || { echo "找不到文稿：$md" >&2; exit 1; }
[ -e "$dst" ] && { echo "目标目录已存在（不覆盖）：$dst" >&2; exit 1; }

mkdir -p "$dst/data" "$dst/export"
cp -r "$src/static" "$src/app.py" "$src/start.sh" "$dst/"
chmod +x "$dst/start.sh"

python3 - "$dst/data/config.json" "$dst/data/notes.json" "$md" "$port" <<'PY'
import json, sys, os
cfg_path, notes_path, md, port = sys.argv[1:5]
cfg = {"manuscript": md, "port": int(port), "app_title": "初稿批注", "ref_head": "## 参考文献",
       "media_root": os.path.dirname(os.path.abspath(md))}
json.dump(cfg, open(cfg_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump({"doc": md, "version": 1, "notes": []}, open(notes_path, "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
PY

cat <<EOF
已生成：$dst
文稿：$md

起服务：
  cd "$dst" && bash start.sh
打开：
  http://127.0.0.1:$port/

读批注：
  python3 $here/read_notes.py "$dst/data/notes.json"
EOF
