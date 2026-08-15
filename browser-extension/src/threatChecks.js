const HIBP_API = 'https://api.pwnedpasswords.com/range/';
const SAFE_BROWSING_API = 'https://safebrowsing.googleapis.com/v5/hashes:search';
const MAX_THREAT_AGE_MS = 30 * 60 * 1000;

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  if (typeof btoa !== 'undefined') return btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

function normalizePath(pathname) {
  const segments = [];
  for (const seg of pathname.split('/')) {
    if (seg === '..') {
      if (segments.length) segments.pop();
    } else if (seg !== '.' && seg !== '') {
      segments.push(seg);
    }
  }
  return '/' + segments.join('/');
}

function canonicalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    let port = url.port;
    if ((url.protocol === 'http:' && port === '80') || (url.protocol === 'https:' && port === '443')) {
      port = '';
    }
    const host = url.hostname.toLowerCase();
    return `${url.protocol}//${host}${port ? ':' + port : ''}${normalizePath(url.pathname)}${url.search}`;
  } catch (e) {
    return rawUrl;
  }
}

async function urlHashPrefix(url) {
  const canonical = canonicalizeUrl(url);
  const hex = await sha256Hex(canonical);
  const bytes = hexToBytes(hex);
  return { canonical, prefixB64: bytesToBase64(bytes.subarray(0, 4)), fullB64: bytesToBase64(bytes) };
}

function parseExpireTime(raw, now) {
  const serverExpiry = raw ? Date.parse(raw) : NaN;
  const capExpiry = now + MAX_THREAT_AGE_MS;
  if (!Number.isFinite(serverExpiry)) return capExpiry;
  return Math.min(serverExpiry, capExpiry);
}

async function runSafeBrowsingCheck({ url, apiKey, fetchFn, now }) {
  if (!apiKey) return { status: 'not_configured' };
  try {
    const { prefixB64, fullB64 } = await urlHashPrefix(url);
    const resp = await fetchFn(`${SAFE_BROWSING_API}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashPrefixes: [prefixB64] })
    });
    if (!resp.ok) return { status: 'unknown', reason: `HTTP ${resp.status}` };
    const data = await resp.json();
    const hashes = Array.isArray(data.hashes) ? data.hashes : [];
    for (const entry of hashes) {
      if (entry.fullHash === fullB64) {
        const expiresAt = parseExpireTime(entry.expireTime, now);
        if (expiresAt <= now) return { status: 'unknown', reason: 'stale threat data' };
        return {
          status: 'unsafe',
          threatType: entry.hashList || 'malware',
          expiresAt
        };
      }
    }
    return { status: 'safe', expiresAt: now + MAX_THREAT_AGE_MS };
  } catch (e) {
    return { status: 'unknown', reason: e.message };
  }
}

async function sha1Hex(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

async function runHibpCheck({ password, fetchFn }) {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const resp = await fetchFn(`${HIBP_API}${prefix}`);
    const text = await resp.text();
    const lines = text.trim().split('\n');
    for (const line of lines) {
      const [suf, count] = line.split(':');
      if (suf === suffix) return { pwned: true, count: parseInt(count, 10) };
    }
    return { pwned: false, count: 0 };
  } catch (e) {
    return { error: e.message };
  }
}

async function runSafeBrowsingCheck() {
  return { status: 'not_configured' };
}

async function runThreatChecks({ password, url, config, fetchFn, now }) {
  if (config.privacyMode === true) {
    return {
      privacyMode: true,
      hibp: { error: 'Disabled by Privacy Mode' },
      safeBrowsing: { status: 'disabled', reason: 'Privacy Mode' }
    };
  }

  const checks = { privacyMode: false };
  checks.hibp = config.hibpEnabled === false
    ? { error: 'HIBP checks disabled' }
    : await runHibpCheck({ password, fetchFn });
  checks.safeBrowsing = config.safeBrowsingEnabled === false || !config.safeBrowsingApiKey
    ? { status: 'not_configured' }
    : await runSafeBrowsingCheck({ url, apiKey: config.safeBrowsingApiKey, fetchFn, now });
  return checks;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HIBP_API,
    SAFE_BROWSING_API,
    MAX_THREAT_AGE_MS,
    sha1Hex,
    sha256Hex,
    canonicalizeUrl,
    urlHashPrefix,
    runHibpCheck,
    runSafeBrowsingCheck,
    runThreatChecks
  };
}