# Consuming Cookie-Monster output files

This document is the complete reference for any tool, script, or AI agent that
wants to read Cookie-Monster cookie files. After reading this you have everything
needed to write a curl command, Python API client, or shell script that
authenticates using a captured browser session.

## TL;DR

```python
import os
from pathlib import Path

store = Path(os.environ["USERPROFILE"]) / ".session-cookies"  # Windows
# store = Path(f"/mnt/c/Users/{os.environ['USER']}/.session-cookies")  # WSL

path = store / "acme.service-now.com.env"
cookies = {}
for line in path.read_text(encoding="utf-8").splitlines():
    if line and not line.startswith("#"):
        k, _, v = line.partition("=")
        cookies[k] = v

header = "; ".join(f"{k}={v}" for k, v in cookies.items())
# use as: requests.get(url, headers={"Cookie": header})
```

---

## Store location

| Environment | Path |
|-------------|------|
| Windows | `%USERPROFILE%\.session-cookies\{hostname}.env` |
| WSL | `/mnt/c/Users/{username}/.session-cookies/{hostname}.env` |

`hostname` is the bare hostname with no scheme, no port, no path — exactly what
`new URL(url).hostname` returns. Examples:

```
acme.service-now.com  →  %USERPROFILE%\.session-cookies\acme.service-now.com.env
app.datadoghq.com          →  %USERPROFILE%\.session-cookies\app.datadoghq.com.env
github.com                 →  %USERPROFILE%\.session-cookies\github.com.env
```

The directory is excluded from OneDrive sync. It is never in the repo.

---

## File format

```
# host: acme.service-now.com
# captured: 2026-05-28T14:23:11Z
# count: 7
JSESSIONID=abc123def456
glide_session_store=xyz789
BIGipServerpool_acme=rd1o00000000000000000000ffffc0a8410do80
__Host-next-auth.csrf-token=abc%3D%3D
```

### Rules

- **Encoding:** UTF-8, LF line endings
- **Comment lines:** any line starting with `#` — skip entirely
- **Blank lines:** skip
- **Data lines:** `KEY=VALUE`
  - The **first `=`** is the delimiter; everything after it is the value
  - Values **may contain `=`** (base64, tokens, etc.) — use `partition("=")` or split with maxsplit=1
  - No quoting, no escaping — values are raw cookie values as the browser stored them
  - Values may contain URL-encoded sequences (`%xx`) — do not decode them; pass as-is
- **Order:** not guaranteed; do not rely on insertion order
- **Metadata comments** (`# host:`, `# captured:`, `# count:`) are informational only — ignore or parse as needed

### What to send

Build the `Cookie` request header by joining all `KEY=VALUE` pairs with `; `:

```
Cookie: JSESSIONID=abc123; glide_session_store=xyz789; BIGipServerpool_acme=rd1...
```

Do not add a trailing `;`. Pass the header value verbatim — do not URL-encode or
re-encode it.

---

## Parsing — copy-paste recipes

### Python

```python
from pathlib import Path
import os

def load_cookies(hostname: str) -> dict[str, str]:
    store = Path(os.environ.get("USERPROFILE", "")) / ".session-cookies"
    if not store.exists():                          # WSL fallback
        store = Path(f"/mnt/c/Users/{os.environ.get('USER', '')}/.session-cookies")
    cookies: dict[str, str] = {}
    for line in (store / f"{hostname}.env").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            k, _, v = line.partition("=")
            cookies[k] = v
    return cookies

def cookie_header(hostname: str) -> str:
    return "; ".join(f"{k}={v}" for k, v in load_cookies(hostname).items())

# With requests:
import requests
HOST = "acme.service-now.com"
resp = requests.get(f"https://{HOST}/api/now/table/incident",
                    headers={"Cookie": cookie_header(HOST)})
```

### curl (bash / WSL)

```bash
HOST="acme.service-now.com"
STORE="/mnt/c/Users/$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')/.session-cookies"

COOKIE=$(grep -v '^#' "${STORE}/${HOST}.env" \
         | awk -F= '{print $1"="substr($0,index($0,"=")+1)}' \
         | paste -sd'; ')

curl -s -H "Cookie: $COOKIE" "https://${HOST}/api/now/table/incident?sysparm_limit=5"
```

### PowerShell

```powershell
function Get-CookieHeader {
    param([string]$Hostname)
    $path = Join-Path $env:USERPROFILE ".session-cookies\$Hostname.env"
    (Get-Content $path |
        Where-Object { $_ -and $_ -notmatch '^#' } |
        ForEach-Object { $_ -split '=', 2 | ForEach-Object -Begin { $k = $null } `
            -Process { if (-not $k) { $k = $_ } else { "$k=$_" } } }) -join '; '
}

$headers = @{ Cookie = Get-CookieHeader "acme.service-now.com" }
Invoke-RestMethod -Uri "https://acme.service-now.com/api/now/table/incident" `
                  -Headers $headers
```

---

## Staleness and freshness

Cookie-Monster does not run automatically. A file is only as fresh as the last
time the user clicked **Send to Agent** for that hostname.

- **Check `# captured:` timestamp** if your tool needs to detect stale sessions
- A missing file means the user has not yet captured cookies for that host
- Files are written atomically (write to `.tmp` then rename) — a partial write is
  never visible to readers

Recommended pattern: attempt the request; if you get a 401/302-to-login, raise a
clear error asking the user to re-capture cookies rather than silently retrying.

---

## sites.json — what gets saved

The agent optionally filters cookies before writing the file. This is controlled
by `include_cookies` in `sites.json`.

### Bundled config location

`extension/sites.json` in the repo (also copied to `~/.cookie-monster/agent/sites.json`
by `install.ps1`).

### User override location

`%USERPROFILE%\.cookie-monster\sites.json`

This file is optional. If it exists, the agent **deep-merges** it over the bundled
config: top-level hostname keys are merged, and per-host objects are shallowly
merged (user keys win).

### Config structure

```json
{
  "acme.service-now.com": {
    "label": "ServiceNow",
    "health_cookies": ["JSESSIONID", "glide_session_store", "glide_user_route"],
    "include_cookies": ["JSESSIONID", "glide_session_store", "glide_user_route",
                        "BIGipServerpool_acme", "glide_user_theme"]
  }
}
```

| Field | Type | Effect |
|-------|------|--------|
| `label` | string | Display name in the extension popup only; no effect on saved files |
| `health_cookies` | string[] | Cookie names shown as ✓/✗ chips in the popup; no effect on saved files |
| `include_cookies` | string[] | **If non-empty:** only these cookies are written to the `.env` file. If empty or absent: all cookies are written. |

### Implication for consumers

If `include_cookies` is configured, the `.env` file will only contain the listed
cookies — even if the browser has more. If your API call needs a cookie that isn't
in the file, either add it to `include_cookies` or set `include_cookies: []` to
save all cookies.

### Adding a new site (without touching the repo)

Create `%USERPROFILE%\.cookie-monster\sites.json`:

```json
{
  "my-internal-app.company.com": {
    "label": "My App",
    "health_cookies": ["session_id"],
    "include_cookies": []
  }
}
```

No reinstall needed — the agent reads this file fresh on every invocation.
