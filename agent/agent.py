"""
Cookie-Monster native messaging agent.

Spawned on-demand by the browser when the extension sends a message.
Reads JSON from stdin, writes a cookie file to the store, returns JSON to stdout.
Exits after handling one message — no persistent daemon.

Native messaging protocol:
  - Input:  4-byte little-endian length prefix + UTF-8 JSON
  - Output: 4-byte little-endian length prefix + UTF-8 JSON

See spec.md for payload schema and file format details.
"""

import json
import os
import struct
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


AGENT_DIR = Path(__file__).parent
STORE_DIR = Path(os.environ.get("USERPROFILE", Path.home())) / ".session-cookies"
OVERRIDE_SITES = Path(os.environ.get("USERPROFILE", Path.home())) / ".cookie-monster" / "sites.json"
BUNDLED_SITES = AGENT_DIR / "sites.json"  # copy kept in sync with extension/sites.json
HOST_NAME = "com.cookiemonster.agent"


def read_message() -> dict:
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        sys.exit(0)
    length = struct.unpack("<I", raw_len)[0]
    return json.loads(sys.stdin.buffer.read(length))


def send_message(payload: dict) -> None:
    encoded = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def load_sites() -> dict:
    base = {}
    if BUNDLED_SITES.exists():
        base = json.loads(BUNDLED_SITES.read_text(encoding="utf-8"))
    if OVERRIDE_SITES.exists():
        override = json.loads(OVERRIDE_SITES.read_text(encoding="utf-8"))
        for host, cfg in override.items():
            if host in base:
                base[host] = {**base[host], **cfg}
            else:
                base[host] = cfg
    return base


def write_cookies(host: str, cookies: dict, captured_at: str) -> Path:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    out = STORE_DIR / (host + '.env')

    lines = [
        f"# host: {host}",
        f"# captured: {captured_at}",
        f"# count: {len(cookies)}",
        *[f"{k}={v}" for k, v in cookies.items()],
        "",
    ]
    content = "\n".join(lines)

    # Atomic write — tmp file in same directory then rename
    tmp = out.with_suffix(".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(out)
    return out


def main():
    msg = read_message()
    action = msg.get("action")

    if action == "get_config":
        send_message({"ok": True, "sites": load_sites()})
        return

    if action == "push" or "host" in msg:
        host = msg.get("host", "")
        cookies = msg.get("cookies", {})
        captured_at = msg.get("captured_at", datetime.now(timezone.utc).isoformat())

        sites = load_sites()
        site_cfg = sites.get(host, {})
        include = site_cfg.get("include_cookies", [])
        if include:
            cookies = {k: v for k, v in cookies.items() if k in include}

        path = write_cookies(host, cookies, captured_at)
        send_message({"ok": True, "path": str(path), "count": len(cookies)})
        return

    send_message({"ok": False, "error": f"Unknown action: {action!r}"})


if __name__ == "__main__":
    main()
