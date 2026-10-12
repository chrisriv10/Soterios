'use strict';

// Validates that dist/latest.yml produced by the Windows NSIS build actually
// corresponds to the installer that will be published: same version as
// package.json, same filename, same byte size, same SHA-512, plus the
// blockmap electron-updater needs for differential downloads.
//
// This is intentionally a small purpose-built parser for the exact schema
// electron-builder emits (top-level scalars plus a `files:` list), not a
// generic YAML library: anything outside that shape fails closed so a
// builder output change forces a human revisit instead of a silent pass.
//
// Usage: node tools/verify-release-updater-metadata.js [distDir]
// Exit 0 with a summary line on success; throws (exit 1) on any mismatch.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOP_LEVEL_KEYS = new Set(['version', 'files', 'path', 'sha512', 'releaseDate', 'releaseNotes']);
const FILE_ENTRY_KEYS = new Set(['url', 'sha512', 'size']);

function unquote(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

// Parses only: top-level `key: scalar` pairs plus one `files:` list whose
// items are `- ` followed by indented `key: scalar` pairs. Anything else
// (tabs, deeper nesting, unexpected keys, duplicate keys) throws.
function parseLatestYml(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('latest.yml is empty.');
  const result = {};
  const files = [];
  let currentItem = null;
  let inFiles = false;
  const seenTop = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    if (/^\t/.test(rawLine)) throw new Error('latest.yml uses unsupported tab indentation.');
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    if (indent === 0) {
      inFiles = false;
      currentItem = null;
      const match = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
      if (!match) throw new Error(`latest.yml has an unsupported top-level line: ${line.slice(0, 60)}`);
      const key = match[1];
      const rest = match[2].trim();
      if (!TOP_LEVEL_KEYS.has(key)) throw new Error(`latest.yml has an unexpected top-level key: ${key}`);
      if (seenTop.has(key)) throw new Error(`latest.yml repeats top-level key: ${key}`);
      seenTop.add(key);
      if (key === 'files') {
        if (rest !== '') throw new Error('latest.yml files entry must be a list.');
        inFiles = true;
        continue;
      }
      result[key] = unquote(rest);
    } else {
      if (!inFiles) throw new Error(`latest.yml has an unexpected indented line: ${line.slice(0, 60)}`);
      // List items start at two spaces (`- key: value`); continuation keys
      // sit at four spaces, matching electron-builder output exactly.
      if (indent !== 2 && indent !== 4) throw new Error('latest.yml files entries must use two/four-space indentation.');
      if (indent === 2 && !line.startsWith('- ')) {
        throw new Error(`latest.yml has an unexpected indented line: ${line.slice(0, 60)}`);
      }
      if (indent === 2) {
        if (!line.startsWith('- ')) {
          throw new Error(`latest.yml has an unexpected indented line: ${line.slice(0, 60)}`);
        }
        currentItem = {};
        files.push(currentItem);
        var rest = line.slice(2).trim();
        if (rest !== '') {
          const match = rest.match(/^([A-Za-z0-9_-]+):(.*)$/);
          if (!match || !FILE_ENTRY_KEYS.has(match[1])) throw new Error(`latest.yml has an unsupported file entry: ${rest.slice(0, 60)}`);
          if (match[1] in currentItem) throw new Error(`latest.yml repeats file key: ${match[1]}`);
          currentItem[match[1]] = unquote(match[2].trim());
        }
      } else if (indent === 4) {
        if (!currentItem || line.startsWith('- ')) throw new Error(`latest.yml has a file property outside a list item: ${line.slice(0, 60)}`);
        const match = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
        if (!match || !FILE_ENTRY_KEYS.has(match[1])) throw new Error(`latest.yml has an unsupported file key: ${line.slice(0, 60)}`);
        if (match[1] in currentItem) throw new Error(`latest.yml repeats file key: ${match[1]}`);
        currentItem[match[1]] = unquote(match[2].trim());
      } else {
        throw new Error(`latest.yml has an unexpected indented line: ${line.slice(0, 60)}`);
      }
    }
  }
  result.files = files;
  return result;
}

function sha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function verifyReleaseUpdaterMetadata({ distDir, packageVersion } = {}) {
  if (!distDir || typeof distDir !== 'string') throw new Error('A dist directory is required.');
  if (!packageVersion || typeof packageVersion !== 'string') throw new Error('A package version is required.');
  const manifestPath = path.join(distDir, 'latest.yml');
  let text;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    throw new Error(`latest.yml is missing from ${distDir}; the release would ship without updater metadata.`);
  }
  const manifest = parseLatestYml(text);
  for (const key of ['version', 'path', 'sha512']) {
    if (typeof manifest[key] !== 'string' || !manifest[key]) {
      throw new Error(`latest.yml is missing required field: ${key}.`);
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('latest.yml lists no installer files.');
  }
  if (manifest.version !== packageVersion) {
    throw new Error(`latest.yml version ${manifest.version} does not match package version ${packageVersion}.`);
  }
  if (manifest.path !== manifest.files[0].url || manifest.sha512 !== manifest.files[0].sha512) {
    throw new Error('latest.yml top-level path/sha512 does not match its files entry.');
  }
  const verified = [];
  for (const entry of manifest.files) {
    for (const key of ['url', 'sha512', 'size']) {
      if (typeof entry[key] !== 'string' || !entry[key]) {
        throw new Error('latest.yml has a files entry missing url, sha512, or size.');
      }
    }
    if (entry.url.includes('/') || entry.url.includes('\\')) {
      throw new Error(`latest.yml references a non-local installer path: ${entry.url}.`);
    }
    const installerPath = path.join(distDir, entry.url);
    let stat;
    try {
      stat = fs.statSync(installerPath);
    } catch (_) {
      throw new Error(`latest.yml references a missing installer: ${entry.url}.`);
    }
    if (!stat.isFile()) throw new Error(`latest.yml references a non-file installer: ${entry.url}.`);
    if (String(stat.size) !== String(Number(entry.size))) {
      throw new Error(`latest.yml size ${entry.size} does not match ${entry.url} (${stat.size} bytes).`);
    }
    const actualHash = sha512Base64(installerPath);
    if (actualHash !== entry.sha512) {
      throw new Error(`latest.yml sha512 does not match ${entry.url}.`);
    }
    const blockmapPath = `${installerPath}.blockmap`;
    let blockmapStat = null;
    try {
      blockmapStat = fs.statSync(blockmapPath);
    } catch (_) {}
    if (!blockmapStat || !blockmapStat.isFile()) {
      throw new Error(`Required blockmap is missing for ${entry.url}; differential updates need it.`);
    }
    verified.push({ file: entry.url, size: stat.size });
  }
  return { ok: true, version: manifest.version, files: verified };
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const distDir = path.resolve(process.argv[2] || path.join(repoRoot, 'dist'));
  const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  const result = verifyReleaseUpdaterMetadata({ distDir, packageVersion });
  console.log(`Release updater metadata OK: version ${result.version}, ${result.files.map((f) => `${f.file} (${f.size} bytes)`).join(', ')}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

module.exports = { verifyReleaseUpdaterMetadata, parseLatestYml };
