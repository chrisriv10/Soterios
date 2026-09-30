import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

// Offline verifier for the signed threat feed. Enforces the same validation
// policy as browser-extension/src/feed.ts (validManifestShape/parseShard)
// plus an explicit trusted rollback baseline. Exit 0 means structurally and
// cryptographically valid; a stale (expired but well-formed) feed still
// exits 0 with an explicit warning, mirroring extension feedStatus().

const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_SHARD_BYTES = 8 * 1024 * 1024;
const MAX_SHARDS = 512;
const MAX_SHARD_COUNT = 5_000_000;
const SHARD_FILE_PATTERN = /^[a-zA-Z0-9._/-]{1,180}$/;

// A shard path must be a safe relative path: forward slashes only, no empty
// segments, no '.'/'..' segments, never absolute, never a drive/UNC/URL
// form. Same semantic rule as the extension's validShardFile().
function isSafeShardFile(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 1 || value.length > 180) return false;
  if (value.startsWith('/')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false;
  if (value.startsWith('\\\\')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  if (!SHARD_FILE_PATTERN.test(value)) return false;
  return !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

// Null when the manifest shape is valid, otherwise a concise reason.
// Mirrors the extension's validManifestShape accept/reject set.
function checkManifestShape(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return 'manifest must be an object';
  if (manifest.schema !== 1) return 'schema must be 1';
  if (!Number.isSafeInteger(manifest.version) || manifest.version < 1) return 'version must be a safe integer >= 1';
  if (!Array.isArray(manifest.shards)) return 'shards must be an array';
  if (manifest.shards.length > MAX_SHARDS) return `shard count exceeds the ${MAX_SHARDS} limit`;
  if (!Number.isFinite(Date.parse(manifest.generatedAt))) return 'generatedAt is not a valid date';
  if (!Number.isFinite(Date.parse(manifest.expiresAt))) return 'expiresAt is not a valid date';
  if (Date.parse(manifest.expiresAt) <= Date.parse(manifest.generatedAt)) return 'expiresAt must be after generatedAt';
  for (const descriptor of manifest.shards) {
    if (!descriptor || typeof descriptor !== 'object') return 'shard descriptor must be an object';
    if (!/^[0-9a-f]{2}$/i.test(descriptor.id)) return `shard id is invalid: ${descriptor.id}`;
    if (!isSafeShardFile(descriptor.file)) return `shard path is unsafe: ${descriptor.file}`;
    if (!/^[0-9a-f]{64}$/i.test(descriptor.sha256)) return `shard sha256 is invalid: ${descriptor.id}`;
    if (!Number.isSafeInteger(descriptor.count) || descriptor.count < 0 || descriptor.count > MAX_SHARD_COUNT) {
      return `shard count is invalid: ${descriptor.id}`;
    }
  }
  return null;
}

// Exact stable payload the extension signs/verifies: projected fields only,
// original order, plain JSON.stringify. Must stay byte-compatible.
function stablePayload(manifest) {
  return Buffer.from(JSON.stringify({
    schema: manifest.schema,
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    expiresAt: manifest.expiresAt,
    shards: manifest.shards.map(({ id, file, sha256, count }) => ({ id, file, sha256, count }))
  }));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const feedDir = path.resolve(process.argv[2] || 'public/threat-feed');
const publicKeyFile = path.resolve(process.argv[3] || 'browser-extension/src/feed-public-key.json');
const currentVersionRaw = argument('--current-version');
let currentVersion = null;
if (currentVersionRaw !== '') {
  if (!/^\d+$/.test(currentVersionRaw)) throw new Error('Threat-feed --current-version must be a safe non-negative integer.');
  currentVersion = Number(currentVersionRaw);
  if (!Number.isSafeInteger(currentVersion)) throw new Error('Threat-feed --current-version must be a safe non-negative integer.');
}

const manifestPath = path.join(feedDir, 'manifest.json');
let manifestBytes;
try {
  const manifestStat = await stat(manifestPath);
  if (manifestStat.size > MAX_MANIFEST_BYTES) throw new Error('Threat-feed manifest exceeded the size limit.');
  manifestBytes = await readFile(manifestPath, 'utf8');
} catch (err) {
  if (err.code === 'ENOENT') throw new Error(`Threat-feed manifest not found: ${manifestPath}`);
  throw err.message && /size limit|not found/.test(err.message) ? err : new Error(`Threat-feed manifest is unreadable: ${err.message || err}`);
}
let manifest;
try {
  manifest = JSON.parse(manifestBytes);
} catch (err) {
  throw new Error(`Threat-feed manifest JSON parse failed: ${err.message}`);
}
const shapeError = checkManifestShape(manifest);
if (shapeError) throw new Error(`Threat-feed manifest schema is invalid: ${shapeError}.`);
if (currentVersion !== null && manifest.version < currentVersion) {
  throw new Error(`Threat-feed manifest rollback was rejected: version ${manifest.version} < trusted ${currentVersion}.`);
}
const pinned = JSON.parse(await readFile(publicKeyFile, 'utf8'));
const publicKey = createPublicKey({ key: Buffer.from(pinned.spkiBase64, 'base64'), type: 'spki', format: 'der' });
if (!verify(null, stablePayload(manifest), publicKey, Buffer.from(manifest.signature || '', 'base64'))) {
  throw new Error('Threat-feed signature validation failed.');
}
const stale = Date.parse(manifest.expiresAt) < Date.now();
if (stale) console.warn(`WARNING: Threat feed is stale; it expired at ${manifest.expiresAt}.`);
for (const descriptor of manifest.shards) {
  // Containment is defense in depth: semantic validation above already
  // rejected unsafe paths, and resolving symlinks before reading stops a
  // linked feed subdirectory from redirecting the read outside feedDir.
  const resolved = path.resolve(feedDir, descriptor.file);
  let real;
  try {
    real = await realpath(resolved);
  } catch (err) {
    throw new Error(`Threat-feed shard is unreadable: ${descriptor.file}`);
  }
  const feedDirReal = await realpath(feedDir);
  const lower = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const relative = path.relative(lower(feedDirReal), lower(real));
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Threat-feed shard path escapes the feed directory: ${descriptor.file}`);
  }
  const shardStat = await stat(resolved);
  if (shardStat.size > MAX_SHARD_BYTES) throw new Error(`Threat-feed shard ${descriptor.id} exceeded the size limit.`);
  const body = await readFile(resolved);
  if (createHash('sha256').update(body).digest('hex') !== descriptor.sha256.toLowerCase()) {
    throw new Error(`Checksum mismatch: ${descriptor.file}`);
  }
  let shard;
  try {
    shard = JSON.parse(body.toString('utf8'));
  } catch (err) {
    throw new Error(`Threat-feed shard ${descriptor.id} JSON parse failed: ${err.message}`);
  }
  if (shard.schema !== 1 || shard.id !== descriptor.id || !shard.tokens || typeof shard.tokens !== 'object') {
    throw new Error(`Threat-feed shard ${descriptor.id} has an invalid schema.`);
  }
  const entries = Object.entries(shard.tokens);
  if (entries.length !== descriptor.count || entries.some(([token, category]) => !/^[0-9a-f]{32}$/i.test(token) || !['phishing', 'malware'].includes(category))) {
    throw new Error(`Threat-feed shard ${descriptor.id} contains invalid indicators.`);
  }
}
console.log(`Verified signed threat feed ${manifest.version}: ${manifest.shards.length} shards.${stale ? ' (stale)' : ''}`);
