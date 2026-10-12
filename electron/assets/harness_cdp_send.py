#!/usr/bin/env python3
"""CDP → DeepSeek Harness：新会话 → 选工作区（校验）→ 完全权限 → 发送。"""
from __future__ import annotations

import json
import sys
import time
import urllib.request

import websocket


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: harness_cdp_send.py <workspace_title> <prompt.txt> [port]")
        return 2
    ws_title = sys.argv[1]
    prompt = open(sys.argv[2], encoding="utf-8").read()
    port = int(sys.argv[3]) if len(sys.argv) > 3 else 9333

    pages = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=8).read())
    page = next((p for p in pages if p.get("type") == "page"), None)
    if not page:
        print(json.dumps({"ok": False, "error": "no cdp page"}, ensure_ascii=False))
        return 1
    sock = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=25, suppress_origin=True)
    n = 0

    def send(method, params=None):
        nonlocal n
        n += 1
        sock.send(json.dumps({"id": n, "method": method, "params": params or {}}))
        while True:
            d = json.loads(sock.recv())
            if d.get("id") == n:
                return d

    def ev(expr: str, ap: bool = False):
        return (
            send(
                "Runtime.evaluate",
                {"expression": expr, "returnByValue": True, "awaitPromise": ap, "userGesture": True},
            )
            .get("result", {})
            .get("result", {})
            .get("value")
        )

    # 1 新会话
    ev(
        """(()=>{const b=document.querySelector('button[aria-label="新建会话"]')
          ||[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('新会话'));
          if(b){b.click();return 'ok'} return 'no'})()"""
    )
    time.sleep(1.0)

    # 2 工作区
    pick = ev(
        """
        (() => {
          const picker=document.querySelector('button[aria-label="选择工作区"]');
          if(!picker) return 'no-picker';
          if(picker.getAttribute('aria-expanded')!=='true') picker.click();
          return new Promise(r=>setTimeout(()=>{
            const menu=document.querySelector('[role="menu"]');
            if(!menu){ r('no-menu'); return; }
            const hit=[...menu.querySelectorAll('button,[role="menuitem"]')]
              .find(e=>(e.innerText||'').trim()=== %s);
            if(!hit){ r('no-hit'); return; }
            hit.click(); r('picked');
          }, 450));
        })()
        """
        % json.dumps(ws_title),
        True,
    )
    time.sleep(0.7)
    label = ev(
        """(()=>{const e=document.querySelector('.Hqq-bq_workspaceLabel')
          ||document.querySelector('button[aria-label="选择工作区"]');
          return e?(e.innerText||e.textContent||'').trim():''})()"""
    )
    if label and ws_title not in label:
        print(json.dumps({"ok": False, "error": "workspace mismatch", "label": label, "want": ws_title}, ensure_ascii=False))
        return 1

    # 3 完全权限（最多 4 次）
    perm_label = ""
    for _ in range(4):
        perm_label = ev(
            """
            (()=>{
              const lab=document.querySelector('button[aria-label^="访问模式"]');
              if(!lab) return '';
              const cur=lab.getAttribute('aria-label')||'';
              if(cur.includes('完全权限')) return cur;
              lab.click();
              return new Promise(res=>{
                let n=0;
                const t=setInterval(()=>{
                  n++;
                  const hit=[...document.querySelectorAll('button[role="menuitem"]')]
                    .find(e=>(e.innerText||'').trim()==='完全权限');
                  if(hit){
                    clearInterval(t);
                    hit.click();
                    setTimeout(()=>{
                      const l=document.querySelector('button[aria-label^="访问模式"]');
                      res(l?(l.getAttribute('aria-label')||''):'');
                    }, 350);
                  } else if(n>12){
                    clearInterval(t);
                    res(lab.getAttribute('aria-label')||'');
                  }
                }, 100);
              });
            })()
            """,
            True,
        )
        if perm_label and "完全权限" in perm_label:
            break
        time.sleep(0.8)

    # 4 发送
    ev(
        """(()=>{const box=document.querySelector('[contenteditable=true].RlGAzG_input')
          ||[...document.querySelectorAll('[contenteditable=true],textarea')].find(e=>e.offsetParent!==null);
          if(!box) return 'no-input'; box.focus(); box.click(); return 'ok'})()"""
    )
    time.sleep(0.25)
    send("Input.insertText", {"text": prompt})
    time.sleep(0.35)
    ev(
        """(()=>{const b=document.querySelector('button[aria-label="发送消息"]');
          if(b){b.click(); return 'ok'} return 'no-btn'})()"""
    )
    time.sleep(1.2)

    print(
        json.dumps(
            {
                "ok": True,
                "workspaceLabel": label,
                "pick": pick,
                "permission": perm_label,
                "permFull": bool(perm_label and "完全权限" in perm_label),
                "sent": True,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
