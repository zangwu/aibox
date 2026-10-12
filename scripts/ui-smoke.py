#!/usr/bin/env python3
"""AI Box 打包版 UI 冒烟（CDP）。

用法：
  1. 启动: release\\win-unpacked\\AI Box.exe --remote-debugging-port=9222 --remote-allow-origins=*
  2. 运行: python scripts/ui-smoke.py

验收项：筛选 / 双卡片 / 收藏(卡片级) / 热度原始量 / 卸载弹窗 / 预设编辑 / 教程设置。
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.request

try:
    import websocket
except ImportError:
    print("需要 websocket-client: pip install websocket-client")
    sys.exit(2)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHOT_DIR = os.path.join(ROOT, "shots")
os.makedirs(SHOT_DIR, exist_ok=True)


def cdp_pages() -> list[dict]:
    with urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5) as r:
        return [p for p in json.loads(r.read().decode()) if p.get("type") == "page"]


class CDP:
    def __init__(self) -> None:
        pages = cdp_pages()
        if not pages:
            raise SystemExit("未找到 CDP page，请先带 --remote-debugging-port=9222 启动 AI Box")
        self.ws = websocket.create_connection(
            pages[0]["webSocketDebuggerUrl"], timeout=20, suppress_origin=True
        )
        self.msg_id = 0

    def send(self, method: str, params: dict | None = None) -> dict:
        self.msg_id += 1
        self.ws.send(json.dumps({"id": self.msg_id, "method": method, "params": params or {}}))
        while True:
            data = json.loads(self.ws.recv())
            if data.get("id") == self.msg_id:
                return data

    def js(self, expr: str):
        r = self.send(
            "Runtime.evaluate",
            {
                "expression": expr,
                "returnByValue": True,
                "awaitPromise": True,
                "userGesture": True,
            },
        )
        if "exceptionDetails" in r.get("result", {}):
            return {"error": r["result"]["exceptionDetails"]}
        return r.get("result", {}).get("result", {}).get("value")

    def shot(self, name: str) -> None:
        r = self.send("Page.captureScreenshot", {"format": "png"})
        path = os.path.join(SHOT_DIR, f"smoke-{name}.png")
        open(path, "wb").write(base64.b64decode(r["result"]["data"]))
        print(f"  shot {path}")

    def click_text(self, text: str, nth: int = 0) -> str:
        return str(
            self.js(
                f"""
                (() => {{
                  const bs = [...document.querySelectorAll('button')]
                    .filter(b => (b.innerText||'').trim() === {json.dumps(text)});
                  if (!bs[{nth}]) return 'NOT_FOUND';
                  bs[{nth}].click();
                  return 'OK';
                }})()
                """
            )
        )

    def body(self) -> str:
        return str(self.js("document.body.innerText") or "")


def main() -> int:
    c = CDP()
    fails: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name} {detail}")
        if not ok:
            fails.append(name)

    print("== 筛选 ==")
    for label in ["★ 已收藏", "桌面版", "CLI", "全部"]:
        r = c.click_text(label)
        time.sleep(0.35)
        check(f"筛选 {label}", r == "OK", r)
        c.shot(f"filter-{label.replace(' ', '')}")

    print("== 双卡片文案 ==")
    body = c.body()
    check("存在桌面版卡", "桌面版" in body and "Codex" in body)
    check("存在 CLI 卡", "CLI" in body)
    check("热度原始量(非 /100)", "周" in body or "★" in body)

    print("== 卡片级收藏 ==")
    before = c.js(
        """
        JSON.stringify({
          on: document.querySelectorAll('button[title="取消收藏"]').length,
          off: document.querySelectorAll('button[title="收藏"]').length
        })
        """
    )
    print("  before", before)
    c.js(
        """
        (() => {
          const b = document.querySelector('button[title="收藏"]');
          if (!b) return 'none';
          b.click();
          return 'ok';
        })()
        """
    )
    time.sleep(0.8)
    after = c.js(
        """
        JSON.stringify({
          on: document.querySelectorAll('button[title="取消收藏"]').length,
          off: document.querySelectorAll('button[title="收藏"]').length
        })
        """
    )
    print("  after", after)
    try:
        b = json.loads(str(before))
        a = json.loads(str(after))
        check("收藏可切换", a["on"] != b["on"], f"{b} -> {a}")
    except Exception as e:
        check("收藏可切换", False, str(e))

    print("== 卸载弹窗 ==")
    r = c.click_text("卸载")
    time.sleep(0.3)
    check("卸载按钮", r == "OK", r)
    check("确认卸载文案", "确认卸载" in c.body())
    c.shot("uninstall")
    c.click_text("取消")
    time.sleep(0.2)

    print("== 预设编辑 ==")
    c.click_text("预设市场")
    time.sleep(0.4)
    check("编辑按钮存在", bool(c.js("!!document.querySelector('button[title*=编辑]')")))
    c.js("(()=>{const b=document.querySelector('button[title*=编辑]'); if(b)b.click(); return 1})()")
    time.sleep(0.35)
    check("编辑弹窗", "编辑预设" in c.body() or "新建预设" in c.body())
    c.shot("preset-edit")
    c.js("document.body.focus(); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")

    print("== 教程/设置 ==")
    for page in ["教程", "设置"]:
        c.click_text(page)
        time.sleep(0.3)
        check(f"打开{page}", page in c.body()[:400])
        c.shot(page)

    print("\n==== RESULT ====")
    if fails:
        print("FAIL", fails)
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
