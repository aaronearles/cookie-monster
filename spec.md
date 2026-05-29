# Cookie-Monster — Project Spec

A browser-extension + local-agent system for zero-friction session cookie management.
Captures authenticated web session cookies and writes them to a standard filesystem
location accessible by CLI tools, curl, and Claude Code — without copy-paste.

---

## Problem

Browser SSO sessions hold valid auth credentials that CLI tools and scripts need,
but extracting them is manual friction: open DevTools, find cookies, copy a long string,
paste into a file in the right format, repeat every 8 hours per site. Tools that depend
on this break silently when sessions expire and the file is stale.

---

## Goals

- One click in the browser extension pushes fresh cookies to the local agent
- Cookies land in a known filesystem location with a stable, simple format
- Any tool (Python, bash, PowerShell, curl, Claude Code) can read cookies without
  bespoke parsing logic
- Works on Windows; same files accessible from WSL via `/mnt/c/`
- No copy-paste, no DevTools, no manual file editing
- Shareable within a team and potentially open-source — no org-specific assumptions

## Non-Goals

- Automatic background push (manual trigger only, v1)
- Cloud/remote agent (local machine only, v1)
- Azure Key Vault sync (future; see Open Questions)
- Replacing a secrets manager for long-lived credentials

---

## Architecture

```
┌──────────────────────────────────────────┐
│  Browser (Chrome or Firefox)             │
│  ┌────────────────────────────────────┐  │
│  │  Cookie-Monster Extension          │  │
│  │                                    │  │
│  │  [site: service-now.com]  ✓ live   │  │
│  │  [Send to Agent]                   │  │
│  └──────────────┬─────────────────────┘  │
└─────────────────┼────────────────────────┘
                  │  Native Messaging API
                  │  (stdin/stdout JSON)
                  ▼
┌──────────────────────────────────────────┐
│  cookie-monster-agent (Python, Windows)  │
│  • Receives { host, cookies: {k:v} }     │
│  • Filters to configured cookie names    │
│  • Writes KEY=VALUE lines to store       │
│  • Returns { ok: true, path, count }     │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  %USERPROFILE%\.session-cookies\         │  ← Windows path
│  /mnt/c/Users/{user}/.session-cookies/  │  ← WSL path (same files)
│                                          │
│  acme.service-now.com               │
│  portal.azure.com                        │
│  dev.azure.com                           │
└──────────────────┬───────────────────────┘
         ┌─────────┼──────────┬────────────┐
         ▼         ▼          ▼            ▼
     Python     bash/curl  PowerShell  Claude Code
     scripts               scripts     (via Bash tool)
```

---

## Components

### 1. Browser Extension

An evolution of CookieSnapper. Most of the existing UI is reused.

**New additions:**
- **"Send to Agent" button** in the popup — triggers native messaging push
- **Site config** (bundled JSON) — per-hostname list of cookie names to include,
  display name, and health check cookies for the status chips
- **Push result feedback** — button flashes green on success, shows error if agent
  not installed or push fails

**Unchanged:**
- Cookie capture logic (already domain-agnostic)
- Health chip UI (KEY_COOKIE_PATTERNS highlighting)
- History panel
- Copy buttons (still useful as fallback)

**Site config** is a two-layer merge — see [Site Configuration](#site-configuration) below.

---

### 2. cookie-monster-agent (Native Messaging Host)

A Python script registered as a native messaging host. Runs on-demand (spawned by the
browser when the extension sends a message, exits when done — no persistent daemon).

**Native messaging host name:** `com.cookiemonster.agent`

Native messaging names may only contain letters, digits, dots, and underscores —
the hyphen in "Cookie-Monster" is replaced with an underscore in the host name only.
All user-facing strings use "Cookie-Monster."

**Responsibilities:**
- Receive JSON payload from extension over stdin
- Apply include_cookies filter if configured
- Write cookie file to the store directory
- Return JSON result over stdout

**Input payload:**
```json
{
  "host": "acme.service-now.com",
  "cookies": {
    "JSESSIONID": "abc123",
    "glide_session_store": "def456",
    "glide_user_route": "ghi789",
    "BIGipServer_SNOW_pool": "jkl012"
  },
  "captured_at": "2026-05-28T14:23:11Z"
}
```

**Output:**
```json
{ "ok": true, "path": "C:\\Users\\{user}\\.session-cookies\\acme.service-now.com.env", "count": 4 }
```

**Registration:**

Chrome — registry key (set once via `install.ps1`):
```
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cookiemonster.agent
  (Default) = C:\Users\{user}\.cookie-monster\agent\manifest-chrome.json
```

Firefox Developer Edition — file at:
```
%APPDATA%\Mozilla\NativeMessagingHosts\com.cookiemonster.agent.json
```

Both point to a native host manifest:
```json
{
  "name": "com.cookiemonster.agent",
  "description": "Cookie-Monster local agent",
  "path": "C:\\Users\\{user}\\.cookie-monster\\agent\\agent.bat",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://{pinned-chrome-extension-id}/",
    "moz-extension://{firefox-gecko-id}/"
  ]
}
```

The `agent.bat` wrapper calls `python agent.py` with a full path so Python doesn't need
to be on PATH in the browser's environment.

---

### 3. Cookie Store (Filesystem)

**Root directory:**
```
%USERPROFILE%\.session-cookies\         Windows
/mnt/c/Users/{user}/.session-cookies/  WSL
```

**One file per hostname.** Filename is the bare hostname, no port, no scheme:
```
acme.service-now.com
portal.azure.com
dev.azure.com
```

---

## Site Configuration

Site config drives two things: the health chip UI in the extension popup, and the
`include_cookies` allowlist applied by the agent before writing.

### Two-layer merge

| Layer | Location | Purpose |
|-------|----------|---------|
| **Base** | `extension/sites.json` (bundled) | Generic defaults; maintained in the repo; no org-specific entries |
| **Override** | `%USERPROFILE%\.cookie-monster\sites.json` | User/org-specific; not in version control; wins on conflict |

The agent performs the merge at runtime and returns the merged config to the extension
via native messaging when the popup opens. This is necessary because browser extensions
cannot read arbitrary filesystem paths — the agent is the bridge.

**Merge rules:**
- Override entries are deep-merged per hostname — you only need to specify the keys
  you want to change, not re-specify the full entry
- Override wins on any key conflict
- Hostnames present only in the override are added (the override can introduce new sites)
- Hostnames present only in the base pass through unchanged

**Example — base `extension/sites.json` (shipped with repo):**
```json
{
  "portal.azure.com": {
    "label": "Azure Portal",
    "health_cookies": ["ESTSAUTH", "ESTSAUTHPERSISTENT"],
    "include_cookies": []
  }
}
```

**Example — `%USERPROFILE%\.cookie-monster\sites.json` (user's local file):**
```json
{
  "acme.service-now.com": {
    "label": "ServiceNow",
    "health_cookies": ["JSESSIONID", "glide_session_store", "glide_user_route"],
    "include_cookies": []
  },
  "portal.azure.com": {
    "label": "Azure Portal (org)",
    "health_cookies": ["ESTSAUTH", "ESTSAUTHPERSISTENT", "x-ms-sso-RefreshTokenExpiry"]
  }
}
```

**Merged result seen by extension and agent:**
```json
{
  "portal.azure.com": {
    "label": "Azure Portal (org)",
    "health_cookies": ["ESTSAUTH", "ESTSAUTHPERSISTENT", "x-ms-sso-RefreshTokenExpiry"],
    "include_cookies": []
  },
  "acme.service-now.com": {
    "label": "ServiceNow",
    "health_cookies": ["JSESSIONID", "glide_session_store", "glide_user_route"],
    "include_cookies": []
  }
}
```

`include_cookies: []` means include all cookies for the domain (recommended default).
A non-empty list acts as an allowlist — only those named cookies are sent to the agent.

The extension falls back to the raw hostname for unconfigured sites — still fully
functional, just without named health chips.

### Config request flow

```
popup opens
    │
    ├─ extension sends { "action": "get_config" } to agent
    │
    ├─ agent reads extension/sites.json (embedded copy) + override file, merges
    │
    └─ agent returns merged config → extension renders health chips + labels
```

The agent also applies the merged config's `include_cookies` filter on every push,
so the UI and the agent are always working from the same merged view.

---

## File Format

```
# host: acme.service-now.com
# captured: 2026-05-28T14:23:11Z
# count: 4
JSESSIONID=abc123def456abc123def456
glide_session_store=xyz789xyz789xyz789
glide_user_route=abcdefabcdef
BIGipServer_SNOW_pool=rd7o00000000000000000000ffff0a4b05e00004
```

**Rules:**
- Lines starting with `#` are comments — metadata only, never parsed as cookies
- All other non-empty lines are `NAME=VALUE`
- Values are raw — no quoting, no escaping, no shell variable wrapping
- Cookie values may contain `=` characters; only the **first** `=` is the delimiter
- File is UTF-8, LF line endings (Python writes this natively; WSL reads it fine)
- Overwritten atomically on each push (write to `.tmp`, rename)

**Why not .env / shell export format:**
The `KEY="value"` shell syntax requires quoting rules, varies by shell, and breaks on
values that contain quotes or special characters. Plain `KEY=VALUE` is simpler, wider
tool support, and unambiguous.

---

## Extension ID Stability

Cookie-Monster is distributed as an unpacked extension (not via Chrome Web Store or
Firefox AMO). Without a pinned identity, every fresh install generates a new random
extension ID, which would break the `allowed_origins` list in the native host manifest.

### Chrome — pinned via `key` field

A key pair is generated once by the project maintainer and the **public key** is
committed to the repo in `extension/manifest-chrome.json` as the `key` field:

```json
{
  "key": "MIIBIjANBgkq...(base64 public key)..."
}
```

Chrome derives the extension ID deterministically from this key. Every team member who
loads the unpacked extension gets the **same extension ID** regardless of machine or
install path. The ID is therefore a stable constant that `install.ps1` can embed into
the native host manifest at registration time.

The private key is **not** committed to the repo — it is only needed if the CRX needs
to be re-signed (not required for unpacked installs).

### Firefox — pinned via `gecko.id`

Already handled by `browser_specific_settings.gecko.id` in the Firefox manifest:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "cookie-monster@cookiemonster.com",
    "strict_min_version": "109.0"
  }
}
```

This ID is stable regardless of where the extension is installed from.

### install.ps1 embeds the IDs

Both IDs are known constants at build time. `install.ps1` writes the native host
manifests with the correct `allowed_origins` values — installers do not need to
discover or prompt for extension IDs.

---

## Client Contract

Tools that consume cookies depend on this interface — it must stay stable.

### Python

```python
from pathlib import Path
import os

def load_session_cookies(host: str) -> dict[str, str]:
    # Works from both Windows Python and WSL Python
    store = Path(os.environ.get("USERPROFILE", "")) / ".session-cookies"
    if not store.exists():  # WSL fallback
        user = os.environ.get("USER", "")
        store = Path(f"/mnt/c/Users/{user}/.session-cookies")
    path = store / (host + '.env')
    cookies = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            k, _, v = line.partition("=")
            cookies[k] = v
    return cookies
```

### bash / curl

```bash
HOST="acme.service-now.com"
STORE="/mnt/c/Users/$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')/.session-cookies"
COOKIE_HEADER=$(grep -v '^#' "$STORE/$HOST.env" | awk -F= '{print $1"="substr($0,index($0,"=")+1)}' | paste -sd'; ')

curl -H "Cookie: $COOKIE_HEADER" https://$HOST/api/now/table/...
```

### PowerShell

```powershell
function Get-SessionCookies([string]$Host) {
    $path = Join-Path $env:USERPROFILE ".session-cookies\$Host.env"
    Get-Content $path |
        Where-Object { $_ -and $_ -notmatch '^#' } |
        ForEach-Object {
            $k, $v = $_ -split '=', 2
            [PSCustomObject]@{ Name = $k; Value = $v }
        }
}

$cookies = (Get-SessionCookies "acme.service-now.com" |
    ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '
```

---

## Security Considerations

- Store directory is `%USERPROFILE%` — user-owned, not world-readable on Windows
- No cookies are transmitted off-machine in v1
- Native messaging is sandboxed to the registered extension ID — other local processes
  cannot trigger the agent via the browser's native messaging pipe
- Cookie files should be treated as session credentials: do not commit, do not sync
  via cloud storage (OneDrive exclusion recommended — see below)
- File content expires naturally when the browser session expires — stale files are
  harmless (requests using them will 401 and prompt re-capture)

**OneDrive exclusion**

`install.ps1` should exclude the store directory from OneDrive sync automatically.
The store sits in `%USERPROFILE%` which is often under OneDrive on corporate machines:

```powershell
# install.ps1 — add exclusion
$store = "$env:USERPROFILE\.session-cookies"
attrib +P $store  # marks folder as not to be synced (OneDrive "pin-to-local" workaround)
```

---

## Project Structure (proposed)

```
cookie-monster/
├── extension/
│   ├── manifest-chrome.json     Includes pinned key field
│   ├── manifest-firefox.json    Includes gecko.id
│   ├── background.js
│   ├── popup.html
│   ├── popup.js
│   ├── sites.json               Per-site config (health cookies, labels)
│   └── icons/
├── agent/
│   ├── agent.py                 Native messaging host script
│   ├── agent.bat                Windows launcher (full path to python)
│   ├── manifest-chrome.json     Native host manifest (allowed_origins baked in)
│   ├── manifest-firefox.json
│   └── install.ps1              One-time setup: registers manifests, creates store dir,
│                                adds OneDrive exclusion
├── client/
│   ├── python.py                load_session_cookies() — copy into any Python project
│   ├── bash.sh                  Bash function + curl example
│   └── powershell.ps1           Get-SessionCookies function
└── spec.md                      This document
```

---

## Open Questions

| Question | Options | Notes |
|----------|---------|-------|
| Auto-push on known domains? | Yes / No / Opt-in per site | v1 = No (manual only) |
| Azure Key Vault sync? | Agent mirrors to AKV after local write | Needs az CLI or SP auth; deferred |
| Multi-profile support? | Sub-directories per browser profile | Needed if user has work + personal Chrome profiles with different sessions |
| Agent language? | Python (fewest new dependencies), Go (single binary, no runtime) | Python simplest for now; Go if distribution becomes a concern |
| sites.json customization? | **Decided:** two-layer merge — base bundled in repo, override at `%USERPROFILE%\.cookie-monster\sites.json` | See [Site Configuration](#site-configuration) |
