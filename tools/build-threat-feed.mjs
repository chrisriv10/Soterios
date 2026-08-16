import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ''; }
const certPlPath = argument('--certpl'); const urlHausPath = argument('--urlhaus'); const outputDir = path.resolve(argument('--output') || 'public/threat-feed');
if (!certPlPath || !urlHausPath) throw new Error('Usage: build-threat-feed --certpl <domains.txt> --urlhaus <json> --output <directory>');

function canonicalUrl(value) {
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) return null; const host = url.hostname.toLowerCase().replace(/^\.+|\.+$/g, ''); const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'; return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${pathname}`; } catch (_) { return null; }
}
function tokenFor(value) { const canonical = canonicalUrl(value); return canonical ? createHash('sha256').update(canonical).digest('hex').slice(0, 32) : null; }
function domainTokenFor(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!domain || domain.length > 253 || domain.includes('/') || domain.includes(':')) return null;
  try {
    const normalized = new URL(`https://${domain}`).hostname.toLowerCase();
    if (normalized !== domain || !normalized.includes('.')) return null;
    return createHash('sha256').update(`domain:${normalized}`).digest('hex').slice(0, 32);
  } catch (_) { return null; }
}
function asArray(value) { if (Array.isArray(value)) return value; if (Array.isArray(value?.urls)) return value.urls; if (Array.isArray(value?.response)) return value.response; return []; }

const certPlDomains = (await readFile(certPlPath, 'utf8')).split(/\r?\n/); const urlHaus = JSON.parse(await readFile(urlHausPath, 'utf8'));
const indicators = new Map();
for (const domain of certPlDomains) { const token = domainTokenFor(domain); if (token) indicators.set(token, 'phishing'); }
for (const item of asArray(urlHaus)) {
  const status = String(item.url_status || item.status || '').toLowerCase(); if (status && !['online', 'active'].includes(status)) continue;
  const token = tokenFor(item.url); if (token && !indicators.has(token)) indicators.set(token, 'malware');
}
if (indicators.size > 5_000_000) throw new Error('Indicator limit exceeded');

const shards = new Map();
for (const [token, category] of [...indicators].sort(([a], [b]) => a.localeCompare(b))) { const id = token.slice(0, 2); if (!shards.has(id)) shards.set(id, {}); shards.get(id)[token] = category; }
await rm(outputDir, { recursive: true, force: true }); await mkdir(path.join(outputDir, 'shards'), { recursive: true });
const descriptors = [];
for (const [id, tokens] of [...shards].sort(([a], [b]) => a.localeCompare(b))) {
  const body = `${JSON.stringify({ schema: 1, id, tokens })}\n`; const file = `shards/${id}.json`; await writeFile(path.join(outputDir, file), body, 'utf8');
  descriptors.push({ id, file, sha256: createHash('sha256').update(body).digest('hex'), count: Object.keys(tokens).length });
}
const now = new Date(); const manifest = { schema: 1, version: Math.floor(now.getTime() / 1000), generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString(), shards: descriptors };
const privateValue = String(process.env.THREAT_FEED_PRIVATE_KEY || '').replace(/\\n/g, '\n'); if (!privateValue) throw new Error('THREAT_FEED_PRIVATE_KEY is required; unsigned feeds are never emitted.');
const payload = Buffer.from(JSON.stringify(manifest)); manifest.signature = sign(null, payload, createPrivateKey(privateValue)).toString('base64');
await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(path.join(outputDir, 'ATTRIBUTION.txt'), 'Phishing indicators: CERT Polska / CSIRT NASK Dangerous Websites Warning List (active domains, https://cert.pl/en/warning-list/).\nMalware indicators: abuse.ch URLhaus Community API (active entries).\nRedistribution and use remain subject to each provider’s current terms and fair-use requirements.\n', 'utf8');
console.log(`Signed feed ${manifest.version}: ${indicators.size} indicators in ${descriptors.length} shards.`);
