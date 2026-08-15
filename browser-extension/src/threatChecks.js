const HIBP_API = 'https://api.pwnedpasswords.com/range/';

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
  module.exports = { HIBP_API, sha1Hex, runHibpCheck, runSafeBrowsingCheck, runThreatChecks };
}