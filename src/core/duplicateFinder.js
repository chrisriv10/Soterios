'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  assessMutation,
  defaultMutationRoots,
  hasReparseAncestor,
  isInside,
  isProtectedPath
} = require('./pathSafety');

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MIN_SIZE = 1024 * 1024;
const DEFAULT_MAX_SIZE = Number.POSITIVE_INFINITY;
const SAFE_ROOTS = defaultMutationRoots();
const PROTECTED_PATHS = [];
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'windows', '$recycle.bin', 'system volume information'
]);
const FILE_CATEGORIES = {
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'svg'],
  videos: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'odt'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso']
};

function getFileCategory(ext) {
  const value = String(ext || '').toLowerCase().replace('.', '');
  return Object.entries(FILE_CATEGORIES).find(([, extensions]) => extensions.includes(value))?.[0] || 'other';
}

function isPathInsideDir(filePath, rootDir) {
  return isInside(filePath, rootDir);
}

function isSafePath(filePath) {
  return assessMutation(filePath).ok;
}

function normalizeExtensions(exts) {
  if (!exts) return null;
  const list = exts instanceof Set
    ? [...exts]
    : (Array.isArray(exts) ? exts : String(exts).split(/[,;\s]+/).filter(Boolean));
  if (!list.length) return null;
  return new Set(list.map((entry) => {
    const value = String(entry).trim().toLowerCase();
    return value.startsWith('.') ? value : `.${value}`;
  }));
}

function shouldSkipDir(fullPath, name) {
  const lowerName = String(name || '').toLowerCase();
  if (SKIP_DIRS.has(lowerName) || lowerName.startsWith('.')) return true;
  const normalized = String(fullPath).toLowerCase();
  return normalized.includes('\\appdata\\local\\packages\\')
    || normalized.includes('\\appdata\\local\\microsoft\\windowsapps\\');
}

function calculateHash(filePath, algorithm = 'sha256', onChunk) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
      onChunk?.(chunk.length);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function scanDirectory(dir, options = {}) {
  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    currentDepth = 0,
    minSize = DEFAULT_MIN_SIZE,
    maxSize = DEFAULT_MAX_SIZE,
    extensions = null,
    skipProtected = true,
    onProgress,
    root = dir,
    stats = { indexed: 0, skipped: 0, errors: 0 }
  } = options;
  const results = [];
  if (currentDepth > maxDepth) return results;
  if (hasReparseAncestor(dir, root)) {
    stats.skipped += 1;
    return results;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    stats.errors += 1;
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    try {
      if (entry.isSymbolicLink()) {
        stats.skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldSkipDir(fullPath, entry.name) || (skipProtected && isProtectedPath(fullPath))) {
          stats.skipped += 1;
          continue;
        }
        results.push(...await scanDirectory(fullPath, {
          ...options,
          root,
          currentDepth: currentDepth + 1,
          stats
        }));
        continue;
      }
      if (!entry.isFile()) continue;
      if (extensions && !extensions.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = fs.statSync(fullPath);
      if (stat.size < minSize || stat.size > maxSize) continue;
      stats.indexed += 1;
      results.push({ path: fullPath, size: stat.size, modified: stat.mtime.toISOString() });
      if (stats.indexed === 1 || stats.indexed % 25 === 0) {
        onProgress?.({
          phase: 'indexing', label: 'Indexing files', count: stats.indexed,
          currentActivity: fullPath, cancelable: true
        });
      }
    } catch (_) {
      stats.errors += 1;
    }
  }
  return results;
}

async function findDuplicates(options = {}) {
  const {
    roots, paths, path: singlePath, scanPath,
    maxDepth = DEFAULT_MAX_DEPTH,
    minSize = DEFAULT_MIN_SIZE,
    maxSize = DEFAULT_MAX_SIZE,
    extensions = null,
    algorithm = 'sha256',
    skipProtected = true,
    onProgress
  } = options;
  const requested = roots || paths || (singlePath ? [singlePath] : null) || (scanPath ? [scanPath] : null) || SAFE_ROOTS;
  const resolvedRoots = [...new Set((Array.isArray(requested) ? requested : [requested])
    .filter(Boolean).map((entry) => path.resolve(entry)))]
    .filter((entry) => fs.existsSync(entry) && !isProtectedPath(entry));
  if (!resolvedRoots.length) {
    return {
      success: false,
      error: 'Choose an accessible, non-system folder to scan.',
      totalFilesScanned: 0, duplicateGroups: [], totalDuplicates: 0, totalWastedSpace: 0,
      statistics: { indexed: 0, hashed: 0, skipped: 0, errors: 0 }
    };
  }

  const scanStats = { indexed: 0, skipped: 0, errors: 0 };
  const allFiles = [];
  const extensionSet = normalizeExtensions(extensions);
  for (const root of resolvedRoots) {
    allFiles.push(...await scanDirectory(root, {
      root,
      maxDepth: Number(maxDepth),
      minSize: Math.max(0, Number(minSize) || DEFAULT_MIN_SIZE),
      maxSize: Number.isFinite(Number(maxSize)) ? Number(maxSize) : DEFAULT_MAX_SIZE,
      extensions: extensionSet,
      skipProtected: skipProtected !== false,
      onProgress,
      stats: scanStats
    }));
  }

  const uniqueFiles = [...new Map(allFiles.map((file) => {
    const resolved = path.resolve(file.path);
    return [(process.platform === 'win32' ? resolved.toLowerCase() : resolved), file];
  })).values()];
  const bySize = new Map();
  for (const file of uniqueFiles) {
    const group = bySize.get(file.size) || [];
    group.push(file);
    bySize.set(file.size, group);
  }
  const candidates = [...bySize.values()].filter((files) => files.length > 1).flat();
  const byHash = new Map();
  let hashed = 0;
  let hashedBytes = 0;
  const totalHashBytes = candidates.reduce((sum, file) => sum + file.size, 0);
  for (const file of candidates) {
    try {
      const hash = await calculateHash(file.path, algorithm, (bytes) => { hashedBytes += bytes; });
      hashed += 1;
      const group = byHash.get(hash) || [];
      group.push(file);
      byHash.set(hash, group);
      onProgress?.({
        phase: 'hashing', label: 'Hashing candidate files', count: hashed, total: candidates.length,
        pct: totalHashBytes ? Math.round((hashedBytes / totalHashBytes) * 100) : 100,
        currentActivity: file.path, cancelable: true
      });
    } catch (_) {
      scanStats.errors += 1;
    }
  }

  const duplicateGroups = [];
  for (const [hash, files] of byHash) {
    if (files.length < 2) continue;
    files.sort((a, b) => a.path.localeCompare(b.path));
    duplicateGroups.push({
      id: `${hash}:${files[0].size}`,
      hash,
      size: files[0].size,
      files: files.map((file) => {
        const extension = path.extname(file.path).toLowerCase();
        return { ...file, extension, category: getFileCategory(extension), parentFolder: path.dirname(file.path) };
      })
    });
  }
  duplicateGroups.sort((a, b) => (b.size * (b.files.length - 1)) - (a.size * (a.files.length - 1)));
  onProgress?.({ phase: 'complete', label: 'Duplicate scan complete', pct: 100, count: uniqueFiles.length, cancelable: false });
  return {
    success: true,
    scanPaths: resolvedRoots,
    totalFilesScanned: uniqueFiles.length,
    duplicateGroups,
    totalDuplicates: duplicateGroups.reduce((sum, group) => sum + group.files.length - 1, 0),
    totalWastedSpace: duplicateGroups.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0),
    statistics: { ...scanStats, hashed }
  };
}

async function deleteFiles(filePaths) {
  const deleted = [];
  const failed = [];
  for (const filePath of filePaths || []) {
    const safety = assessMutation(filePath);
    if (!safety.ok) {
      failed.push({ path: filePath, error: safety.reason });
      continue;
    }
    try {
      fs.unlinkSync(safety.path);
      deleted.push(safety.path);
    } catch (err) {
      failed.push({ path: safety.path, error: err.message });
    }
  }
  return { deleted, failed };
}

const deleteFilesWithPaths = deleteFiles;

module.exports = {
  SAFE_ROOTS, PROTECTED_PATHS, DEFAULT_MAX_DEPTH, DEFAULT_MIN_SIZE, DEFAULT_MAX_SIZE,
  SKIP_DIRS, FILE_CATEGORIES, getFileCategory, shouldSkipDir, isPathInsideDir, isSafePath,
  normalizeExtensions, calculateHash, scanDirectory, findDuplicates, deleteFiles, deleteFilesWithPaths
};
