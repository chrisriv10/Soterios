const COMMON_TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp',
  'com.br', 'com.mx', 'com.sg', 'com.tr', 'co.in', 'co.za', 'com.cn', 'com.tw'
]);

export function normalizeHostname(input: string): string {
  return input.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

export function registrableDomain(input: string): string {
  const host = normalizeHostname(input);
  if (!host || host === 'localhost' || isIpLiteral(host)) return host;
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const suffix2 = labels.slice(-2).join('.');
  return COMMON_TWO_LEVEL_SUFFIXES.has(suffix2)
    ? labels.slice(-3).join('.')
    : suffix2;
}

export function isIpLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host.includes(':')) return /^[0-9a-f:]+$/i.test(host);
  const parts = host.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function canonicalSiteToken(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = normalizeHostname(url.hostname);
    const path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${path}`;
  } catch (_) {
    return null;
  }
}
