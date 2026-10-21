#!/usr/bin/env python3
"""Git 推送自动重试：网络抖动时每隔一段时间 push，直到成功。"""
from __future__ import annotations

import subprocess
import sys
import time

REMOTES = [("origin", ["main", "develop"])]
MAX_TRIES = 30
INTERVAL_SEC = 20


def run(cmd: list[str]) -> tuple[int, str]:
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    return p.returncode, out.strip()


def push_once() -> bool:
    ok = True
    for remote, branches in REMOTES:
        for br in branches:
            code, out = run(["git", "push", remote, br])
            print(f"push {remote} {br} -> {code}")
            if out:
                print(out[-400:])
            if code != 0:
                ok = False
    return ok


def main() -> int:
    for i in range(1, MAX_TRIES + 1):
        print(f"=== try {i}/{MAX_TRIES} ===")
        if push_once():
            print("PUSH OK")
            return 0
        if i < MAX_TRIES:
            time.sleep(INTERVAL_SEC)
    print("PUSH FAILED after retries")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
