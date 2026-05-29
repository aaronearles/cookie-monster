# Cookie-Monster

Browser extension + local agent that captures authenticated session cookies to your
filesystem in one click — so CLI tools, `curl`, scripts, and Claude Code can reuse
your browser session without copy-paste.

## Prerequisites

- Python 3.8+ from [python.org](https://python.org) (not the Microsoft Store stub)
- Chrome 109+ or Firefox 128+
- Windows (WSL supported for consuming files)

## Quickstart

**1. Install the agent** (once per machine; re-run after pulling updates)

```powershell
powershell -ExecutionPolicy Bypass -File agent/install.ps1
```

This copies the agent to a stable location, wires up the Python path, and registers
the native messaging host in the Windows registry for both Chrome and Firefox.

**2. Load the extension**

| Browser | Steps |
|---------|-------|
| Chrome | `chrome://extensions` → Developer mode on → Load unpacked → select the `extension/` folder |
| Firefox | `about:debugging` → This Firefox → Load Temporary Add-on → navigate into `extension/` → select `manifest-firefox.json` |

Chrome extension ID will be `fphbpongnohaamccgpafdbamkibbjnek` (pinned by the key in the manifest).

**3. Capture cookies**

1. Log into a site in your browser
2. Click the Cookie-Monster toolbar icon
3. Click **→ Send to Agent**
4. Cookies land at `%USERPROFILE%\.session-cookies\{hostname}.env`

## Using the captured cookies

The simplest path — copy the relevant client helper into your project:

| Language | File | One-liner |
|----------|------|-----------|
| Python | `client/python.py` | `cookie_header("acme.service-now.com")` |
| Bash / WSL | `client/bash.sh` | `source bash.sh && curl -H "Cookie: $(cm_cookie_header $HOST)" ...` |
| PowerShell | `client/powershell.ps1` | `. .\powershell.ps1; Invoke-RestMethod -Headers @{Cookie = Get-CookieHeader $HOST} ...` |

For direct parsing (no helper needed) see [CONSUMING.md](CONSUMING.md).

## Architecture

The agent runs **on demand** — there is no background daemon or scheduled task.

```
Click "Send to Agent" in the popup
  │
  ▼
Extension calls chrome.runtime.sendNativeMessage('com.cookiemonster.agent', payload)
  │
  ▼
Browser looks up 'com.cookiemonster.agent' in the Windows registry
  HKCU\Software\Google\Chrome\NativeMessagingHosts\  (Chrome)
  HKCU\Software\Mozilla\NativeMessagingHosts\        (Firefox)
  │
  ▼
Registry entry points to ~/.cookie-monster/agent/manifest-{browser}.json
  │
  ▼
Browser spawns agent.bat as a subprocess with stdin/stdout connected
  (agent.bat was rewritten by install.ps1 to use the full python.exe path
   because browsers run native hosts without a PATH environment)
  │
  ▼
agent.py reads one JSON message from stdin (4-byte LE length prefix + UTF-8 body)
Applies include_cookies filter from sites.json
Writes ~/.session-cookies/{hostname}.env atomically (write .tmp → rename)
Writes JSON response to stdout, then exits
  │
  ▼
Extension receives {ok: true, path: "...", count: N}
Button shows "✓ Saved N cookies"
```

Every click spawns and kills a fresh Python process. There is nothing to crash,
restart, or leak between sessions.

## Site configuration

`extension/sites.json` controls the health chips shown in the popup and optionally
filters which cookies are saved per hostname:

```json
{
  "acme.service-now.com": {
    "label": "ServiceNow",
    "health_cookies": ["JSESSIONID", "glide_session_store", "glide_user_route"],
    "include_cookies": []
  }
}
```

| Field | Purpose |
|-------|---------|
| `label` | Display name shown in the popup header |
| `health_cookies` | Cookie names shown as ✓/✗ chips — indicates session health |
| `include_cookies` | Allowlist of cookie names to write to disk; empty array means save all |

**Adding your own sites without touching the repo:** create
`%USERPROFILE%\.cookie-monster\sites.json` with the same structure. The agent
deep-merges it over the bundled config at runtime — your entries win on any key
conflict. The extension uses the bundled config for the popup UI; the agent uses
the merged result for filtering.

After editing `extension/sites.json`, re-run `install.ps1` to sync the copy the
agent reads.

## Files written to your machine

| Path | Purpose |
|------|---------|
| `%USERPROFILE%\.session-cookies\{hostname}.env` | Cookie store (one file per host) |
| `%USERPROFILE%\.cookie-monster\agent\` | Installed agent (copied from repo) |
| `%USERPROFILE%\.cookie-monster\sites.json` | Your local site config overrides (optional) |

The session-cookies directory is excluded from OneDrive sync at install time.
Never commit its contents — these are live session credentials.
