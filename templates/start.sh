#!/usr/bin/env bash
# draft-review —— 起本地服务（http://127.0.0.1:5178）
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"     # 需要别的解释器就 PYTHON=/path/to/python bash start.sh
exec "$PY" app.py
