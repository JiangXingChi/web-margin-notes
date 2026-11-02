#!/usr/bin/env bash
# draft-review —— 起本地服务（http://127.0.0.1:5178）
set -e
cd "$(dirname "$0")"
PY=~/.conda/envs/test/bin/python
[ -x "$PY" ] || PY=python3
exec "$PY" app.py
