'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Duplicate File Finder
 * Finds duplicate files using SHA-256 hashing and allows deletion of duplicates.
 * Only scans user directories (home, Downloads, Documents, Desktop) for safety.
 */

const SAFE_ROOTS = [
  os.homedir(),
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Desktop')
];

const PROTECTED_PATHS = [
  path.join(os.homedir(), 'AppData'),
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.config'),
  process.env.ProgramData,
  process.env.WINDIR
];

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
  
  // Check if under protected paths
  for (const protectedPath of PROTECTED_PATHS) {
    if (protectedPath && isPathInsideDir(normalized, protectedPath)) {
      return false;
    }
  }
  
  // Check if under safe roots
  for (const root of SAFE_ROOTS) {
    if (isPathInsideDir(normalized, root)) {
      return true;
    }
  }
  
  return false;
}

function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function scanDirectory(dir, maxDepth = 3, currentDepth = 0) {
  const results = [];
  
  if (currentDepth >= maxDepth) return results;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      try {
        if (entry.isDirectory()) {
          // Skip hidden directories and common system/cache dirs
          if (entry.name.startsWith('.') || 
              entry.name.toLowerCase() === 'node_modules' ||
              entry.name.toLowerCase() === 'git' ||
              entry.name.toLowerCase() === '.git') {
            continue;
          }
          
          if (isSafePath(fullPath)) {
            const subResults = await scanDirectory(fullPath, maxDepth, currentDepth + 1);
            results.push(...subResults);
          }
        } else if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          // Skip very small files (< 1KB) and very large files (> 100MB)
          if (stats.size >= 1024 && stats.size <= 100 * 1024 * 1024) {
            if (isSafePath(fullPath)) {
              results.push({
                path: fullPath,
                size: stats.size,
                modified: stats.mtime
              });
            }
          }
        }
      } catch (err) {
        // Skip files we can't access
      }
    }
  } catch (err) {
    // Skip directories we can't access
  }
  
  return results;
}

async function findDuplicates(scanPath = null) {
  const scanDirs = scanPath ? [scanPath] : SAFE_ROOTS.filter(p => fs.existsSync(p));
  const allFiles = [];
  
  // Scan all directories
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = await scanDirectory(dir, 3);
    allFiles.push(...files);
  }
  
  // Deduplicate files by resolved path (case-insensitive on Windows only)
// This handles overlapping scan roots (e.g., home dir + Downloads)
  const uniqueFiles = [...new Map(
    allFiles.map((file) => {
      const resolved = path.resolve(file.path);
      // On Windows, use lowercase for deduplication since filesystem is case-insensitive
      // On POSIX, preserve case since filesystem is case-sensitive
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
  for (const file of potentialDuplicates) {
    try {
      const hash = await calculateHash(file.path);
      if (!byHash.has(hash)) {
        byHash.set(hash, []);
      }
      byHash.get(hash).push(file);
    } catch (err) {
      // Skip files we can't hash
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
        files: files.map(f => ({
          path: f.path,
          size: f.size,
          modified: f.modified
        }))
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

function deleteFiles(filePaths) {
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

module.exports = async function duplicateFinder(args = {}) {
  const { scanPath, deletePaths } = args;
  
  if (deletePaths && Array.isArray(deletePaths)) {
    return deleteFiles(deletePaths);
  }
  
  const result = await findDuplicates(scanPath);
  
  return {
    ...result,
    duplicateGroups: result.duplicateGroups.slice(0, 100) // Limit to 100 groups
  };
};
