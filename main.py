#!/usr/bin/env python3
"""DSH Plugin PPT Studio 离线预览与静默截图验收入口。

用法:
  python main.py                        # 启动本地服务并打开交互预览窗口
  python main.py --screenshot shot.png  # 无头不抢焦点渲染并输出 1440x900 截图
"""

from __future__ import annotations

import argparse
import functools
import http.server
import mimetypes
import os
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import webbrowser
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
PREVIEW_DIR = APP_ROOT / "dist"


class QuietPreviewHandler(http.server.SimpleHTTPRequestHandler):
    """只读托管 dist/ 的静默静态资源处理器。"""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
    }

    def log_message(self, format: str, *args: object) -> None:
        # 保持命令行输出简洁，避免刷屏
        return


class ReusableTCPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def find_chromium_browser() -> Path | None:
    """自动查找 Windows/通用环境中的 Edge (msedge.exe) 或 Chrome (chrome.exe)。"""
    for exe_name in ("msedge.exe", "chrome.exe", "msedge", "google-chrome", "chromium"):
        found = shutil.which(exe_name)
        if found:
            return Path(found)

    candidates: list[Path] = []
    env_roots = [
        os.environ.get("PROGRAMFILES", ""),
        os.environ.get("PROGRAMFILES(X86)", ""),
        os.environ.get("LOCALAPPDATA", ""),
    ]
    relative_bins = [
        Path("Microsoft") / "Edge" / "Application" / "msedge.exe",
        Path("Google") / "Chrome" / "Application" / "chrome.exe",
    ]
    for root in env_roots:
        if not root:
            continue
        for rel in relative_bins:
            candidates.append(Path(root) / rel)

    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def start_preview_server(directory: Path, port: int = 0) -> tuple[ReusableTCPServer, int]:
    """在 127.0.0.1 随机（或指定）端口启动只读静态 HTTP 服务。"""
    mimetypes.init()
    handler = functools.partial(QuietPreviewHandler, directory=str(directory))
    server = ReusableTCPServer(("127.0.0.1", port), handler)
    actual_port = int(server.server_address[1])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, actual_port


def capture_screenshot(browser: Path, url: str, output_path: Path) -> int:
    """使用无头 Edge/Chrome 在独立临时配置下截屏，不抢占桌面焦点。"""
    abs_output = output_path.resolve()
    abs_output.parent.mkdir(parents=True, exist_ok=True)
    if abs_output.exists():
        abs_output.unlink()

    with tempfile.TemporaryDirectory(prefix="dsh_ppt_shot_") as tmp_profile:
        cmd = [
            str(browser),
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            f"--user-data-dir={tmp_profile}",
            "--window-size=1440,900",
            "--virtual-time-budget=3000",
            "--hide-scrollbars",
            f"--screenshot={abs_output}",
            url,
        ]
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
            creationflags=creationflags,
        )

    if not abs_output.is_file() or abs_output.stat().st_size == 0:
        sys.stderr.write(
            f"[main.py] 截图生成失败 (exit={result.returncode}): {abs_output}\n"
            f"stderr: {result.stderr.strip()}\n"
        )
        return 1

    print(f"[main.py] 截图已保存: {abs_output} ({abs_output.stat().st_size} bytes)")
    return 0


def open_interactive_preview(browser: Path | None, url: str) -> None:
    """打开本地交互式预览窗；优先使用 Edge/Chrome --app 模式。"""
    print(f"[main.py] 预览服务已启动: {url}")
    print("[main.py] 按 Ctrl+C 停止服务。")

    if browser is not None:
        with tempfile.TemporaryDirectory(prefix="dsh_ppt_app_") as tmp_profile:
            cmd = [
                str(browser),
                f"--app={url}",
                "--window-size=1440,900",
                "--no-first-run",
                "--no-default-browser-check",
                f"--user-data-dir={tmp_profile}",
            ]
            proc = subprocess.Popen(cmd)
            try:
                proc.wait()
            except KeyboardInterrupt:
                proc.terminate()
        return

    webbrowser.open(url)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="DSH Plugin PPT Studio 离线预览与截图工具"
    )
    parser.add_argument(
        "--screenshot",
        metavar="FILE.png",
        help="使用无头浏览器截取 1440x900 界面图到指定 PNG 路径后退出",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="本地预览服务监听端口（默认 0 自动分配空闲端口）",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    index_file = PREVIEW_DIR / "index.html"
    if not index_file.is_file():
        sys.stderr.write(
            f"[main.py] 未找到构建产物 {index_file}，请先执行 `npm run build`。\n"
        )
        return 1

    browser = find_chromium_browser()
    server, port = start_preview_server(PREVIEW_DIR, port=args.port)
    try:
        if args.screenshot:
            if browser is None:
                sys.stderr.write(
                    "[main.py] 未找到可用的 Edge (msedge.exe) 或 Chrome (chrome.exe)。\n"
                )
                return 1
            target_url = f"http://127.0.0.1:{port}/?screenshot=1"
            return capture_screenshot(browser, target_url, Path(args.screenshot))

        target_url = f"http://127.0.0.1:{port}/"
        open_interactive_preview(browser, target_url)
        return 0
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
