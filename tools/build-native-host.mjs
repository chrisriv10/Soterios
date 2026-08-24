import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') { console.log('Native host SEA build is Windows-only; skipping on this platform.'); process.exit(0); }
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'build', 'native-host');
const bundle = path.join(outputDir, 'host.cjs');
const blob = path.join(outputDir, 'sea-prep.blob');
const executable = path.join(outputDir, 'SoteriosNativeHost.exe');
const config = path.join(outputDir, 'sea-config.json');

async function stripAuthenticodeDirectory(filePath) {
  const image = await readFile(filePath);
  if (image.length < 512 || image.toString('ascii', 0, 2) !== 'MZ') throw new Error('Native-host base executable is not a valid PE image.');
  const peOffset = image.readUInt32LE(0x3c);
  if (peOffset + 24 >= image.length || image.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') throw new Error('Native-host base executable has an invalid PE header.');
  const optionalHeader = peOffset + 24;
  const magic = image.readUInt16LE(optionalHeader);
  const dataDirectory = optionalHeader + (magic === 0x20b ? 112 : (magic === 0x10b ? 96 : 0));
  if (!dataDirectory || dataDirectory + 40 > image.length) throw new Error('Native-host base executable has an unsupported optional header.');
  const certificateEntry = dataDirectory + (8 * 4);
  if (image.readUInt32LE(certificateEntry) || image.readUInt32LE(certificateEntry + 4)) {
    image.writeUInt32LE(0, certificateEntry);
    image.writeUInt32LE(0, certificateEntry + 4);
    await writeFile(filePath, image);
  }
}

async function readSizeAfterInjection(filePath) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { return (await readFile(filePath)).byteLength; } catch (error) {
      lastError = error;
      if (error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

await rm(outputDir, { recursive: true, force: true }); await mkdir(outputDir, { recursive: true });
await build({ entryPoints: [path.join(repoRoot, 'src', 'native-host', 'host.js')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node22', legalComments: 'none', minify: true, sourcemap: false });
await writeFile(config, `${JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2)}\n`);
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
await copyFile(process.execPath, executable);
// Windows Node binaries are Authenticode-signed. SEA injection must remove the
// copied image's certificate directory first; the packaged app signs the final
// executable later in the normal release pipeline.
await stripAuthenticodeDirectory(executable);
execFileSync(process.execPath, [path.join(repoRoot, 'node_modules', 'postject', 'dist', 'cli.js'), executable, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { stdio: 'inherit' });
const size = await readSizeAfterInjection(executable);
const injected = await readFile(executable);
if (!injected.includes(Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1'))) throw new Error('SEA injection did not activate the Node fuse.');
console.log(`Built standalone native host (${Math.round(size / 1024 / 1024)} MiB): ${executable}`);
