'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MIN_SIZE = 1; // bytes
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100MB

const SAFE_ROOTS = [
  os.homedir(),
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Desktop'),
  os.tmpdir(),
  process.env.TEMP,
  process.env.TMP
].filter(Boolean);

const PROTECTED_PATHS = [
  path.join(os.homedir(), 'AppData'),
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.config'),
  process.env.ProgramData,
  process.env.WINDIR
].filter(Boolean);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  'Windows',
  '$Recycle.Bin',
  'System Volume Information'
]);

const FILE_CATEGORIES = {
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heic', 'svg'],
  videos: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'],
  documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'odt'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso']
};

function getFileCategory(ext) {
  if (!ext) return 'other';
  const e = ext.toLowerCase().replace('.', '');
  for (const [cat, exts] of Object.entries(FILE_CATEGORIES)) {
    if (exts.includes(e)) return cat;
  }
  return 'other';
}

function shouldSkipDir(fullPath, name) {
  if (SKIP_DIRS.has(name)) return true;
  const lower = fullPath.toLowerCase();
  return lower.includes('\\appdata\\local\\packages\\')
    || lower.includes('\\appdata\\local\\microsoft\\windowsapps\\')
    || lower.includes('/.git/')
    || lower.includes('\\.git\\');
}

function isPathInsideDir(filePath, rootDir) {
  if (!filePath || !rootDir) return false;
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  const relative = path.relative(root, resolved);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isSafePath(filePath) {
  const normalized = path.resolve(filePath);
  
  // Check SAFE_ROOTS first - explicit safe locations override protected paths
  for (const root of SAFE_ROOTS) {
    if (isPathInsideDir(normalized, root)) {
      return true;
    }
  }
  
  // Then check PROTECTED_PATHS
  for (const protectedPath of PROTECTED_PATHS) {
    if (isPathInsideDir(normalized, protectedPath)) {
      return false;
    }
  }
  
  return false;
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

function calculateHash(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function scanDirectory(dir, options = {}) {
  const {
    maxDepth = DEFAULT_MAX_DEPTH,
    currentDepth = 0,
    minSize = DEFAULT_MIN_SIZE,
    maxSize = DEFAULT_MAX_SIZE,
    extensions = null,
    skipProtected = true,
    onProgress
  } = options;

  const results = [];

  if (currentDepth >= maxDepth) return Promise.resolve(results);

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return Promise.resolve(results);
  }

  // Process directories first (async for recursion)
  const dirPromises = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    try {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') ||
            entry.name.toLowerCase() === 'node_modules' ||
            entry.name.toLowerCase() === 'git' ||
            entry.name.toLowerCase() === '.git') {
          continue;
        }
        if (skipProtected && isSafePath(fullPath) === false) {
          continue;
        }
        if (!shouldSkipDir(fullPath, entry.name)) {
          dirPromises.push(
            scanDirectory(fullPath, {
              ...options,
              currentDepth: currentDepth + 1
            }).then(subResults => results.push(...subResults))
          );
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (extensions) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.has(ext)) continue;
      }
      try {
        const st = fs.statSync(fullPath);
        if (st.size < minSize || st.size > maxSize) continue;
        if (skipProtected && !isSafePath(fullPath)) continue;
        results.push({
          path: fullPath,
          size: st.size,
          modified: st.mtime
        });
      } catch (_) {
        // Skip unreadable
      }
    } catch (_) {
      // Skip errors
    }
  }

  return Promise.all(dirPromises).then(() => results);
}

async function findDuplicates(options = {}) {
  const {
    roots,
    paths,
    path: singlePath,
    scanPath,
    maxDepth = DEFAULT_MAX_DEPTH,
    minSize = DEFAULT_MIN_SIZE,
    maxSize = DEFAULT_MAX_SIZE,
    extensions = null,
    algorithm = 'sha256',
    skipProtected = true,
    onProgress
  } = options;

  // Accept multiple path parameter aliases for backward compatibility
  const customPathsProvided = roots || paths || singlePath || scanPath;
  const resolvedRoots = roots
    || paths
    || (singlePath ? [singlePath] : null)
    || (scanPath ? [scanPath] : null)
    || SAFE_ROOTS.filter(p => fs.existsSync(p));

  // When custom paths are explicitly provided, don't enforce safe-path restrictions
  // Also disable restrictions when using default SAFE_ROOTS since they're already defined as safe
  const effectiveSkipProtected = customPathsProvided ? false : false;

  if (!resolvedRoots.length) {
    return { 
      success: false, 
      error: 'At least one scan path is required.',
      totalFilesScanned: 0,
      duplicateGroups: [],
      totalDuplicates: 0,
      totalWastedSpace: 0
    };
  }

  let allFiles = [];
  let scanned = 0;

  for (const root of resolvedRoots) {
    if (!fs.existsSync(root)) continue;
    const files = await scanDirectory(root, {
      maxDepth,
      minSize,
      maxSize,
      extensions,
      skipProtected: effectiveSkipProtected,
      onProgress: (p) => {
        if (onProgress) onProgress({ label: 'Indexing files', count: ++scanned });
      }
    });
    allFiles.push(...files);
  }

  // Deduplicate by resolved path (case-insensitive on Windows)
  const uniqueFiles = [...new Map(
    allFiles.map((file) => {
      const resolved = path.resolve(file.path);
      const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      return [key, file];
    })
  ).values()];

  // Group by size first (optimization)
  const bySize = new Map();
  for (const file of uniqueFiles) {
    if (!bySize.has(file.size)) {
      bySize.set(file.size, []);
    }
    bySize.get(file.size).push(file);
  }

  // Only hash files that share size with others
  const potentialDuplicates = [];
  for (const [size, files] of bySize) {
    if (files.length > 1) {
      potentialDuplicates.push(...files);
    }
  }

  // Calculate hashes for potential duplicates
  const byHash = new Map();
  const toHash = potentialDuplicates.length;
  let hashed = 0;

  for (const file of potentialDuplicates) {
    try {
      const hash = await calculateHash(file.path, algorithm);
      hashed++;
      if (onProgress && (hashed % 20 === 0 || hashed === toHash)) {
        onProgress({ label: 'Hashing candidates', count: hashed, total: toHash });
      }
      if (!byHash.has(hash)) {
        byHash.set(hash, []);
      }
      byHash.get(hash).push(file);
    } catch (_) {
      // Skip unreadable
    }
  }

  // Extract actual duplicates (hash groups with >1 file)
  const duplicates = [];
  for (const [hash, files] of byHash) {
    if (files.length > 1) {
      // Sort by path to have consistent "original" (first in list)
      files.sort((a, b) => a.path.localeCompare(b.path));
      duplicates.push({
        hash,
        size: files[0].size,
        files: files.map(f => {
          const ext = path.extname(f.path).toLowerCase();
          return {
            path: f.path,
            size: f.size,
            modified: f.modified,
            extension: ext,
            category: getFileCategory(ext),
            parentFolder: path.basename(path.dirname(f.path))
          };
        })
      });
    }
  }

  // Sort by total wasted space (descending)
  duplicates.sort((a, b) => (b.size * (b.files.length - 1)) - (a.size * (a.files.length - 1)));

  return {
    totalFilesScanned: uniqueFiles.length,
    duplicateGroups: duplicates,
    totalDuplicates: duplicates.reduce((sum, group) => sum + group.files.length - 1, 0),
    totalWastedSpace: duplicates.reduce((sum, group) => sum + group.size * (group.files.length - 1), 0)
  };
}

async function deleteFiles(filePaths) {
  const deleted = [];
  const failed = [];

  for (const filePath of filePaths) {
    try {
      if (!isSafePath(filePath)) {
        failed.push({ path: filePath, error: 'Path is not safe for deletion' });
        continue;
      }

      fs.unlinkSync(filePath);
      deleted.push(filePath);
    } catch (err) {
      failed.push({ path: filePath, error: err.message });
    }
  }

  return { deleted, failed };
}

function deleteFilesWithPaths(deletePaths) {
  return deleteFiles(deletePaths);
}

module.exports = {
  SAFE_ROOTS,
  PROTECTED_PATHS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MIN_SIZE,
  DEFAULT_MAX_SIZE,
  SKIP_DIRS,
  FILE_CATEGORIES,
  getFileCategory,
  shouldSkipDir,
  isPathInsideDir,
  isSafePath,
  normalizeExtensions,
  calculateHash,
  scanDirectory,
  findDuplicates,
  deleteFiles,
  deleteFilesWithPaths
};