'use strict';

// Hardened ZIP extractor for the ClamAV download path (Dependabot #51).
//
// Trust model: the production archive is SHA-256 pinned before extraction,
// but the parser still treats the archive as hostile input: every Buffer read
// is bounds-checked, central/local metadata disagreements are rejected, and
// decompression is capped by ACTUAL output length (not attacker metadata).
//
// Windows TOCTOU limitation: Node on Windows has no O_NOFOLLOW, so the
// lstat-then-open sequence cannot atomically exclude a same-user attacker
// that already has write access to the random staging directory. Protection
// rests on the unpredictable mkdtemp name, inherited directory ACLs,
// per-component lstat/reparse checks, and O_EXCL creation — not on POSIX
// mode bits (chmod 0700 is a no-op for privacy on Windows).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let pathSafety = null;
try {
  pathSafety = require('../src/core/pathSafety');
} catch (_) {
  pathSafety = null;
}

const MAX_FILES = 10000;
const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024;
const MAX_SINGLE_FILE = 512 * 1024 * 1024;
const MAX_PATH_SEGMENTS = 128;

// NTFS alternate-data-stream separator and drive-relative forms (e.g. `C:foo`)
// are never valid inside this archive; `:` is rejected per path segment.
const WINDOWS_RESERVED_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

function isWindowsReservedName(part) {
  return WINDOWS_RESERVED_RE.test(part);
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function isInside(candidate, root) {
  const child = path.resolve(candidate);
  const parent = path.resolve(root);
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

function isSymlinkOrReparse(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
  if (st.isSymbolicLink()) return true;
  if (process.platform === 'win32') {
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
      const cur = path.resolve(p);
      const realResolved = path.resolve(real);
      if (cur.toLowerCase() !== realResolved.toLowerCase()) {
        if (pathSafety && typeof pathSafety.isWindowsShortNameAliasPath === 'function') {
          if (pathSafety.isWindowsShortNameAliasPath(cur, realResolved)) return false;
        }
        return true;
      }
    } catch (err) {
      if (err && err.message && err.message.startsWith('Refusing')) throw err;
    }
  }
  return false;
}

function assertNoSymlinkOrReparse(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`Refusing to follow symlink at ${p}`);
  }
  if (process.platform === 'win32' && st.isDirectory()) {
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
      const cur = path.resolve(p);
      const realResolved = path.resolve(real);
      if (cur.toLowerCase() !== realResolved.toLowerCase()) {
        let isAlias = false;
        if (pathSafety && typeof pathSafety.isWindowsShortNameAliasPath === 'function') {
          try {
            isAlias = pathSafety.isWindowsShortNameAliasPath(cur, realResolved);
          } catch (_) {
            isAlias = false;
          }
        }
        if (!isAlias) {
          throw new Error(`Refusing to follow reparse point at ${p}`);
        }
      }
    } catch (err) {
      if (err && err.message && err.message.startsWith('Refusing')) throw err;
    }
  }
}

function assertSafeRoot(rootDir) {
  const resolved = path.resolve(rootDir);
  let st;
  try {
    st = fs.lstatSync(resolved);
  } catch (err) {
    throw new Error(`Extraction root does not exist: ${resolved}: ${err.message}`);
  }
  if (st.isSymbolicLink()) {
    throw new Error(`Extraction root is a symlink: ${resolved}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Extraction root is not a directory: ${resolved}`);
  }
  assertNoSymlinkOrReparse(resolved);
}

function sanitizeEntryName(rawName, externalAttr) {
  if (typeof rawName !== 'string' || rawName.length === 0) {
    throw new Error('Rejecting empty archive entry name');
  }
  if (rawName.includes('\0')) {
    throw new Error('Rejecting entry with null byte');
  }
  const mode = (externalAttr >>> 16) & 0o170000;
  if (mode === 0o120000) {
    throw new Error(`Rejecting symlink entry: ${rawName}`);
  }
  const normalized = rawName.replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    throw new Error(`Rejecting absolute entry: ${rawName}`);
  }
  if (/^[a-zA-Z]:(\/|$)/.test(normalized)) {
    throw new Error(`Rejecting drive-letter entry: ${rawName}`);
  }
  if (path.isAbsolute(normalized) || path.win32.isAbsolute(rawName)) {
    throw new Error(`Rejecting absolute entry: ${rawName}`);
  }
  const isDir = normalized.endsWith('/');
  const trimmed = isDir ? normalized.slice(0, -1) : normalized;
  if (trimmed.length === 0) {
    throw new Error(`Rejecting empty entry: ${rawName}`);
  }
  const parts = trimmed.split('/');
  if (parts.length > MAX_PATH_SEGMENTS) {
    throw new Error(`Rejecting overly deep entry: ${rawName}`);
  }
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      throw new Error(`Rejecting traversal entry: ${rawName}`);
    }
    if (part.includes('\0')) {
      throw new Error(`Rejecting entry with null byte: ${rawName}`);
    }
    if (part.includes(':')) {
      throw new Error(`Rejecting ADS/drive-relative entry: ${rawName}`);
    }
    if (part.endsWith('.') || part.endsWith(' ')) {
      throw new Error(`Rejecting trailing-dot/space entry: ${rawName}`);
    }
    if (isWindowsReservedName(part)) {
      throw new Error(`Rejecting reserved device name: ${rawName}`);
    }
  }
  return { parts, isDir };
}

function ensureDirSecurely(rootDir, relParts) {
  let cur = path.resolve(rootDir);
  assertNoSymlinkOrReparse(cur);
  for (const part of relParts) {
    if (!part || part === '.' || part === '..' || part.includes('/') || part.includes('\\') || part.includes('\0')) {
      throw new Error(`Invalid path segment: ${part}`);
    }
    cur = path.join(cur, part);
    if (!isInside(cur, rootDir)) {
      throw new Error(`Path escapes extraction root: ${cur}`);
    }
    let st = null;
    try {
      st = fs.lstatSync(cur);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    if (!st) {
      fs.mkdirSync(cur);
      const created = fs.lstatSync(cur);
      if (created.isSymbolicLink()) {
        throw new Error(`Refusing to follow symlink at ${cur}`);
      }
      if (!created.isDirectory()) {
        throw new Error(`Not a directory after create: ${cur}`);
      }
      continue;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing to follow symlink at ${cur}`);
    }
    if (!st.isDirectory()) {
      throw new Error(`Path component is not a directory: ${cur}`);
    }
    assertNoSymlinkOrReparse(cur);
  }
  return cur;
}

function writeFileSecurely(destPath, data, rootDir) {
  if (!isInside(destPath, rootDir)) {
    throw new Error(`Path escapes extraction root: ${destPath}`);
  }
  const parent = path.dirname(destPath);
  const parentRel = path.relative(path.resolve(rootDir), path.resolve(parent));
  const parentParts = parentRel === '' ? [] : parentRel.split(path.sep);
  ensureDirSecurely(rootDir, parentParts);
  assertNoSymlinkOrReparse(parent);

  let st = null;
  try {
    st = fs.lstatSync(destPath);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  if (st) {
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlink: ${destPath}`);
    }
    throw new Error(`Refusing to overwrite existing path: ${destPath}`);
  }
  const O_WRONLY = fs.constants.O_WRONLY;
  const O_CREAT = fs.constants.O_CREAT;
  const O_EXCL = fs.constants.O_EXCL;
  const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
  const flags = O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW;
  let fd;
  try {
    fd = fs.openSync(destPath, flags, 0o644);
  } catch (err) {
    if (err && (err.code === 'EEXIST' || err.code === 'ELOOP')) {
      throw new Error(`Refusing to overwrite existing/symlink path: ${destPath}: ${err.message}`);
    }
    throw err;
  }
  try {
    if (data.length > 0) {
      fs.writeSync(fd, data, 0, data.length, 0);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function findEocd(buffer) {
  if (buffer.length < 22) {
    throw new Error('Invalid zip: too small for end-of-central-directory');
  }
  const maxComment = 0xffff;
  const searchStart = Math.max(0, buffer.length - 22 - maxComment);
  for (let i = buffer.length - 22; i >= searchStart; i -= 1) {
    if (buffer.readUInt32LE(i) !== SIG_EOCD) continue;
    const commentLen = buffer.readUInt16LE(i + 20);
    if (i + 22 + commentLen !== buffer.length) continue;
    return i;
  }
  throw new Error('Invalid zip: end-of-central-directory not found');
}

function parseCentralDirectory(buffer, maxFiles = MAX_FILES) {
  const eocd = findEocd(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const cdDisk = buffer.readUInt16LE(eocd + 6);
  const entriesThisDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || cdDisk !== 0) {
    throw new Error('Multi-disk zip archives are not supported');
  }
  if (entriesThisDisk !== totalEntries) {
    throw new Error('Mismatched central directory entry counts');
  }
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('Zip64 archives are not supported');
  }
  if (totalEntries > maxFiles) {
    throw new Error(`Too many entries: ${totalEntries}`);
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new Error('Central directory extends past end of file');
  }
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (p + 46 > buffer.length) {
      throw new Error('Truncated central directory entry');
    }
    if (buffer.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`Bad central directory signature at entry ${i}`);
    }
    const flags = buffer.readUInt16LE(p + 8);
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const uncompSize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const externalAttr = buffer.readUInt32LE(p + 38);
    const localOffset = buffer.readUInt32LE(p + 42);
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('Zip64 archives are not supported');
    }
    if (p + 46 + nameLen + extraLen + commentLen > buffer.length) {
      throw new Error('Truncated central directory entry name');
    }
    const nameBuf = buffer.subarray(p + 46, p + 46 + nameLen);
    const useUtf8 = (flags & 0x0800) !== 0;
    const name = useUtf8 ? nameBuf.toString('utf8') : nameBuf.toString('utf8');
    entries.push({ name, flags, method, compSize, uncompSize, externalAttr, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateRawLimited(comp, limit, label) {
  // Real output cap: Node enforces maxOutputLength during inflation
  // (ERR_BUFFER_TOO_LARGE), so a lying central-directory size cannot cause
  // unbounded allocation before the length check below.
  try {
    return zlib.inflateRawSync(comp, { maxOutputLength: limit });
  } catch (err) {
    if (err && (err.code === 'ERR_BUFFER_TOO_LARGE' || /larger than .* bytes/.test(err.message || ''))) {
      throw new Error(`Entry exceeds single-file limit: ${label}`);
    }
    throw new Error(`Decompression failed for ${label}: ${err.message}`);
  }
}

function readEntryData(buffer, entry, maxSingleFile = MAX_SINGLE_FILE) {
  if ((entry.flags & 0x01) !== 0) {
    throw new Error(`Encrypted entry not supported: ${entry.name}`);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
  }
  if (entry.uncompSize > maxSingleFile) {
    throw new Error(`Entry too large: ${entry.name}`);
  }
  if (entry.compSize > buffer.length) {
    throw new Error(`Compressed size out of range for ${entry.name}`);
  }
  const off = entry.localOffset;
  if (off + 30 > buffer.length) {
    throw new Error(`Truncated local header for ${entry.name}`);
  }
  if (buffer.readUInt32LE(off) !== SIG_LOCAL) {
    throw new Error(`Bad local header signature for ${entry.name}`);
  }
  const localFlags = buffer.readUInt16LE(off + 6);
  const localMethod = buffer.readUInt16LE(off + 8);
  const nameLen = buffer.readUInt16LE(off + 26);
  const extraLen = buffer.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  if (dataStart + entry.compSize > buffer.length) {
    throw new Error(`Truncated entry data for ${entry.name}`);
  }
  // Central/local consistency: the local header must describe the same entry.
  // A mismatch means the data range cannot be trusted, so reject outright.
  const localName = buffer.subarray(off + 30, off + 30 + nameLen).toString('utf8');
  if (localName !== entry.name) {
    throw new Error(`Central/local filename mismatch for ${entry.name}`);
  }
  if (localMethod !== entry.method) {
    throw new Error(`Central/local method mismatch for ${entry.name}`);
  }
  if (((localFlags & 0x01) !== 0) !== ((entry.flags & 0x01) !== 0)) {
    throw new Error(`Central/local encryption mismatch for ${entry.name}`);
  }
  if ((localFlags & 0x08) === 0) {
    const localComp = buffer.readUInt32LE(off + 18);
    const localUncomp = buffer.readUInt32LE(off + 22);
    if (localComp !== entry.compSize || localUncomp !== entry.uncompSize) {
      throw new Error(`Central/local size mismatch for ${entry.name}`);
    }
  }
  const comp = buffer.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) {
    const out = Buffer.from(comp);
    if (out.length !== entry.uncompSize) {
      throw new Error(`Size mismatch for ${entry.name}`);
    }
    return out;
  }
  const inflated = inflateRawLimited(comp, maxSingleFile, entry.name);
  if (inflated.length !== entry.uncompSize) {
    throw new Error(`Size mismatch for ${entry.name}`);
  }
  return inflated;
}

function extractZipSecurely(zipPath, destDir, options = {}) {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxSingleFile = options.maxSingleFile ?? MAX_SINGLE_FILE;
  const maxTotal = options.maxTotal ?? MAX_TOTAL_UNCOMPRESSED;
  assertSafeRoot(destDir);
  const resolvedDest = path.resolve(destDir);
  // Avoid reading an absurdly large file into memory at all: the compressed
  // archive cannot legitimately exceed the total uncompressed budget.
  const zipStat = fs.statSync(zipPath);
  if (zipStat.size > maxTotal) {
    throw new Error('Archive file too large');
  }
  const buffer = fs.readFileSync(zipPath);
  const entries = parseCentralDirectory(buffer, maxFiles);
  // Case-insensitive collision map: on Windows `A/file` and `a/file` (or
  // `file` vs `FILE`) alias the same object, so a second entry must fail
  // closed instead of overwriting or merging.
  const seenLower = new Set();
  let totalActual = 0;
  let extractedFiles = 0;
  let extractedDirs = 0;
  for (const entry of entries) {
    const { parts, isDir } = sanitizeEntryName(entry.name, entry.externalAttr);
    const destPath = path.join(resolvedDest, ...parts);
    if (!isInside(destPath, resolvedDest)) {
      throw new Error(`Path escapes extraction root: ${entry.name}`);
    }
    const collisionKey = parts.join('/').toLowerCase();
    if (seenLower.has(collisionKey)) {
      throw new Error(`Colliding archive entry: ${entry.name}`);
    }
    seenLower.add(collisionKey);
    if (isDir) {
      ensureDirSecurely(resolvedDest, parts);
      extractedDirs += 1;
      continue;
    }
    const data = readEntryData(buffer, entry, maxSingleFile);
    totalActual += data.length;
    if (totalActual > maxTotal) {
      throw new Error('Archive exceeds total size limit');
    }
    writeFileSecurely(destPath, data, resolvedDest);
    extractedFiles += 1;
  }
  return { files: extractedFiles, dirs: extractedDirs, entries: entries.length };
}

module.exports = {
  extractZipSecurely,
  sanitizeEntryName,
  ensureDirSecurely,
  writeFileSecurely,
  assertNoSymlinkOrReparse,
  isSymlinkOrReparse,
  isInside,
  isWindowsReservedName,
  inflateRawLimited,
  parseCentralDirectory,
  MAX_FILES,
  MAX_TOTAL_UNCOMPRESSED,
  MAX_SINGLE_FILE,
  MAX_PATH_SEGMENTS,
};
