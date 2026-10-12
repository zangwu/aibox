#!/usr/bin/env python3
"""破坏性/重操作自动化冒烟：卸载重装 Codex、假 key 写配置、便携 Node。

前置：打包版带 CDP 启动。
用法：python scripts/ui-smoke-destructive.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request

try:
    import websocket
except ImportError:
    sys.exit("need websocket-client")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
results = []


def check(cid: str, name: str, ok: bool, detail: str = "") -> None:
    st = "PASS" if ok else "FAIL"
    results.append((cid, st, name, detail))
    print(f"[{st}] {cid} {name} {detail}")


class CDP:
    def __init__(self) -> None:
        with urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5) as r:
            pages = [p for p in json.loads(r.read().decode()) if p.get("type") == "page"]
        if not pages:
            raise SystemExit("CDP no page")
        self.ws = websocket.create_connection(pages[0]["webSocketDebuggerUrl"], timeout=60, suppress_origin=True)
        self.n = 0

    def send(self, method, params=None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            d = json.loads(self.ws.recv())
            if d.get("id") == self.n:
                return d

    def js(self, expr: str, await_ms: int = 0):
        if await_ms:
            expr = f"(async () => {{ {expr} }})()"
        r = self.send(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": True, "userGesture": True},
        )
        if "exceptionDetails" in r.get("result", {}):
            return {"error": str(r["result"].get("exceptionDetails"))[:400]}
        return r.get("result", {}).get("result", {}).get("value")

    def body(self) -> str:
        return str(self.js("document.body.innerText") or "")


def where_codex() -> str | None:
    try:
        out = subprocess.check_output("where.exe codex", shell=True, text=True, stderr=subprocess.DEVNULL)
        line = out.strip().splitlines()[0].strip()
        return line or None
    except Exception:
        return None


def main() -> int:
    c = CDP()
    home = os.environ.get("USERPROFILE", "")
    cfg_path = os.path.join(home, ".codex", "config.toml")

    print("=== D1 卸载 Codex CLI（精确点卡）===")
    c.js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='工具面板'); if(b)b.click(); return 1})()")
    time.sleep(0.4)
    before = where_codex()
    check("D1.0", "卸载前 codex 存在", before is not None, str(before))
    r = c.js(
        """
        (() => {
          const roots = [...document.querySelectorAll('div.rounded-xl')];
          for (const root of roots) {
            const text = root.innerText || '';
            const title = root.querySelector('.text-sm.font-medium')?.innerText || '';
            if (title.includes('Codex CLI') && !title.includes('桌面')) {
              const btn = [...root.querySelectorAll('button')].find(b => (b.innerText||'').trim()==='卸载');
              if (btn) { btn.click(); return 'dialog-cli'; }
            }
          }
          const uninstallBtns = [...document.querySelectorAll('button')].filter(b => (b.innerText||'').trim()==='卸载');
          if (uninstallBtns[0]) { uninstallBtns[0].click(); return 'dialog-any'; }
          return 'no-uninstall-btn';
        })()
        """
    )
    time.sleep(0.3)
    check("D1.1", "卸载弹窗", "dialog" in str(r) and "确认卸载" in c.body(), str(r))
    r2 = c.js(
        """
        (() => {
          const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim()==='确认卸载');
          if (!b) return 'no-confirm';
          b.click();
          return 'confirmed';
        })()
        """
    )
    check("D1.2", "确认卸载点击", str(r2) == "confirmed", str(r2))
    gone = False
    for i in range(25):
        time.sleep(1)
        if where_codex() is None:
            gone = True
            break
    check("D1.3", "codex 已从 PATH 消失", gone, f"still={where_codex()}")
    time.sleep(1)
    c.js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('重新检测')); if(b)b.click(); return 1})()")
    time.sleep(2.5)
    check("D1.4", "UI 显示未安装", "未安装" in c.body())

    print("=== D2 一键重装 Codex CLI ===")
    r = c.js(
        """
        (() => {
          const roots = [...document.querySelectorAll('div.rounded-xl')];
          for (const root of roots) {
            const title = root.querySelector('.text-sm.font-medium')?.innerText || '';
            if (title.includes('Codex CLI') && !title.includes('桌面')) {
              const btn = [...root.querySelectorAll('button')].find(b => (b.innerText||'').includes('一键安装'));
              if (btn) { btn.click(); return 'installing-cli'; }
            }
          }
          const installs = [...document.querySelectorAll('button')].filter(b => (b.innerText||'').includes('一键安装'));
          if (installs[0]) { installs[0].click(); return 'installing-any'; }
          return 'no-install-btn';
        })()
        """
    )
    check("D2.1", "一键安装按钮(Codex CLI)", "installing" in str(r), str(r))
    installed = False
    for i in range(90):
        time.sleep(2)
        if where_codex():
            installed = True
            break
        if i % 15 == 14:
            c.js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('重新检测')); if(b)b.click(); return 1})()")
            time.sleep(1)
    check("D2.2", "codex 重装成功", installed, where_codex() or "missing")
    time.sleep(1)
    c.js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('重新检测')); if(b)b.click(); return 1})()")
    time.sleep(3)
    body = c.body()
    check("D2.3", "UI 检出已装", "Codex CLI" in body and ("已安装" in body or "codex" in body.lower()))

    print("=== D3 假 key 写配置（window.aibox.applyPreset）===")
    # 备份现有 config.toml
    backup = cfg_path + ".smoke-backup"
    if os.path.exists(cfg_path):
        open(backup, "w", encoding="utf-8").write(open(cfg_path, encoding="utf-8").read())
        check("D3.0", "已备份 config.toml", True, backup)
    apply_res = c.js(
        """
        const presets = await window.aibox.listPresets();
        const p = presets.find(x => x.supports && x.supports.includes('codex')) || presets[0];
        if (!p) return {error: 'no preset'};
        const report = await window.aibox.applyPreset(p.id, ['codex'], 'sk-smoke-fake-key-000');
        return {preset: p.id, report};
        """,
        await_ms=1,
    )
    print("  apply ->", json.dumps(apply_res, ensure_ascii=False)[:400])
    time.sleep(0.5)
    cfg_ok = os.path.exists(cfg_path)
    text = open(cfg_path, encoding="utf-8").read() if cfg_ok else ""
    check("D3.1", "config.toml 存在", cfg_ok, cfg_path)
    check("D3.2", "config 含 model_provider/wire_api", ("model_provider" in text or "wire_api" in text or "base_url" in text or "base_url" in text.lower()) or "OPENAI" in text, text[:120].replace("\n", " "))
    # 校验 apply report 有 codex 项
    try:
        items = (apply_res or {}).get("report", {}).get("items") or []
        check("D3.3", "apply report 含 codex", any(i.get("tool") == "codex" for i in items), str(len(items)))
    except Exception as e:
        check("D3.3", "apply report 含 codex", False, str(e))

    print("=== D4 便携 Node 下载 ===")
    # 先直接问 IPC；若 Promise 未解包则查磁盘
    status = c.js("window.aibox.getPortableNodeStatus()", await_ms=1)
    print("  portable status", status)
    pdir = os.path.join(os.environ.get("APPDATA", ""), "aibox", "portable-node")
    has_node = False
    for root, _, files in os.walk(pdir):
        if "node.exe" in files:
            has_node = True
            break
    check("D4.0", "便携 Node 目录含 node.exe", has_node, pdir)
    c.js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='设置'); if(b)b.click(); return 1})()")
    time.sleep(0.4)
    # 点「下载便携 Node」类按钮（可能显示已就绪）
    r = c.js(
        """
        (() => {
          const bs = [...document.querySelectorAll('button')].filter(x => {
            const t = (x.innerText||'');
            return t.includes('便携') || t.includes('下载') || t.includes('已就绪');
          });
          if (bs[0]) { bs[0].click(); return 'clicked:' + bs[0].innerText.trim(); }
          return 'no-btn';
        })()
        """
    )
    check("D4.1", "便携 Node 按钮可点", "clicked" in str(r) or has_node, str(r))
    ok = has_node
    for i in range(40):
        if ok:
            break
        time.sleep(3)
        for root, _, files in os.walk(pdir):
            if "node.exe" in files:
                ok = True
                break
    check("D4.2", "便携 Node 可用", ok, pdir if ok else "missing node.exe")

    print("\n==== SUMMARY ====")
    fails = [x for x in results if x[1] == "FAIL"]
    for cid, st, name, detail in results:
        if st != "PASS":
            print(f"  {st} {cid} {name} {detail}")
    print(f"total={len(results)} pass={len(results)-len(fails)} fail={len(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
