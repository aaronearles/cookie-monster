# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Cookie-Monster

Browser extension + local agent that pushes session cookies to the filesystem
so CLI tools, curl, and Claude Code can use them without copy-paste.

## Source of truth

`spec.md` — read this first. It covers architecture, file format, the two-layer
site config merge, extension ID stability, and the client contract.

## Development commands

**No build step.** The extension is plain HTML/JS with no npm dependencies.
`agent.py` uses only Python stdlib (3.8+).

**Load extension (Chrome)**
1. `chrome://extensions/` → enable Developer mode
2. "Load unpacked" → select the `extension/` directory
3. Confirm the ID shows as `fphbpongnohaamccgpafdbamkibbjnek`

**Load extension (Firefox)**
1. `about:debugging` → "This Firefox" → "Load Temporary Add-on"
2. Navigate into the `extension/` directory and select `manifest-firefox.json`

**Install agent**
```powershell
powershell -ExecutionPolicy Bypass -File agent/install.ps1
```
Copies files to `%USERPROFILE%\.cookie-monster\agent\`, registers the native host in
the Windows registry (Chrome) and `%APPDATA%\Mozilla\NativeMessagingHosts\` (Firefox),
and creates the `%USERPROFILE%\.session-cookies\` store directory.

**Test agent standalone** (bypasses the browser)
```bash
# Push cookies
echo '{"host":"example.com","cookies":{"JSESSIONID":"abc123"},"captured_at":"2026-05-28T00:00:00Z"}' \
  | python agent/agent.py

# Get config
echo '{"action":"get_config"}' | python agent/agent.py
```
Note: stdin/stdout must carry the 4-byte length-prefix framing that native messaging requires.
Use the test harness in `spec.md § Testing` for accurate simulation.

**Verify agent registration (Chrome)**
```powershell
Get-ItemProperty "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.cookiemonster.agent"
```

## Architecture

```
Browser extension (popup.js)
  → chrome.runtime.sendNativeMessage('com.cookiemonster.agent', payload)
  → agent.bat (Windows launcher, rewrites python path at install time)
  → agent.py (native messaging host)
  → %USERPROFILE%\.session-cookies\{hostname}  (atomic write: .tmp → rename)

Client helpers (client/python.py, bash.sh, powershell.ps1)
  → read store file → parse KEY=VALUE → format Cookie header
```

**Native messaging protocol:** 4-byte little-endian length prefix + UTF-8 JSON body on
stdin/stdout. Agent routes on the `"action"` field:
- `"get_config"` → returns merged sites config (extension uses this for health chips)
- `"push"` (or presence of `"host"`) → filters cookies, writes store file, returns `{ok, path, count}`

**Two-layer site config merge:** `agent.py` deep-merges the bundled
`agent/sites.json` with the user override at `%USERPROFILE%\.cookie-monster\sites.json`
at runtime. `extension/sites.json` and `agent/sites.json` must be kept in sync — the
extension copy drives the popup UI before the agent responds; the agent copy is the
authoritative source for filtering.

## Lineage

The extension (`extension/`) evolved from `cookie-snapper` (internal repo). The popup UI, cookie capture logic, health chip
system, and history panel are all carried forward. New additions are:
- `nativeMessaging` permission + "Send to Agent" button
- `sites.json` site config (two-layer merge via agent)
- Split Chrome / Firefox manifests

## Key constants

| Thing | Value |
|-------|-------|
| Native messaging host name | `com.cookiemonster.agent` |
| Firefox gecko.id | `cookie-monster@cookiemonster.com` |
| Chrome extension ID | `fphbpongnohaamccgpafdbamkibbjnek` — derived from `cookie-monster.pem` (project root, gitignored; public key embedded in manifest.json `key` field) |
| Cookie store (Windows) | `%USERPROFILE%\.session-cookies\{hostname}.env` |
| Cookie store (WSL) | `/mnt/c/Users/{user}/.session-cookies/{hostname}.env` |
| User override config | `%USERPROFILE%\.cookie-monster\sites.json` |

## File format

```
# host: example.com
# captured: 2026-05-28T14:23:11Z
# count: 3
JSESSIONID=abc123
glide_session_store=def456
glide_user_route=ghi789
```

One `KEY=VALUE` line per cookie. `#` lines are comments. First `=` is the delimiter
(values may contain `=`). No quoting. UTF-8, LF endings.

## What's implemented vs pending

| File | Status |
|------|--------|
| `extension/popup.js` | Complete — "Send to Agent" button, native messaging, `get_config` on open |
| `extension/background.js` | Complete |
| `extension/manifest.json` | Complete — unified manifest, Chrome `key` + Firefox `browser_specific_settings` coexist |
| `extension/sites.json` | Present — generic base config, add sites as needed |
| `agent/agent.py` | Complete |
| `agent/agent.bat` | Complete — `install.ps1` rewrites python path at install time |
| `agent/install.ps1` | Complete — Chrome extension ID set |
| `client/python.py` | Present — ready to copy into consumer projects |
| `client/bash.sh` | Present — ready to source |
| `client/powershell.ps1` | Present — ready to dot-source |

## Next build steps

1. Run `agent/install.ps1` once per machine
2. Load `extension/` unpacked in Chrome — ID will be `fphbpongnohaamccgpafdbamkibbjnek`
3. Test end-to-end: visit a site → click extension → Send to Agent → verify `~/.session-cookies/{hostname}`
