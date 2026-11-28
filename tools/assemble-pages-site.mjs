import { copyFile, lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function copyRootFile(sourceDir, siteDir, filename) {
  const sourcePath = path.join(sourceDir, filename);
  let sourceStat;
  try {
    sourceStat = await lstat(sourcePath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Pages source must be a regular file: ${filename}`);
  }
  await copyFile(sourcePath, path.join(siteDir, filename));
  return true;
}

async function copyRegularTree(sourceDir, siteDir) {
  let sourceStat;
  try {
    sourceStat = await lstat(sourceDir);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`Pages asset source must be a directory: ${sourceDir}`);
  }
  await mkdir(siteDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(siteDir, entry.name);
    const entryStat = await lstat(from);
    if (entryStat.isSymbolicLink()) throw new Error(`Pages assets cannot contain symlinks: ${from}`);
    if (entryStat.isDirectory()) await copyRegularTree(from, to);
    else if (entryStat.isFile()) await copyFile(from, to);
    else throw new Error(`Pages assets must be regular files and directories: ${from}`);
  }
  return true;
}

export async function assemblePagesSite({ sourceDir, siteDir }) {
  if (!sourceDir || !siteDir) throw new TypeError('sourceDir and siteDir are required.');
  const source = path.resolve(sourceDir);
  const site = path.resolve(siteDir);
  await mkdir(site, { recursive: true });

  for (const filename of ['index.html', 'site.css', 'site.js']) {
    await copyRootFile(source, site, filename);
  }
  const hasNoJekyll = await copyRootFile(source, site, '.nojekyll');
  if (!hasNoJekyll) await writeFile(path.join(site, '.nojekyll'), '');

  const rootAssets = path.join(source, 'assets');
  const outputAssets = path.join(site, 'assets');
  await mkdir(outputAssets, { recursive: true });
  for (const filename of ['brand-logo.png', 'soteriosTextLogo.png']) {
    await copyRootFile(rootAssets, outputAssets, filename);
  }
  await copyRegularTree(path.join(rootAssets, 'site'), path.join(outputAssets, 'site'));
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} requires a path.`);
  return process.argv[index + 1];
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const sourceDir = path.resolve(readArgument('--source'));
  const siteDir = path.resolve(readArgument('--site'));
  if (!sourceDir.startsWith(`${repoRoot}${path.sep}`) && sourceDir !== repoRoot) {
    throw new Error('Pages source must be inside the checked-out repository.');
  }
  if (!siteDir.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error('Pages output must be inside the checked-out repository.');
  }
  await assemblePagesSite({ sourceDir, siteDir });
}
