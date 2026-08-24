import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(repoRoot, 'browser-extension');
const source = path.join(extensionRoot, 'dist', 'chromium');
const version = JSON.parse(await readFile(path.join(extensionRoot, 'package.json'), 'utf8')).version;
const artifacts = path.join(repoRoot, 'dist', 'extension');
await mkdir(artifacts, { recursive: true });

async function list(dir) {
  const result = [];
  for (const name of (await readdir(dir)).sort()) { const file = path.join(dir, name); (await stat(file)).isDirectory() ? result.push(...await list(file)) : result.push(file); }
  return result;
}
const zip = new AdmZip();
const fixedTime = new Date('1980-01-01T00:00:00.000Z');
for (const file of await list(source)) {
  const name = path.relative(source, file).replaceAll(path.sep, '/');
  zip.addFile(name, await readFile(file));
  zip.getEntry(name).header.time = fixedTime;
}
const archive = path.join(artifacts, `soterios-extension-${version}.zip`);
zip.writeZip(archive);
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`, 'utf8');
console.log(`${archive}\nSHA-256 ${digest}`);
