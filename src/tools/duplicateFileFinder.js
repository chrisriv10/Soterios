'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { findDuplicates, deleteFilesWithPaths, normalizeExtensions } = require('../core/duplicateFinder');

async function findDuplicatesTool(args = {}, onProgress) {
  const { paths, path: inputPath, algorithm = 'sha256', extensions, maxDepth = 12, minSizeBytes = 1, ...rest } = args;
  
  const roots = paths || (inputPath ? [inputPath] : []);
  if (!roots.length) {
    return { success: false, error: 'At least one scan path is required.' };
  }

  const extSet = normalizeExtensions(extensions);

  const result = await findDuplicates({
    roots,
    maxDepth,
    minSize: minSizeBytes,
    extensions: extSet,
    algorithm,
    skipProtected: false,
    onProgress
  });

  // Core findDuplicates can return an error object
  if (result && result.success === false) {
    return { success: false, error: result.error || 'Duplicate search failed' };
  }

  const duplicates = (result.duplicateGroups || [])
    .filter((g) => g.files && g.files.length > 1)
    .map((g) => ({
      hash: g.hash,
      size: g.size,
      count: g.files.length,
      recoverableBytes: g.size * (g.files.length - 1),
      files: g.files.map(f => f.path)
    }))
    .sort((a, b) => b.recoverableBytes - a.recoverableBytes);

  const recoverableBytes = duplicates.reduce((sum, g) => sum + g.recoverableBytes, 0);
  const scanned = result.totalFilesScanned;
  const candidateFiles = (result.duplicateGroups || []).reduce((sum, g) => sum + (g.files?.length || 0), 0);

  return {
    success: true,
    algorithm,
    roots,
    scannedFiles: scanned,
    candidateFiles,
    groupCount: duplicates.length,
    recoverableBytes,
    recoverableMB: Math.round((recoverableBytes / (1024 * 1024)) * 10) / 10,
    duplicates
  };
}

async function deleteDuplicates(args = {}) {
  if (!args.confirm) {
    return { success: false, error: 'Confirmation required. Pass confirm: true.' };
  }
  const groups = Array.isArray(args.groups) ? args.groups : [];
  if (!groups.length) {
    return { success: false, error: 'No duplicate groups provided.' };
  }

  const deletePaths = [];
  for (const group of groups) {
    const keep = group && group.keep;
    const toDelete = Array.isArray(group.delete) ? group.delete : [];
    if (!keep || !toDelete.length) {
      continue;
    }
    for (const filePath of toDelete) {
      if (path.resolve(filePath) === path.resolve(keep)) {
        continue;
      }
      deletePaths.push(filePath);
    }
  }

  const result = await deleteFilesWithPaths(deletePaths);
  
  return {
    success: result.failed.length === 0,
    deleted: result.deleted,
    deletedCount: result.deleted.length,
    freedBytes: result.deleted.reduce((sum, p) => {
      try { return sum + fs.statSync(p).size; } catch (_) { return sum; }
    }, 0),
    freedMB: Math.round((result.deleted.reduce((sum, p) => {
      try { return sum + fs.statSync(p).size; } catch (_) { return sum; }
    }, 0) / (1024 * 1024)) * 10) / 10,
    errors: result.failed
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
      return findDuplicatesTool(args, onProgress);
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

// Export helpers for backward compatibility with tests
module.exports.helpers = {
  findDuplicates: async (args = {}) => {
    return findDuplicatesTool(args);
  },
  deleteDuplicates: async (args = {}) => {
    return deleteDuplicates(args);
  },
  normalizeExtensions
};