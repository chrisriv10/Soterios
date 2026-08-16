import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const keyDirectory = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || process.cwd(), 'Soterios', 'signing');
const privateKeyPath = path.join(keyDirectory, 'threat-feed-ed25519.pem');
const publicKeyPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'browser-extension', 'src', 'feed-public-key.json');
let publicKey;
if (existsSync(privateKeyPath)) {
  publicKey = createPublicKey(createPrivateKey(await readFile(privateKeyPath)));
} else {
  const generated = generateKeyPairSync('ed25519');
  publicKey = generated.publicKey;
  await mkdir(keyDirectory, { recursive: true });
  await writeFile(privateKeyPath, generated.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const spkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
await writeFile(publicKeyPath, `${JSON.stringify({ algorithm: 'Ed25519', spkiBase64 }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ privateKeyPath, spkiBase64 }));
