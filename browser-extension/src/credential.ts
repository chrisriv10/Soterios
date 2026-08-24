import { HMAC_SECRET_KEY } from './settings';
import { registrableDomain } from './domains';

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  guessesLog10: number;
  suggestions: string[];
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function sha1Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))));
}

export async function checkHibpPassword(
  password: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<{ found: boolean; count: number }> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), 8000);
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET',
      headers: { 'Add-Padding': 'true', 'User-Agent': 'Soterios-Browser-Extension/2' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (result.status === 429) throw Object.assign(new Error('HIBP rate limit reached'), { code: 'RATE_LIMITED' });
    if (!result.ok) throw new Error(`HIBP returned HTTP ${result.status}`);
    const body = await result.text();
    if (body.length > 2_000_000) throw new Error('HIBP response exceeded the size limit');
    let count = 0;
    for (const line of body.split(/\r?\n/)) {
      const match = /^([0-9A-F]{35}):(\d+)$/.exec(line.trim().toUpperCase());
      if (!match) continue;
      const parsed = Number(match[2]);
      if (parsed > 0 && match[1] === suffix) count = parsed;
    }
    return { found: count > 0, count };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function analyzePassword(password: string): StrengthResult {
  if (!password) return { score: 0, label: 'Very weak', guessesLog10: 0, suggestions: ['Use at least 14 characters.'] };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length;
  let alphabet = classes === 1 ? 26 : classes === 2 ? 52 : classes === 3 ? 62 : 94;
  let entropy = password.length * Math.log2(alphabet);
  const lower = password.toLowerCase();
  if (/(.)\1{2,}/.test(password)) entropy -= 18;
  if (/1234|qwerty|password|letmein|admin|welcome/.test(lower)) entropy -= 35;
  if (/^(?:[a-z]+|\d+)$/.test(lower)) entropy -= 10;
  entropy = Math.max(0, entropy);
  const score = (entropy >= 90 ? 4 : entropy >= 65 ? 3 : entropy >= 45 ? 2 : entropy >= 28 ? 1 : 0) as StrengthResult['score'];
  const labels: StrengthResult['label'][] = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  const suggestions: string[] = [];
  if (password.length < 14) suggestions.push('Use at least 14 characters.');
  if (classes < 3) suggestions.push('Mix words or character types to increase variety.');
  if (/(.)\1{2,}/.test(password) || /1234|qwerty|password|letmein|admin|welcome/.test(lower)) {
    suggestions.push('Avoid common patterns and repeated characters.');
  }
  if (!suggestions.length) suggestions.push('Keep this password unique to one account.');
  return { score, label: labels[score], guessesLog10: Math.round((entropy / Math.log2(10)) * 10) / 10, suggestions };
}

const WORDS = [
  'amber', 'anchor', 'apricot', 'badger', 'bamboo', 'beacon', 'birch', 'breeze',
  'canyon', 'cedar', 'cobalt', 'coral', 'cosmos', 'dahlia', 'delta', 'ember',
  'falcon', 'fern', 'fjord', 'galaxy', 'garden', 'glacier', 'harbor', 'hazel',
  'island', 'juniper', 'lagoon', 'lantern', 'lilac', 'lotus', 'maple', 'meadow',
  'meteor', 'mint', 'nebula', 'oasis', 'ocean', 'olive', 'orchid', 'otter',
  'pebble', 'pine', 'quartz', 'raven', 'reef', 'river', 'saffron', 'sage',
  'spruce', 'summit', 'thistle', 'tundra', 'velvet', 'willow', 'zephyr', 'zinnia'
];

function secureIndex(max: number): number {
  if (max < 2) return 0;
  const ceiling = Math.floor(0x100000000 / max) * max;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= ceiling);
  return value[0] % max;
}

export function generateCredential(options: { mode?: 'password' | 'passphrase'; length?: number; words?: number; separator?: string } = {}): string {
  if (options.mode === 'passphrase') {
    const count = Math.min(10, Math.max(4, options.words || 5));
    const separator = typeof options.separator === 'string' && options.separator.length <= 3 ? options.separator : '-';
    return Array.from({ length: count }, () => WORDS[secureIndex(WORDS.length)]).join(separator);
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=';
  const length = Math.min(128, Math.max(16, options.length || 20));
  return Array.from({ length }, () => alphabet[secureIndex(alphabet.length)]).join('');
}

async function getHmacKey(): Promise<CryptoKey> {
  const stored = await chrome.storage.local.get(HMAC_SECRET_KEY);
  let encoded = stored[HMAC_SECRET_KEY] as string | undefined;
  if (!encoded) {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    encoded = btoa(String.fromCharCode(...secret));
    await chrome.storage.local.set({ [HMAC_SECRET_KEY]: encoded });
  }
  const raw = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function credentialReuseToken(password: string): Promise<string> {
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(password));
  return bytesToHex(new Uint8Array(signature));
}

export async function checkAndRememberReuse(password: string, hostname: string): Promise<{ reused: boolean; domains: string[] }> {
  const token = await credentialReuseToken(password);
  const domain = registrableDomain(hostname);
  const storageKey = `reuse:${token}`;
  const stored = await chrome.storage.local.get(storageKey);
  const prior = Array.isArray(stored[storageKey]) ? stored[storageKey].filter((value: unknown) => typeof value === 'string') : [];
  const domains = Array.from(new Set([...prior, domain])).slice(-20);
  await chrome.storage.local.set({ [storageKey]: domains });
  return { reused: prior.some((value: string) => value !== domain), domains: prior.filter((value: string) => value !== domain) };
}
