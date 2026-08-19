'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { captureSnapshot, hasReparseAncestor, isProtectedPath } = require('../../core/pathSafety');

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '$recycle.bin', 'system volume information']);

function shouldSkip(fullPath, name) {
  const lower = String(name || '').toLowerCase();
  return lower.startsWith('.') || SKIP_DIRS.has(lower)
    || fullPath.toLowerCase().includes('\\appdata\\local\\packages\\')
    || fullPath.toLowerCase().includes('\\appdata\\local\\microsoft\\windowsapps\\');
}

module.exports = async function largeFilesReport(args = {}, onProgress) {
  const root = path.resolve(args.scanPath || args.path || os.homedir());
  const thresholdMB = Math.max(1, Number(args.thresholdMB || args.minSizeMB || 100));
  const thresholdBytes = thresholdMB * 1024 * 1024;
  const page = Math.max(1, Number(args.page) || 1);
  const pageSize = Math.max(10, Math.min(500, Number(args.pageSize) || 100));
  const sortBy = ['size', 'modified', 'path'].includes(args.sortBy) ? args.sortBy : 'size';
  const sortDirection = args.sortDirection === 'asc' ? 'asc' : 'desc';
  const maxDepth = Math.max(1, Math.min(64, Number(args.maxDepth) || 32));
  const started = Date.now();
  const files = [];
  const statistics = { scannedFiles: 0, scannedDirectories: 0, skipped: 0, errors: 0 };

  if (!fs.existsSync(root) || isProtectedPath(root)) {
    return { root, thresholdMB, count: 0, files: [], error: 'Choose an accessible, non-system folder.' };
  }

  function walk(current, depth) {
    if (depth > maxDepth || hasReparseAncestor(current, root)) { statistics.skipped += 1; return; }
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (_) { statistics.errors += 1; return; }
    statistics.scannedDirectories += 1;
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) { statistics.skipped += 1; continue; }
      if (entry.isDirectory()) {
        if (shouldSkip(fullPath, entry.name) || isProtectedPath(fullPath)) statistics.skipped += 1;
        else walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      statistics.scannedFiles += 1;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size >= thresholdBytes) {
          files.push({
            path: fullPath,
            sizeBytes: stat.size,
            sizeMB: +(stat.size / 1024 / 1024).toFixed(1),
            modifiedAt: stat.mtime.toISOString(),
            snapshot: captureSnapshot(fullPath)
          });
        }
      } catch (_) { statistics.errors += 1; }
      if (statistics.scannedFiles === 1 || statistics.scannedFiles % 100 === 0) {
        // The total is unknown until traversal completes; show a conservative
        // estimate while retaining the exact scanned-file count.
        const estimatedPct = Math.min(95, Math.max(1, Math.round(100 * (1 - Math.exp(-statistics.scannedFiles / 500)))));
        onProgress?.({ phase: 'scanning', label: 'Scanning files', count: statistics.scannedFiles, pct: estimatedPct, currentActivity: fullPath, cancelable: true });
      }
    }
  }
  walk(root, 0);
  const direction = sortDirection === 'asc' ? 1 : -1;
  files.sort((a, b) => {
    if (sortBy === 'path') return a.path.localeCompare(b.path) * direction;
    if (sortBy === 'modified') return (new Date(a.modifiedAt) - new Date(b.modifiedAt)) * direction;
    return (a.sizeBytes - b.sizeBytes) * direction;
  });
  const offset = (page - 1) * pageSize;
  const pagedFiles = files.slice(offset, offset + pageSize);
  const totalSizeBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  onProgress?.({ phase: 'complete', label: 'Large file report ready', pct: 100, count: statistics.scannedFiles, cancelable: false });
  return {
    root,
    thresholdMB,
    count: files.length,
    totalSizeBytes,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(files.length / pageSize)),
    sortBy,
    sortDirection,
    files: pagedFiles,
    statistics: { ...statistics, durationMs: Date.now() - started }
  };
};
