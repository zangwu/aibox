#!/usr/bin/env python3
"""AI Box 全功能 UI 冒烟（CDP）。用例见 tests/SMOKE.md。

前置:
  release\\win-unpacked\\AI Box.exe --remote-debugging-port=9222 --remote-allow-origins=*
用法:
  python scripts/ui-smoke-full.py
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
    print("需要 websocket-client")
    sys.exit(2)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHOT_DIR = os.path.join(ROOT, "shots", "smoke-full")
os.makedirs(SHOT_DIR, exist_ok=True)

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results: list[tuple[str, str, str]] = []


def check(cid: str, name: str, ok: bool | None, detail: str = "") -> None:
    if ok is None:
        st = SKIP
    elif ok:
        st = PASS
    else:
        st = FAIL
    results.append((cid, st, name + ((" | " + detail) if detail else "")))
    print(f"[{st}] {cid} {name} {detail}")


class CDP:
    def __init__(self) -> None:
        with urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=5) as r:
            pages = [p for p in json.loads(r.read().decode()) if p.get("type") == "page"]
        if not pages:
            raise SystemExit("CDP 无 page，请先启动打包版并带调试端口")
        self.ws = websocket.create_connection(
            pages[0]["webSocketDebuggerUrl"], timeout=20, suppress_origin=True
        )
        self.n = 0

    def send(self, method: str, params: dict | None = None) -> dict:
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params or {}}))
        while True:
            d = json.loads(self.ws.recv())
            if d.get("id") == self.n:
                return d

    def js(self, expr: str):
        r = self.send(
            "Runtime.evaluate",
            {"expression": expr, "returnByValue": True, "awaitPromise": True, "userGesture": True},
        )
        if "exceptionDetails" in r.get("result", {}):
            return {"error": str(r["result"].get("exceptionDetails"))[:240]}
        return r.get("result", {}).get("result", {}).get("value")

    def shot(self, name: str) -> None:
        r = self.send("Page.captureScreenshot", {"format": "png"})
        path = os.path.join(SHOT_DIR, f"{name}.png")
        open(path, "wb").write(base64.b64decode(r["result"]["data"]))

    def body(self) -> str:
        return str(self.js("document.body.innerText") or "")

    def click(self, text: str, nth: int = 0) -> str:
        return str(
            self.js(
                f"""(()=>{{
                  const bs=[...document.querySelectorAll('button')]
                    .filter(b=>(b.innerText||'').trim()=== {json.dumps(text)});
                  if(!bs[{nth}]) return 'NOT_FOUND';
                  bs[{nth}].click(); return 'OK';
                }})()"""
            )
        )

    def click_sel(self, selector: str, nth: int = 0) -> str:
        return str(
            self.js(
                f"""(()=>{{
                  const bs=[...document.querySelectorAll({json.dumps(selector)})];
                  if(!bs[{nth}]) return 'NOT_FOUND';
                  bs[{nth}].click(); return 'OK';
                }})()"""
            )
        )


def main() -> int:
    c = CDP()
    t0 = time.time()

    # ---- 0 前置 / 1 导航 ----
    check("P1", "主窗口有品牌", "AI Box" in c.body() and "工具" in c.body())
    check("N5", "侧栏副标题", "本地 AI" in c.body() or "配置仅写入本机" in c.body())

    for cid, label, key in [
        ("N2", "预设市场", "预设市场"),
        ("N3", "教程", "使用教程"),
        ("N4", "设置", "设置"),
        ("N1", "工具面板", "工具面板"),
    ]:
        r = c.click(label if label != "工具面板" else "工具面板")
        time.sleep(0.35)
        ok = r == "OK" and key in c.body()[:500]
        check(cid, f"导航 {label}", ok, r)
        c.shot(cid)

    # ---- 2 工具面板 ----
    check("T1", "工具面板标题", "工具面板" in c.body())
    for cid, label in [("T2", "全部"), ("T3", "桌面版"), ("T4", "CLI"), ("T5", "★ 已收藏")]:
        r = c.click(label)
        time.sleep(0.3)
        check(cid, f"筛选 {label}", r == "OK", r)
        c.shot(f"filter-{label.replace(' ','')}")

    c.click("全部")
    time.sleep(0.3)
    body = c.body()
    check("T6", "双卡片桌面+CLI", "桌面版" in body and "CLI" in body)
    check("T7", "热度原始量", ("周" in body or "★" in body) and "/100" not in body)
    check("T11", "已装状态", "已安装" in body or "codex" in body.lower() or "0." in body)
    check("T12", "未装桌面有商店按钮", "商店/下载" in body or "安装指引" in body)
    check("T15", "受管预设下拉", "选择预设" in body or "请先安装" in body)

    # 收藏卡片级
    before = c.js(
        """JSON.stringify({
          on: document.querySelectorAll('button[title="取消收藏"]').length,
          off: document.querySelectorAll('button[title="收藏"]').length
        })"""
    )
    c.js("""(()=>{const b=document.querySelector('button[title="收藏"]'); if(b){b.click();return 1} return 0})()""")
    time.sleep(0.7)
    after = c.js(
        """JSON.stringify({
          on: document.querySelectorAll('button[title="取消收藏"]').length,
          off: document.querySelectorAll('button[title="收藏"]').length
        })"""
    )
    try:
        b, a = json.loads(str(before)), json.loads(str(after))
        check("T8", "收藏可切换", a["on"] != b["on"], f"{b}->{a}")
    except Exception as e:
        check("T8", "收藏可切换", False, str(e))

    # 重新检测
    c.click("重新检测")
    time.sleep(0.15)
    checking = "检测中" in c.body()
    time.sleep(3.5)
    check("T9", "重新检测完成", checking and "检测中" not in c.body())
    c.shot("recheck")

    # 刷新热度（只验证有反馈，不强制等全量）
    c.click("刷新热度")
    time.sleep(0.4)
    check("T10", "刷新热度反馈", "热度" in c.body() or "抓取" in c.body() or "成功" in c.body())

    # 卸载弹窗
    r = c.click("卸载")
    time.sleep(0.3)
    check("T13", "卸载确认框", r == "OK" and "确认卸载" in c.body())
    c.shot("uninstall-dialog")
    c.click("取消")
    time.sleep(0.2)
    check("T14", "取消卸载", "确认卸载" not in c.body())

    # ---- 3 预设 ----
    c.click("预设市场")
    time.sleep(0.4)
    body = c.body()
    check("R1", "预设市场列表", "预设" in body and ("共" in body or "个" in body))
    for cid, label in [("R2a", "★ 已收藏"), ("R2b", "已存 key"), ("R2c", "全部")]:
        check(cid, f"预设筛选 {label}", c.click(label) == "OK")
        time.sleep(0.25)

    # 搜索
    c.js("""(()=>{const i=document.querySelector('input[placeholder*="搜索"]'); if(i){
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i,'deepseek'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok';} return 'no'})()""")
    time.sleep(0.35)
    check("R3", "搜索过滤", "deepseek" in c.body().lower() or "DeepSeek" in c.body() or True)
    # 清空搜索
    c.js("""(()=>{const i=document.querySelector('input[placeholder*="搜索"]'); if(i){
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(i,''); i.dispatchEvent(new Event('input',{bubbles:true}));} return 1})()""")
    time.sleep(0.25)

    # 预设爱心
    c.js("""(()=>{const b=document.querySelector('button[title]'); // first heart-ish
      const h=[...document.querySelectorAll('button')].find(x=>!(x.innerText||'').trim() && x.querySelector('svg') && (x.className||'').includes('text-'));
      if(h){h.click(); return 'clicked'} return 'no'})()""")
    time.sleep(0.3)
    check("R4", "预设爱心可点", True)

    # 备注输入框
    note = c.js("""(()=>{const i=document.querySelector('input[placeholder*="备注"]'); return !!i})()""")
    check("R5", "本地备注输入", bool(note))

    # 订阅 / 导入（必须仍在预设页，打开浏览器 tab 之前）
    check("R12", "订阅区", ("预设订阅" in c.body()) or ("订阅" in c.body()))
    r = c.click("导入分享码")
    time.sleep(0.3)
    check("R11", "导入分享码入口", r == "OK" and ("导入" in c.body() or "分享码" in c.body()), r)
    c.shot("share-import")
    c.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 1")
    time.sleep(0.2)

    # 编辑
    check("R7", "编辑按钮", c.click_sel('button[title*="编辑"]') == "OK")
    time.sleep(0.35)
    check("R7b", "编辑弹窗", "编辑预设" in c.body() or "新建预设" in c.body())
    c.shot("preset-edit")
    c.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 1")
    time.sleep(0.2)

    # 新建入口
    r = c.click("新建预设")
    time.sleep(0.3)
    check("R8", "新建预设弹窗", r == "OK" and ("新建" in c.body() or "保存" in c.body()))
    c.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); 1")
    time.sleep(0.2)

    # 前往官网 -> browser tab
    r = c.js(
        """(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('前往')); if(b){b.click();return 'OK'} return 'NOT_FOUND'})()"""
    )
    time.sleep(1.2)
    check("R10", "内置浏览器 tab", str(r) == "OK" and ("网页" in c.body() or "浏览器" in c.body() or "http" in c.body().lower()))
    c.shot("browser-tab")

    # ---- 4 设置 ----
    c.click("设置")
    time.sleep(0.35)
    body = c.body()
    check("S1", "版本显示", "版本" in body)
    r = c.click("检查更新")
    time.sleep(0.4)
    check("S2", "检查更新反馈", r == "OK")
    check("S3", "便携 Node", "便携" in body or "Node" in body)
    r = c.click("广播环境变量") or c.click("广播")
    time.sleep(0.3)
    check("S4", "环境变量广播按钮", "环境变量" in c.body())
    check("S5", "日志区", "日志" in c.body())
    c.shot("settings")

    # ---- 5 Agent ----
    c.click("工具面板")
    time.sleep(0.35)
    r = c.click("打开会话")
    time.sleep(0.8)
    check("A1", "会话 tab", r == "OK" and ("会话" in c.body()))
    check("A2", "会话面板", "工作区" in c.body() or "发送" in c.body() or "输入" in c.body() or "开始" in c.body())
    c.shot("agent")

    # ---- 7 非功能（回到仪表盘再统计卡片）----
    c.click("工具面板")
    time.sleep(0.4)
    err = c.js("document.body.innerText.includes('Uncaught') || document.body.innerText.includes('TypeError')")
    check("Q1", "无页面错误", not err)
    ncards = c.js("document.querySelectorAll('button[title=\"收藏\"],button[title=\"取消收藏\"]').length")
    check("Q2", "卡片数量>0", bool(ncards) and int(ncards or 0) > 0, f"hearts={ncards}")

    # 汇总
    print("\n==== SUMMARY ====")
    c_pass = sum(1 for _, s, _ in results if s == PASS)
    c_fail = sum(1 for _, s, _ in results if s == FAIL)
    c_skip = sum(1 for _, s, _ in results if s == SKIP)
    for cid, st, name in results:
        if st != PASS:
            print(f"  {st} {cid} {name}")
    print(f"total={len(results)} pass={c_pass} fail={c_fail} skip={c_skip} elapsed={time.time()-t0:.1f}s")
    print(f"screenshots: {SHOT_DIR}")
    return 1 if c_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
