import publicKey from './feed-public-key.json';
import bootstrap from './feed/bootstrap.json';
import { canonicalSiteToken, registrableDomain } from './domains';

export const FEED_ORIGIN = 'https://chrisriv10.github.io';
export const FEED_BASE_URL = `${FEED_ORIGIN}/Soterios/threat-feed`;
const DB_NAME = 'soterios-threat-feed-v2';
const DB_VERSION = 1;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_SHARD_BYTES = 8 * 1024 * 1024;
const MAX_SHARDS = 512;

export interface FeedShard { id: string; file: string; sha256: string; count: number; }
export interface FeedManifest {
  schema: 1;
  version: number;
  generatedAt: string;
  expiresAt: string;
  shards: FeedShard[];
  signature?: string;
  bundled?: boolean;
}

interface StoredShard { id: string; sha256: string; tokens: Record<string, 'phishing' | 'malware'>; }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('shards')) db.createObjectStore('shards', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open threat-feed database'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Threat-feed database operation failed'));
  });
}

async function getMeta(): Promise<FeedManifest> {
  const db = await openDb();
  try {
    const stored = await requestResult(db.transaction('meta').objectStore('meta').get('manifest')) as FeedManifest | undefined;
    return stored || (bootstrap as FeedManifest);
  } finally { db.close(); }
}

async function setManifestAndShards(manifest: FeedManifest, shards: StoredShard[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['meta', 'shards'], 'readwrite');
      transaction.objectStore('meta').put(manifest, 'manifest');
      for (const shard of shards) transaction.objectStore('shards').put(shard);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Unable to commit feed update'));
      transaction.onabort = () => reject(transaction.error || new Error('Feed update was aborted'));
    });
  } finally { db.close(); }
}

function stableManifestPayload(manifest: FeedManifest): Uint8Array<ArrayBuffer> {
  const payload = {
    schema: manifest.schema,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    expiresAt: manifest.expiresAt,
    shards: manifest.shards.map(({ id, file, sha256, count }) => ({ id, file, sha256, count }))
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

export async function verifyFeedManifest(manifest: FeedManifest, spkiBase64 = publicKey.spkiBase64): Promise<boolean> {
  if (!manifest.signature) return false;
  try {
    const key = await crypto.subtle.importKey('spki', decodeBase64(spkiBase64), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, decodeBase64(manifest.signature), stableManifestPayload(manifest));
  } catch (_) { return false; }
}

function validManifestShape(value: unknown): value is FeedManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as FeedManifest;
  if (manifest.schema !== 1 || !Number.isSafeInteger(manifest.version) || manifest.version < 1) return false;
  if (!Array.isArray(manifest.shards) || manifest.shards.length > MAX_SHARDS) return false;
  if (!Number.isFinite(Date.parse(manifest.generatedAt)) || !Number.isFinite(Date.parse(manifest.expiresAt))) return false;
  if (Date.parse(manifest.expiresAt) <= Date.parse(manifest.generatedAt)) return false;
  return manifest.shards.every((shard) => /^[0-9a-f]{2}$/i.test(shard.id)
    && /^[a-zA-Z0-9._/-]{1,180}$/.test(shard.file)
    && /^[0-9a-f]{64}$/i.test(shard.sha256)
    && Number.isSafeInteger(shard.count) && shard.count >= 0 && shard.count <= 5_000_000);
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function parseShard(response: Response, expected: FeedShard): Promise<StoredShard> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SHARD_BYTES) throw new Error(`Feed shard ${expected.id} exceeded the size limit`);
  if (await digestHex(bytes) !== expected.sha256.toLowerCase()) throw new Error(`Feed shard ${expected.id} checksum did not match`);
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as { schema?: number; id?: string; tokens?: Record<string, string> };
  if (raw.schema !== 1 || raw.id !== expected.id || !raw.tokens || typeof raw.tokens !== 'object') throw new Error(`Feed shard ${expected.id} has an invalid schema`);
  const entries = Object.entries(raw.tokens);
  if (entries.length !== expected.count || entries.some(([token, category]) => !/^[0-9a-f]{32}$/i.test(token) || !['phishing', 'malware'].includes(category))) {
    throw new Error(`Feed shard ${expected.id} contains invalid indicators`);
  }
  return { id: expected.id, sha256: expected.sha256, tokens: raw.tokens as StoredShard['tokens'] };
}

export async function updateFeed(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<FeedManifest> {
  const current = await getMeta();
  const response = await fetchImpl(`${FEED_BASE_URL}/manifest.json`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Feed manifest returned HTTP ${response.status}`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) throw new Error('Feed manifest exceeded the size limit');
  const manifest = JSON.parse(text) as FeedManifest;
  if (!validManifestShape(manifest)) throw new Error('Feed manifest schema is invalid');
  if (manifest.version < current.version) throw new Error('Feed manifest rollback was rejected');
  if (!await verifyFeedManifest(manifest)) throw new Error('Feed signature could not be verified');
  if (manifest.version === current.version) return current;
  const priorById = new Map(current.shards.map((shard) => [shard.id, shard]));
  const changed = manifest.shards.filter((shard) => priorById.get(shard.id)?.sha256 !== shard.sha256);
  const shards: StoredShard[] = [];
  for (const descriptor of changed) {
    const shardResponse = await fetchImpl(new URL(descriptor.file, `${FEED_BASE_URL}/`).href, { cache: 'no-store', signal });
    if (!shardResponse.ok) throw new Error(`Feed shard ${descriptor.id} returned HTTP ${shardResponse.status}`);
    shards.push(await parseShard(shardResponse, descriptor));
  }
  await setManifestAndShards(manifest, shards);
  return manifest;
}

export async function threatToken(urlValue: string): Promise<string | null> {
  const canonical = canonicalSiteToken(urlValue);
  if (!canonical) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  return Array.from(digest.slice(0, 16), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function truncatedHash(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function domainThreatTokens(urlValue: string): Promise<string[]> {
  try {
    const url = new URL(urlValue);
    if (!['http:', 'https:'].includes(url.protocol)) return [];
    const labels = url.hostname.toLowerCase().replace(/^\.+|\.+$/g, '').split('.').filter(Boolean);
    if (labels.length < 2) return [];
    const minimumLabels = registrableDomain(url.hostname).split('.').length;
    const candidates: string[] = [];
    for (let offset = 0; labels.length - offset >= minimumLabels; offset += 1) candidates.push(labels.slice(offset).join('.'));
    return Promise.all(candidates.map((domain) => truncatedHash(`domain:${domain}`)));
  } catch (_) { return []; }
}

export async function checkFeed(urlValue: string): Promise<{ category: 'phishing' | 'malware'; version: number; stale: boolean } | null> {
  const urlToken = await threatToken(urlValue);
  const tokens = [...new Set([...(urlToken ? [urlToken] : []), ...await domainThreatTokens(urlValue)])];
  if (!tokens.length) return null;
  const manifest = await getMeta();
  const db = await openDb();
  try {
    const store = db.transaction('shards').objectStore('shards');
    const shardIds = [...new Set(tokens.map((token) => token.slice(0, 2)))];
    const shards = await Promise.all(shardIds.map((id) => requestResult(store.get(id)) as Promise<StoredShard | undefined>));
    const byId = new Map(shards.filter(Boolean).map((shard) => [shard!.id, shard!]));
    const category = tokens.map((token) => byId.get(token.slice(0, 2))?.tokens[token]).find(Boolean);
    return category ? { category, version: manifest.version, stale: Date.parse(manifest.expiresAt) < Date.now() } : null;
  } finally { db.close(); }
}

export async function feedStatus(): Promise<{ version: number; generatedAt: string; expiresAt: string; stale: boolean }> {
  const manifest = await getMeta();
  return { version: manifest.version, generatedAt: manifest.generatedAt, expiresAt: manifest.expiresAt, stale: Date.parse(manifest.expiresAt) < Date.now() };
}
