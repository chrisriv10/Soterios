'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  'Windows',
  '$Recycle.Bin',
  'System Volume Information'
]);

function shouldSkipDir(fullPath, name) {
  if (SKIP_DIRS.has(name)) return true;
  const lower = fullPath.toLowerCase();
  return lower.includes('\\appdata\\local\\packages\\')
    || lower.includes('\\appdata\\local\\microsoft\\windowsapps\\')
    || lower.includes('/.git/')
    || lower.includes('\\.git\\');
}

function normalizeExtensions(exts) {
  if (!exts) return null;
  const list = Array.isArray(exts)
    ? exts
    : String(exts).split(/[,;\s]+/).filter(Boolean);
  if (!list.length) return null;
  return new Set(list.map((e) => {
    const s = String(e).trim().toLowerCase();
    return s.startsWith('.') ? s : `.${s}`;
  }));
}

function hashFile(filePath, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Walk a directory tree, grouping files by size then hashing size-collisions.
 * @param {object} args
 * @param {string} [args.path]
 * @param {string[]} [args.paths]
 * @param {'sha256'|'md5'} [args.algorithm]
 * @param {string[]|string} [args.extensions]
 * @param {number} [args.maxDepth]
 * @param {number} [args.minSizeBytes]
 * @param {Function} [onProgress]
 */
async function findDuplicates(args = {}, onProgress) {
  const roots = args.paths
    || (args.path ? [args.path] : []);
  if (!roots.length) {
    return { success: false, error: 'At least one scan path is required.' };
  }
  const algorithm = args.algorithm === 'md5' ? 'md5' : 'sha256';
  const extensions = normalizeExtensions(args.extensions);
  const maxDepth = Number.isInteger(args.maxDepth) ? args.maxDepth : 12;
  const minSizeBytes = Number(args.minSizeBytes) >= 0 ? Number(args.minSizeBytes) : 1;

  /** @type {Map<number, string[]>} */
  const bySize = new Map();
  let scanned = 0;

  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(fullPath, entry.name)) walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (extensions) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.has(ext)) continue;
      }
      scanned++;
      if (onProgress && scanned % 250 === 0) {
        onProgress({ label: 'Indexing files', count: scanned });
      }
      try {
        const st = fs.statSync(fullPath);
        if (st.size < minSizeBytes) continue;
        const list = bySize.get(st.size) || [];
        list.push(fullPath);
        bySize.set(st.size, list);
      } catch (_) {
        /* locked / unreadable */
      }
    }
  }

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      return { success: false, error: `Path not found: ${root}` };
    }
    walk(root, 0);
  }

  const candidates = [];
  for (const [size, files] of bySize) {
    if (files.length > 1) candidates.push({ size, files });
  }

  /** @type {Map<string, {hash:string, size:number, files:string[]}>} */
  const groups = new Map();
  let hashed = 0;
  const toHash = candidates.reduce((n, c) => n + c.files.length, 0);

  for (const group of candidates) {
    for (const filePath of group.files) {
      try {
        const digest = await hashFile(filePath, algorithm);
        hashed++;
        if (onProgress && (hashed % 20 === 0 || hashed === toHash)) {
          onProgress({ label: 'Hashing candidates', count: hashed, total: toHash });
        }
        const key = `${group.size}:${digest}`;
        const existing = groups.get(key);
        if (existing) existing.files.push(filePath);
        else groups.set(key, { hash: digest, size: group.size, files: [filePath] });
      } catch (_) {
        /* skip unreadable */
      }
    }
  }

  const duplicates = [...groups.values()]
    .filter((g) => g.files.length > 1)
    .map((g) => ({
      hash: g.hash,
      size: g.size,
      count: g.files.length,
      recoverableBytes: g.size * (g.files.length - 1),
      files: g.files
    }))
    .sort((a, b) => b.recoverableBytes - a.recoverableBytes);

  const recoverableBytes = duplicates.reduce((sum, g) => sum + g.recoverableBytes, 0);

  return {
    success: true,
    algorithm,
    roots,
    scannedFiles: scanned,
    candidateFiles: toHash,
    groupCount: duplicates.length,
    recoverableBytes,
    recoverableMB: Math.round((recoverableBytes / (1024 * 1024)) * 10) / 10,
    duplicates
  };
}

/**
 * Delete duplicate copies, keeping one preferred path per hash group.
 * @param {object} args
 * @param {{hash:string, keep:string, delete:string[]}[]} args.groups
 * @param {boolean} [args.confirm]
 */
async function deleteDuplicates(args = {}) {
  if (!args.confirm) {
    return { success: false, error: 'Confirmation required. Pass confirm: true.' };
  }
  const groups = Array.isArray(args.groups) ? args.groups : [];
  if (!groups.length) {
    return { success: false, error: 'No duplicate groups provided.' };
  }

  const deleted = [];
  const errors = [];
  let freedBytes = 0;

  for (const group of groups) {
    const keep = group && group.keep;
    const toDelete = Array.isArray(group.delete) ? group.delete : [];
    if (!keep || !toDelete.length) {
      errors.push({ error: 'Each group needs keep + delete[]' });
      continue;
    }
    for (const filePath of toDelete) {
      if (path.resolve(filePath) === path.resolve(keep)) {
        errors.push({ path: filePath, error: 'Refusing to delete the keep path' });
        continue;
      }
      try {
        const st = fs.statSync(filePath);
        fs.unlinkSync(filePath);
        deleted.push(filePath);
        freedBytes += st.size;
      } catch (e) {
        errors.push({ path: filePath, error: e.message || String(e) });
      }
    }
  }

  return {
    success: errors.length === 0,
    deleted,
    deletedCount: deleted.length,
    freedBytes,
    freedMB: Math.round((freedBytes / (1024 * 1024)) * 10) / 10,
    errors
  };
}

module.exports = [
  {
    id: 'duplicate-file-finder',
    name: 'Duplicate File Finder',
    description: 'Find duplicate files by size then SHA-256/MD5 hash. Filter by extension; report recoverable space.',
    category: 'Maintenance',
    icon: 'fa-copy',
    async run(args = {}, onProgress) {
      return findDuplicates(args, onProgress);
    }
  },
  {
    id: 'duplicate-file-delete',
    name: 'Delete Duplicate Files',
    description: 'Delete selected duplicate copies while keeping one original per hash group.',
    category: 'Maintenance',
    icon: 'fa-trash',
    async run(args = {}) {
      return deleteDuplicates(args);
    }
  }
];

module.exports.helpers = { findDuplicates, deleteDuplicates, hashFile, normalizeExtensions };
