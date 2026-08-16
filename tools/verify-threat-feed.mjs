import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const feedDir = path.resolve(process.argv[2] || 'public/threat-feed');
const publicKeyFile = path.resolve(process.argv[3] || 'browser-extension/src/feed-public-key.json');
const manifest = JSON.parse(await readFile(path.join(feedDir, 'manifest.json'), 'utf8'));
const pinned = JSON.parse(await readFile(publicKeyFile, 'utf8'));
const unsigned = { schema: manifest.schema, version: manifest.version, generatedAt: manifest.generatedAt, expiresAt: manifest.expiresAt, shards: manifest.shards };
const publicKey = createPublicKey({ key: Buffer.from(pinned.spkiBase64, 'base64'), type: 'spki', format: 'der' });
if (!verify(null, Buffer.from(JSON.stringify(unsigned)), publicKey, Buffer.from(manifest.signature || '', 'base64'))) throw new Error('Threat-feed signature validation failed.');
for (const descriptor of manifest.shards) {
  const body = await readFile(path.join(feedDir, descriptor.file));
  if (createHash('sha256').update(body).digest('hex') !== descriptor.sha256) throw new Error(`Checksum mismatch: ${descriptor.file}`);
  const shard = JSON.parse(body); const entries = Object.entries(shard.tokens || {});
  if (shard.schema !== 1 || shard.id !== descriptor.id || entries.length !== descriptor.count || entries.some(([token, category]) => !/^[0-9a-f]{32}$/.test(token) || !['phishing', 'malware'].includes(category))) throw new Error(`Invalid shard: ${descriptor.file}`);
}
console.log(`Verified signed threat feed ${manifest.version}: ${manifest.shards.length} shards.`);
