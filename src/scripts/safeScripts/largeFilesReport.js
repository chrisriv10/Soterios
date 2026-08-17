const fs = require('fs');
const path = require('path');
const os = require('os');

const SKIP_DIRS = new Set(['node_modules', '.git', 'AppData\\Local\\Packages']);

/**
 * Determines whether a directory should be skipped during a large-file scan.
 *
 * @param {string} fullPath - Full directory path.
 * @param {string} name - Directory entry name.
 * @returns {boolean} True if the directory should be skipped.
 */
function shouldSkip(fullPath, name) {
  if (SKIP_DIRS.has(name)) return true;
  const lower = fullPath.toLowerCase();
  return lower.includes('\\appdata\\local\\packages\\') || lower.includes('\\appdata\\local\\microsoft\\windowsapps\\');
}

/**
 * Report large files under a directory tree.
 *
 * @param {Object} [args={}]
 * @param {string} [args.path] - Root directory to scan.
 * @param {number} [args.minSizeMB=100] - Minimum file size in MB.
 * @param {number} [args.maxResults=40] - Maximum results to return.
 * @param {Function} [onProgress] - Progress callback `(payload)`.
 * @returns {Promise<{root: string, minSizeMB: number, count: number, files: Array}>} Large file report.
 */
module.exports = async function largeFilesReport(args = {}, onProgress) {
  const root = args.path || os.homedir();
  const minSizeMB = Number(args.minSizeMB || 100);
  const minBytes = minSizeMB * 1024 * 1024;
  const maxResults = Number(args.maxResults || 40);
  const files = [];

  // Total file count under an arbitrary directory tree isn't known ahead of
  // time, so this reports a live count rather than a fabricated percentage.
  // Throttled since a home-directory walk can easily visit tens of
  // thousands of entries.
  let scannedCount = 0;
  const REPORT_EVERY = 200;

  /**
   * Recursively walks a directory tree collecting large files.
   *
   * @param {string} current - Current directory path.
   * @param {number} depth - Current recursion depth.
   */
  function walk(current, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (err) { return; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { if (!shouldSkip(fullPath, entry.name)) walk(fullPath, depth + 1); continue; }
      if (!entry.isFile()) continue;
      scannedCount++;
      if (onProgress && scannedCount % REPORT_EVERY === 0) {
        onProgress({ label: 'Scanning files', count: scannedCount });
      }
      try { const stat = fs.statSync(fullPath); if (stat.size >= minBytes) files.push({ path: fullPath, sizeMB: +(stat.size / 1024 / 1024).toFixed(1), modifiedAt: stat.mtime.toISOString() }); } catch (err) { console.debug?.('largeFilesReport stat failed', { path: fullPath, error: err?.message || String(err) }); }
    }
  }
  walk(root, 0);
  onProgress?.({ label: 'Scan complete', count: scannedCount });
  files.sort((a, b) => b.sizeMB - a.sizeMB);
  return { root, minSizeMB, count: files.length, files: files.slice(0, maxResults) };
};