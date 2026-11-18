#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""smash-eggs 本地童声服务器

- 静态托管网页，监听 0.0.0.0，局域网内任意设备可访问
- /api/speak 按需合成真实神经网络童声（微软 Edge TTS），并缓存为 mp3
- 启动时后台预生成 js/data.js 中全部学习条目，之后完全离线朗读
- 不依赖第三方 Web 框架：HTTP 部分仅用 Python 标准库，语音部分用 edge-tts
"""

import argparse
import asyncio
import hashlib
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import edge_tts
except ImportError:
    sys.exit(
        "缺少 edge-tts 依赖。请执行：\n"
        "  python -m pip install edge-tts --index-url https://pypi.org/simple"
    )

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(ROOT, "cache", "audio")
DATA_JS = os.path.join(ROOT, "js", "data.js")
os.makedirs(CACHE_DIR, exist_ok=True)

# 五种预设对应的真实神经网络音色；英文条目单独用卡通女童 Ana
PROFILES = [
    {"name": "甜美女童", "zh": "zh-CN-XiaoyiNeural",   "en": "en-US-AnaNeural", "rate": "-8%"},
    {"name": "元气男童", "zh": "zh-CN-YunxiaNeural",  "en": "en-US-AnaNeural", "rate": "-3%"},
    {"name": "软萌宝宝", "zh": "zh-CN-XiaoyiNeural",   "en": "en-US-AnaNeural", "rate": "-18%"},
    {"name": "温柔姐姐", "zh": "zh-CN-XiaoxiaoNeural", "en": "en-US-AnaNeural", "rate": "-8%"},
    {"name": "自然朗读", "zh": "zh-CN-XiaoxiaoNeural", "en": "en-US-AnaNeural", "rate": "+0%"},
]

_is_english = re.compile(r"^[A-Za-z][A-Za-z ]*$")
_locks_guard = threading.Lock()
_locks = {}
_prefetch = {"total": 0, "done": 0, "running": False, "started": 0}
_synth_errors = []


def lock_for(key):
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def cache_path(text, style):
    key = hashlib.md5(("{}|{}".format(style, text)).encode("utf-8")).hexdigest()
    return os.path.join(CACHE_DIR, key + ".mp3")


def is_cached(path):
    return os.path.isfile(path) and os.path.getsize(path) > 1024


async def _synth(text, style, out):
    profile = PROFILES[style] if 0 <= style < len(PROFILES) else PROFILES[0]
    voice = profile["en"] if _is_english.match(text.strip()) else profile["zh"]
    comm = edge_tts.Communicate(text, voice, rate=profile["rate"])
    await comm.save(out)


def ensure_audio(text, style):
    """合成并缓存；缓存命中直接返回路径。并发同一文本只合成一次。"""
    text = str(text or "").strip()
    if not text:
        return None
    if not isinstance(style, int) or not 0 <= style < len(PROFILES):
        style = 0
    path = cache_path(text, style)
    if is_cached(path):
        return path
    with lock_for(os.path.basename(path)):
        if is_cached(path):
            return path
        tmp = path + ".tmp"
        try:
            asyncio.run(_synth(text, style, tmp))
            if not os.path.isfile(tmp) or os.path.getsize(tmp) < 512:
                raise RuntimeError("合成结果为空")
            os.replace(tmp, path)
            return path
        except Exception as exc:  # 联网失败时不要让页面卡死
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass
            if len(_synth_errors) < 20:
                _synth_errors.append(str(exc))
            return None


def all_learning_texts():
    """从 data.js 提取全部 C('文本', ...) 条目，去重。"""
    try:
        with open(DATA_JS, "r", encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return []
    texts = re.findall(r"C\('([^']*)'", src)
    seen, result = set(), []
    for t in texts:
        if t and t not in seen:
            seen.add(t)
            result.append(t)
    return result


def prefetch_worker(styles):
    texts = all_learning_texts()
    jobs = [(t, s) for t in texts for s in styles]
    _prefetch.update(total=len(jobs), done=0, running=True, started=time.time())
    for text, style in jobs:
        ensure_audio(text, style)
        _prefetch["done"] += 1
    _prefetch["running"] = False


class Handler(BaseHTTPRequestHandler):
    server_version = "SmashEggsVoice/1.0"

    def log_message(self, fmt, *args):
        pass  # 控制台只保留启动信息与关键错误

    def _send_bytes(self, body, ctype, cacheable=False, extra=None):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if cacheable else "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, obj):
        self._send_bytes(json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                         "application/json; charset=utf-8")

    def _send_error(self, code, msg):
        body = json.dumps({"error": msg}, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET(send_body=False)

    def do_GET(self, send_body=True):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        query = urllib.parse.parse_qs(parsed.query)

        if path == "/api/speak":
            text = (query.get("text") or [""])[0]
            try:
                style = int((query.get("style") or ["0"])[0])
            except ValueError:
                style = 0
            if not text.strip():
                self._send_error(400, "缺少 text 参数")
                return
            audio = ensure_audio(text, style)
            if not audio:
                self._send_error(503, "语音合成失败，请检查网络后重试")
                return
            with open(audio, "rb") as fh:
                body = fh.read()
            if send_body:
                self._send_bytes(body, "audio/mpeg", cacheable=True,
                                 extra={"X-Voice-Cache": os.path.basename(audio)})
            else:
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
            return

        if path == "/api/status":
            files = [f for f in os.listdir(CACHE_DIR) if f.endswith(".mp3")]
            self._send_json({
                "cached": len(files),
                "prefetch": _prefetch,
                "profiles": [p["name"] for p in PROFILES],
                "errors": _synth_errors[:5],
            })
            return

        if path == "/api/voices":
            self._send_json([{"name": p["name"], "zh": p["zh"], "en": p["en"]} for p in PROFILES])
            return

        # 静态文件（含 cache/audio 下的 mp3）
        rel = path.lstrip("/") or "index.html"
        full = os.path.abspath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT + os.sep) and full != ROOT:
            self._send_error(403, "禁止访问")
            return
        if not os.path.isfile(full):
            self._send_error(404, "文件不存在")
            return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            body = fh.read()
        self._send_bytes(body, ctype, cacheable=rel.startswith("cache/") and rel.endswith(".mp3"))


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    ap = argparse.ArgumentParser(description="砸金蛋学汉字 · 本地童声服务器")
    ap.add_argument("--port", type=int, default=8000, help="监听端口，默认 8000")
    ap.add_argument("--host", default="0.0.0.0", help="监听地址，默认 0.0.0.0（局域网可访问）")
    ap.add_argument("--no-prefetch", action="store_true", help="不后台预生成音频")
    ap.add_argument("--prefetch-styles", default="0", help="预生成的音色序号，逗号分隔，默认 0")
    args = ap.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    ip = lan_ip()
    print("=" * 58)
    print("  砸金蛋 · 学汉字  |  本地童声服务器已启动")
    print("=" * 58)
    print("  本机访问:    http://localhost:{}".format(args.port))
    print("  局域网访问:  http://{}:{}".format(ip, args.port))
    print("  手机/平板连同一个 WiFi，浏览器打开上面的局域网地址即可")
    print("  按 Ctrl+C 停止服务")
    print("-" * 58)

    if not args.no_prefetch:
        try:
            styles = [int(x) for x in args.prefetch_styles.split(",") if x.strip().isdigit()]
        except ValueError:
            styles = [0]
        styles = [s for s in styles if 0 <= s < len(PROFILES)] or [0]
        threading.Thread(target=prefetch_worker, args=(styles,), daemon=True).start()
        print("  后台正在预生成全部学习条目的童声音频，完成后可完全离线朗读")
        print("  进度查询: http://localhost:{}/api/status".format(args.port))
        print("-" * 58)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
