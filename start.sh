#!/usr/bin/env bash
# 砸金蛋学汉字 · 一键启动本地童声服务器（macOS / Linux）
cd "$(dirname "$0")" || exit 1

PY="${PYTHON:-python3}"
if ! "$PY" -c "import edge_tts" >/dev/null 2>&1; then
  echo "正在安装语音依赖 edge-tts ..."
  "$PY" -m pip install edge-tts --index-url https://pypi.org/simple || exit 1
fi

exec "$PY" server.py
