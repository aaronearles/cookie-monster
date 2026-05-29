"""
Cookie-Monster client helper — Python.

Copy this function into any project that needs session cookies.
Reads from %USERPROFILE%\.session-cookies\{host}.env (Windows)
or /mnt/c/Users/{user}/.session-cookies/{host}.env (WSL).
"""

from pathlib import Path
import os


def load_cookies(hostname: str) -> dict[str, str]:
    store = Path(os.environ.get("USERPROFILE", "")) / ".session-cookies"
    if not store.exists():
        store = Path(f"/mnt/c/Users/{os.environ.get('USER', '')}/.session-cookies")
    cookies: dict[str, str] = {}
    for line in (store / f"{hostname}.env").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            k, _, v = line.partition("=")
            cookies[k] = v
    return cookies


def cookie_header(hostname: str) -> str:
    return "; ".join(f"{k}={v}" for k, v in load_cookies(hostname).items())


if __name__ == "__main__":
    import sys
    hostname = sys.argv[1] if len(sys.argv) > 1 else input("Host: ")
    print(cookie_header(hostname))
