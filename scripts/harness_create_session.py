#!/usr/bin/env python3
"""在 DeepSeek Harness 工作区创建会话并写入首条用户消息（P0 自动化）。"""
from __future__ import annotations

import compression.zstd as zstd
import json
import os
import sys
import time
import uuid
from pathlib import Path


def encode_ws_dir(abs_path: str) -> str:
    # D:\foo\bar -> --D-foo-bar--
    s = abs_path.replace("\\", "-").replace("/", "-").replace(":", "-")
    while "--" in s:
        s = s.replace("--", "-")
    return f"--{s.strip('-')}--"


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: harness_create_session.py <workspace> <prompt-text-file>")
        return 2
    ws = str(Path(sys.argv[1]).resolve())
    prompt = Path(sys.argv[2]).read_text(encoding="utf-8")
    root = Path(os.path.expanduser("~/.dsh"))
    sess_ws = root / "sessions" / encode_ws_dir(ws)
    sess_id = f"session-{uuid.uuid4()}"
    sess_dir = sess_ws / sess_id
    sess_dir.mkdir(parents=True, exist_ok=True)

    now = int(time.time() * 1000)
    msg_id = str(uuid.uuid4())
    events = [
        {
            "type": "session",
            "version": 4,
            "id": sess_id,
            "createdAt": now,
            "cwd": ws,
            "isSeeded": False,
            "delegationDepth": 0,
            "agentPreset": "standard",
        },
        {"type": "permission/preset", "seq": 0, "time": now, "data": {"preset": "danger-full-access"}},
        {"type": "sandbox/mode", "seq": 1, "time": now, "data": {"mode": "danger-full-access"}},
        {"type": "approval/policy", "seq": 2, "time": now, "data": {"policy": "never"}},
        {
            "type": "agent/inbox/spliced",
            "seq": 3,
            "time": now,
            "data": {
                "target": "next-turn",
                "start": 0,
                "inserted": [
                    {
                        "content": [{"type": "text", "text": prompt}],
                        "source": {"kind": "user"},
                        "role": "user",
                        "id": msg_id,
                    }
                ],
            },
        },
        {
            "type": "session/title",
            "seq": 4,
            "time": now,
            "data": {
                "title": prompt.splitlines()[0][:40] if prompt.strip() else "AI Box 任务",
                "messageSeqs": [3],
                "source": {"kind": "fallback"},
            },
        },
        {
            "type": "session-list/set-metadata",
            "seq": 5,
            "time": now,
            "data": {
                "sessionId": sess_id,
                "metadata": {"blank": False, "lastPromptAt": now},
            },
        },
    ]
    raw = "\n".join(json.dumps(e, ensure_ascii=False) for e in events) + "\n"
    out = sess_dir / "session.v4.jsonl.zstd"
    out.write_bytes(zstd.compress(raw.encode("utf-8")))

    # 登记到 workspace.json
    wj_path = root / "storages" / "workspace.json"
    wj_path.parent.mkdir(parents=True, exist_ok=True)
    if wj_path.exists():
        wj = json.loads(wj_path.read_text(encoding="utf-8"))
    else:
        wj = {
            "unit": {"name": "workspace", "version": 2},
            "global": {
                "initialized": True,
                "workspaceIds": [],
                "archivedSessionIds": [],
                "pinnedSessionIds": [],
            },
            "tables": {"workspaces": {}},
        }
    found = None
    for wid, row in list(wj["tables"].get("workspaces", {}).items()):
        if str(row.get("path", "")).replace("/", "\\").lower() == ws.lower():
            found = wid
            break
    if not found:
        found = str(uuid.uuid4())
        wj["tables"].setdefault("workspaces", {})[found] = {
            "path": ws,
            "title": Path(ws).name,
            "sessionIds": [],
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        }
        wj["global"].setdefault("workspaceIds", [])
        if found not in wj["global"]["workspaceIds"]:
            wj["global"]["workspaceIds"].insert(0, found)
    row = wj["tables"]["workspaces"][found]
    row.setdefault("sessionIds", [])
    if sess_id not in row["sessionIds"]:
        row["sessionIds"].insert(0, sess_id)
    row["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    wj["global"]["defaultWorkspaceId"] = found
    wj_path.write_text(json.dumps(wj, ensure_ascii=False, indent=2), encoding="utf-8")

    # 简易 cache（部分版本会读）
    cache_dir = root / "storages" / "session_projcache" / "sessions"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = {
        "version": 7,
        "record": {
            "identity": {
                "formatVersion": 4,
                "createdAt": now,
                "cwd": ws,
                "isSeeded": False,
                "inheritedEventCount": 0,
            },
            "rows": {
                "title": {"ver": 1, "seq": 4, "val": events[5]["data"]["title"]},
                "sessionListMetadata": {
                    "ver": 1,
                    "seq": 5,
                    "val": {"blank": False, "lastPromptAt": now},
                },
            },
        },
    }
    (cache_dir / f"{sess_id}.json").write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    print(json.dumps({"ok": True, "sessionId": sess_id, "path": str(out), "workspaceId": found}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
