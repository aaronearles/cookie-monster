// CookieSnapper - popup.js
// Captures cookies for the current tab and formats them as a Cookie header string.

'use strict';

// ── Known session-critical cookie name patterns ──────────────────────────────
const KEY_COOKIE_PATTERNS = [
  /^JSESSIONID$/i,
  /^glide_session_store$/i,
  /^glide_user_route$/i,
  /^BIGipServer/i,
  /^CookieConsentPolicy$/i,
  /^AWSALB/i,
  /^ARRAffinity/i,
  /^ai_session$/i,
  /^ai_user$/i,
  /^__Host-/i,
  /^__Secure-/i,
  /^_saml_/i,
  /^esxsession$/i,
  /^sn_/i,
  /^glide_/i,
  /^XSRF-TOKEN$/i,
  /^csrf/i,
];

// ── State ────────────────────────────────────────────────────────────────────
let currentCookies = [];
let currentDomain = '';
let currentHeaderString = '';
let listOpen = false;
let siteConfig = {};

// ── Helpers ──────────────────────────────────────────────────────────────────
function isKeyCookie(name) {
  return KEY_COOKIE_PATTERNS.some(p => p.test(name));
}

function formatTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildCookieHeaderString(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function truncate(str, max = 36) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Main render ──────────────────────────────────────────────────────────────
function renderContent(cookies, domain) {
  currentCookies = cookies;
  currentDomain = domain;
  currentHeaderString = buildCookieHeaderString(cookies);

  $('loading').style.display = 'none';
  $('error-state').style.display = 'none';
  $('content').style.display = 'block';

  // Domain bar
  $('domain-text').textContent = domain;
  $('cookie-count').textContent = `${cookies.length} cookie${cookies.length !== 1 ? 's' : ''}`;

  // Status dot
  const keysFound = cookies.filter(c => isKeyCookie(c.name));
  const dot = $('status-dot');
  if (keysFound.length > 0) {
    dot.className = 'status-dot live';
  } else if (cookies.length > 0) {
    dot.className = 'status-dot warn';
  } else {
    dot.className = 'status-dot';
  }

  // Health chips
  renderHealthBar(cookies, domain);

  // Cookie header box — syntax-highlight key names
  const box = $('cookie-header-box');
  const parts = cookies.map(c => {
    const isKey = isKeyCookie(c.name);
    const nameHtml = isKey
      ? `<span class="cookie-key-name">${escHtml(c.name)}</span>`
      : escHtml(c.name);
    return `${nameHtml}=${escHtml(c.value)}`;
  });
  box.innerHTML = parts.join('; ');

  // Toggle label
  $('toggle-label').textContent = `Show all cookies (${cookies.length})`;

  // Cookie rows
  renderCookieList(cookies);

  // Timestamp
  $('timestamp').textContent = formatTimestamp();
}

function renderCookieList(cookies) {
  const list = $('cookie-list');
  list.innerHTML = '';

  // Sort: key cookies first, then alphabetical
  const sorted = [...cookies].sort((a, b) => {
    const ak = isKeyCookie(a.name) ? 0 : 1;
    const bk = isKeyCookie(b.name) ? 0 : 1;
    if (ak !== bk) return ak - bk;
    return a.name.localeCompare(b.name);
  });

  sorted.forEach(c => {
    const row = document.createElement('div');
    const isKey = isKeyCookie(c.name);
    row.className = 'cookie-row' + (isKey ? ' key-cookie' : '');

    const nameEl = document.createElement('span');
    nameEl.className = 'cookie-row-name';
    nameEl.textContent = c.name;
    nameEl.title = c.name;

    const valEl = document.createElement('span');
    valEl.className = 'cookie-row-value';
    valEl.textContent = truncate(c.value, 30);
    valEl.title = c.value;

    row.appendChild(nameEl);
    row.appendChild(valEl);

    if (isKey) {
      const badge = document.createElement('span');
      badge.className = 'key-badge';
      badge.textContent = 'session';
      row.appendChild(badge);
    }

    // Click row to copy just that cookie
    row.addEventListener('click', () => {
      copyToClipboard(`${c.name}=${c.value}`);
      const orig = row.style.background;
      row.style.background = 'rgba(74,222,128,0.1)';
      setTimeout(() => { row.style.background = orig; }, 600);
    });

    list.appendChild(row);
  });
}

function showError(title, msg) {
  $('loading').style.display = 'none';
  $('content').style.display = 'none';
  $('error-state').style.display = 'block';
  $('error-title').textContent = title;
  $('error-msg').textContent = msg;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Clipboard ────────────────────────────────────────────────────────────────
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for MV3 popup context
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

function flashBtn(btn, successText, duration = 1400) {
  const orig = btn.textContent;
  btn.textContent = successText;
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('copied');
  }, duration);
}

function flashBox() {
  const box = $('cookie-header-box');
  box.classList.add('flash');
  setTimeout(() => box.classList.remove('flash'), 700);
}

// ── Health bar ───────────────────────────────────────────────────────────────
function renderHealthBar(cookies, domain) {
  const healthBar = $('health-bar');
  healthBar.innerHTML = '';

  const domainConf = siteConfig[domain];
  let checks;

  if (domainConf?.health_cookies?.length) {
    checks = domainConf.health_cookies.map(name => ({
      label: name,
      found: cookies.some(c => c.name === name),
    }));
  } else {
    // No site config — show only key cookies that are actually present, no phantom missing chips
    checks = cookies
      .filter(c => isKeyCookie(c.name))
      .map(c => ({ label: c.name, found: true }));
  }

  checks.forEach(({ label, found }) => {
    const chip = document.createElement('div');
    chip.className = 'health-chip ' + (found ? 'found' : 'missing');
    chip.textContent = truncate(label, 22);
    chip.title = label;
    healthBar.appendChild(chip);
  });
}

// ── Native agent ─────────────────────────────────────────────────────────────
function getAgentConfig() {
  try {
    chrome.runtime.sendNativeMessage('com.cookiemonster.agent', { action: 'get_config' }, resp => {
      if (chrome.runtime.lastError || !resp?.sites) return;
      siteConfig = resp.sites;
      if (currentDomain && currentCookies.length > 0 && $('content').style.display !== 'none') {
        renderHealthBar(currentCookies, currentDomain);
      }
    });
  } catch (e) {
    // Agent not installed — hardcoded health chips still work
  }
}

function sendToAgent() {
  const btn = $('agent-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('sending');
  btn.textContent = '⏳ Sending…';

  const payload = {
    host: currentDomain,
    cookies: Object.fromEntries(currentCookies.map(c => [c.name, c.value])),
    captured_at: new Date().toISOString(),
  };

  chrome.runtime.sendNativeMessage('com.cookiemonster.agent', payload, resp => {
    btn.classList.remove('sending');
    if (chrome.runtime.lastError || !resp?.ok) {
      const msg = chrome.runtime.lastError?.message || resp?.error || 'Unknown error';
      btn.classList.add('error');
      btn.textContent = '✗ ' + msg.slice(0, 28);
      setTimeout(() => {
        btn.classList.remove('error');
        btn.textContent = '→ Send to Agent';
        btn.disabled = false;
      }, 3000);
    } else {
      btn.classList.add('sent');
      btn.textContent = `✓ Saved ${resp.count} cookie${resp.count !== 1 ? 's' : ''}`;
      setTimeout(() => {
        btn.classList.remove('sent');
        btn.textContent = '→ Send to Agent';
        btn.disabled = false;
      }, 2000);
    }
  });
}

// ── Fetch cookies for current tab ────────────────────────────────────────────
async function fetchCookies() {
  $('loading').style.display = 'block';
  $('content').style.display = 'none';
  $('error-state').style.display = 'none';

  let tab;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  } catch (e) {
    showError('Permission error', 'Could not access the current tab.');
    return;
  }

  if (!tab || !tab.url) {
    showError('No active tab', 'Open a web page first, then click the extension icon.');
    return;
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    showError('Invalid URL', 'This page cannot be inspected.');
    return;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    showError('Not a web page', 'CookieSnapper only works on http:// and https:// pages.');
    return;
  }

  const domain = url.hostname;

  try {
    // Get all cookies for this URL (respects path + secure flags correctly)
    const cookies = await chrome.cookies.getAll({ url: tab.url });

    if (cookies.length === 0) {
      showError(
        'No cookies found',
        `${domain} has no cookies set in this browser profile. Make sure you're logged in.`
      );
      return;
    }

    renderContent(cookies, domain);

    // Save to history
    saveToHistory(domain, cookies, tab.url);
  } catch (e) {
    showError('Error reading cookies', e.message || 'Unknown error.');
  }
}

// ── History ──────────────────────────────────────────────────────────────────
const MAX_HISTORY = 10;

async function saveToHistory(domain, cookies, url) {
  const entry = {
    domain,
    url,
    cookieCount: cookies.length,
    headerString: buildCookieHeaderString(cookies),
    keyCookies: cookies.filter(c => isKeyCookie(c.name)).map(c => c.name),
    capturedAt: new Date().toISOString(),
  };

  const result = await chrome.storage.local.get('history');
  const history = result.history || [];

  // Remove old entry for same domain if exists
  const filtered = history.filter(h => h.domain !== domain);
  filtered.unshift(entry);

  await chrome.storage.local.set({ history: filtered.slice(0, MAX_HISTORY) });
}

async function loadHistory() {
  const result = await chrome.storage.local.get('history');
  return result.history || [];
}

async function renderHistory() {
  const history = await loadHistory();
  const list = $('history-list');
  list.innerHTML = '';

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No captures yet. Visit a page and click the extension icon.';
    list.appendChild(empty);
    return;
  }

  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const domainEl = document.createElement('div');
    domainEl.className = 'history-domain';
    domainEl.textContent = entry.domain;

    const meta = document.createElement('div');
    meta.className = 'history-meta';

    const time = document.createElement('span');
    const d = new Date(entry.capturedAt);
    time.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const count = document.createElement('span');
    count.textContent = `${entry.cookieCount} cookies`;

    const keys = document.createElement('span');
    keys.textContent = entry.keyCookies.length > 0
      ? `✓ ${entry.keyCookies.slice(0, 2).join(', ')}${entry.keyCookies.length > 2 ? '…' : ''}`
      : '— no session keys';
    keys.style.color = entry.keyCookies.length > 0 ? '#4ade80' : '#f87171';

    meta.append(time, count, keys);
    item.append(domainEl, meta);

    item.addEventListener('click', async () => {
      await copyToClipboard(entry.headerString);
      const orig = item.style.background;
      item.style.background = 'rgba(74,222,128,0.08)';
      setTimeout(() => { item.style.background = orig; }, 800);
    });

    list.appendChild(item);
  });
}

// ── Event listeners ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetchCookies();
  getAgentConfig();

  // Copy full header
  $('copy-btn').addEventListener('click', async () => {
    if (!currentHeaderString) return;
    const full = `Cookie: ${currentHeaderString}`;
    await copyToClipboard(full);
    flashBtn($('copy-btn'), '✓ Copied!');
    flashBox();
  });

  // Copy as curl flag
  $('copy-curl-btn').addEventListener('click', async () => {
    if (!currentHeaderString) return;
    await copyToClipboard(`-H "Cookie: ${currentHeaderString}"`);
    flashBtn($('copy-curl-btn'), '✓ curl');
  });

  // Copy as .env line
  $('copy-env-btn').addEventListener('click', async () => {
    if (!currentHeaderString) return;
    const envKey = currentDomain.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
    await copyToClipboard(`${envKey}_COOKIES="${currentHeaderString}"`);
    flashBtn($('copy-env-btn'), '✓ .env');
  });

  // Send to Agent
  $('agent-btn').addEventListener('click', () => {
    if (currentDomain) sendToAgent();
  });

  // Toggle cookie list
  $('toggle-list').addEventListener('click', () => {
    listOpen = !listOpen;
    $('cookie-list').classList.toggle('open', listOpen);
    $('toggle-arrow').classList.toggle('open', listOpen);
    $('toggle-label').textContent = listOpen
      ? `Hide cookies (${currentCookies.length})`
      : `Show all cookies (${currentCookies.length})`;
  });

  // Refresh
  $('refresh-btn').addEventListener('click', () => {
    const btn = $('refresh-btn');
    btn.classList.add('spinning');
    setTimeout(() => btn.classList.remove('spinning'), 500);
    fetchCookies();
  });

  // History
  $('history-btn').addEventListener('click', () => {
    $('main-view').style.display = 'none';
    $('history-view').style.display = 'block';
    renderHistory();
  });

  $('back-btn').addEventListener('click', () => {
    $('history-view').style.display = 'none';
    $('main-view').style.display = 'block';
  });

  $('clear-history-btn').addEventListener('click', async () => {
    await chrome.storage.local.set({ history: [] });
    renderHistory();
  });
});
