const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Safely stats a path, returning null on error.
 *
 * @param {string} p - Path to stat.
 * @returns {fs.Stats|null} Stats object or null.
 */
function safeStat(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

/**
 * Clear temporary files older than a configurable age from the system temp directory.
 *
 * @param {Object} [args={}]
 * @param {number} [args.maxAgeDays=7] - Files older than this are deleted.
 * @param {boolean} [args.dryRun] - When true, only log intended deletions.
 * @param {Function} [onProgress] - Progress callback `(payload)`.
 * @returns {Promise<{dryRun: boolean, tempDir: string, maxAgeDays: number, deletedCount: number, skippedCount: number, freedBytes: number, freedMB: number, log: string[]}>} Clear summary.
 */
module.exports = async function clearTemp(args = {}, onProgress) {
  const maxAgeDays = args.maxAgeDays ?? 7;
  const dryRun = args.dryRun !== false;
  const tempDir = os.tmpdir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const log = [];
  let freedBytes = 0, deletedCount = 0, skippedCount = 0;

  // Total item count isn't known until the whole tree is walked, so this
  // reports a live count rather than a fabricated percentage. Throttled to
  // avoid flooding the IPC channel back to the parent process.
  let scannedCount = 0;
  const REPORT_EVERY = 25;
  /**
   * Emits a throttled progress update for the temp-file scan.
   */
  function maybeReportProgress() {
    scannedCount++;
    if (onProgress && scannedCount % REPORT_EVERY === 0) {
      onProgress({ label: 'Scanning temp files', count: scannedCount });
    }
  }

  /**
   * Processes a single path: deletes old files, recurses into directories.
   *
   * @param {string} p - Path to process.
   */
  function processPath(p) {
    const stat = safeStat(p);
    if (!stat) return;
    maybeReportProgress();
    if (stat.isFile()) {
      if (stat.mtimeMs > cutoff) { skippedCount++; return; }
      if (dryRun) log.push(`[DRY RUN] Would delete file: ${p} (${stat.size} bytes)`);
      else {
        try { fs.unlinkSync(p); log.push(`Deleted file: ${p} (${stat.size} bytes)`); } catch (err) { log.push(`Skipped file (locked/denied): ${p}`); skippedCount++; return; }
      }
      freedBytes += stat.size; deletedCount++;
      return;
    }
    if (stat.isDirectory()) {
      let children;
      try { children = fs.readdirSync(p); } catch (err) { log.push(`Skipped directory (locked/denied): ${p}`); skippedCount++; return; }
      for (const c of children) processPath(path.join(p, c));
      // Try to remove directory if empty and older than cutoff
      try {
        const after = fs.readdirSync(p);
        if (after.length === 0) {
          const dirStat = safeStat(p);
          if (dirStat && dirStat.mtimeMs <= cutoff) {
            if (dryRun) log.push(`[DRY RUN] Would remove empty dir: ${p}`);
            else { fs.rmdirSync(p); log.push(`Removed empty dir: ${p}`); }
          }
        }
      } catch (err) { /* ignore */ }
    }
  }

  try {
    processPath(tempDir);
  } catch (err) {
    return { error: `Could not process temp directory: ${err.message}`, log };
  }

  onProgress?.({ label: 'Scan complete', count: scannedCount });

  return { dryRun, tempDir, maxAgeDays, deletedCount, skippedCount, freedBytes, freedMB: +(freedBytes / 1e6).toFixed(2), log };
};