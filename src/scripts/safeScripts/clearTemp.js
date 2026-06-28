const fs = require('fs');
const os = require('os');
const path = require('path');

function safeStat(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

module.exports = async function clearTemp(args = {}) {
  const maxAgeDays = args.maxAgeDays ?? 7;
  const dryRun = args.dryRun !== false;
  const tempDir = os.tmpdir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const log = [];
  let freedBytes = 0, deletedCount = 0, skippedCount = 0;

  function processPath(p) {
    const stat = safeStat(p);
    if (!stat) return;
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

  return { dryRun, tempDir, deletedCount, skippedCount, freedBytes, freedMB: +(freedBytes / 1e6).toFixed(2), log };
};
