'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { captureSnapshot, hasReparseAncestor, verifySnapshot } = require('../../core/pathSafety');

function tempRoots() {
  const roots = [os.tmpdir(), process.env.TEMP, process.env.TMP];
  if (process.platform === 'win32') roots.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp'));
  return [...new Set(roots.filter(Boolean).map((entry) => path.resolve(entry)))].filter(fs.existsSync);
}

function canOpenForMutation(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return true;
  } catch (_) {
    return false;
  }
}

function analyze(roots, cutoff, onProgress) {
  const candidates = [];
  const skipped = [];
  const stats = { scanned: 0, eligible: 0, skippedRecent: 0, skippedActive: 0, skippedProtected: 0, accessDenied: 0 };
  function walk(current, root) {
    if (hasReparseAncestor(current, root)) {
      stats.skippedProtected += 1;
      skipped.push({ path: current, reason: 'protected-or-reparse' });
      return;
    }
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (_) { stats.accessDenied += 1; skipped.push({ path: current, reason: 'access-denied' }); return; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        stats.skippedProtected += 1;
        skipped.push({ path: fullPath, reason: 'reparse-point' });
        continue;
      }
      if (entry.isDirectory()) { walk(fullPath, root); continue; }
      if (!entry.isFile()) continue;
      stats.scanned += 1;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > cutoff) {
          stats.skippedRecent += 1;
          continue;
        }
        if (!canOpenForMutation(fullPath)) {
          stats.skippedActive += 1;
          skipped.push({ path: fullPath, reason: 'active-or-locked' });
          continue;
        }
        candidates.push({ path: fullPath, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString(), snapshot: captureSnapshot(fullPath) });
        stats.eligible += 1;
      } catch (_) {
        stats.accessDenied += 1;
        skipped.push({ path: fullPath, reason: 'access-denied' });
      }
      if (stats.scanned === 1 || stats.scanned % 50 === 0) {
        // Directory size is unknown until traversal completes, so expose a
        // conservative estimate that advances during long scans and leaves
        // the final jump to 100% for the completed report.
        const estimatedPct = Math.min(95, Math.max(1, Math.round((stats.scanned / (stats.scanned + 250)) * 100)));
        onProgress?.({ phase: 'analyzing', label: 'Analyzing temp files', count: stats.scanned, pct: estimatedPct, currentActivity: fullPath, cancelable: true });
      }
    }
  }
  for (const root of roots) walk(root, root);
  return { candidates, skipped, stats };
}

function cleanEmptyParents(filePath, roots) {
  let current = path.dirname(filePath);
  const comparable = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  while (roots.some((root) => {
    const parent = comparable(current);
    const boundary = comparable(root);
    return parent !== boundary && parent.startsWith(`${boundary}${path.sep}`);
  })) {
    try {
      if (fs.readdirSync(current).length) break;
      fs.rmdirSync(current);
    } catch (_) { break; }
    current = path.dirname(current);
  }
}

module.exports = async function clearTemp(args = {}, onProgress) {
  const minimumAgeDays = Math.max(1, Number(args.minimumAgeDays ?? args.maxAgeDays ?? 7));
  const roots = tempRoots();
  const cutoff = Date.now() - minimumAgeDays * 86400 * 1000;
  const mode = args.mode || (args.dryRun === false ? 'clean' : 'analyze');
  onProgress?.({ phase: 'analyzing', label: 'Analyzing temp locations', pct: 0, count: 0, cancelable: true });
  const analysis = analyze(roots, cutoff, onProgress);
  const reclaimableBytes = analysis.candidates.reduce((sum, item) => sum + item.sizeBytes, 0);
  if (mode !== 'clean') {
    onProgress?.({ phase: 'complete', label: 'Temp analysis complete', pct: 100, count: analysis.stats.scanned, cancelable: false });
    return {
      mode: 'analyze', dryRun: true, roots, minimumAgeDays,
      candidateCount: analysis.candidates.length,
      reclaimableBytes,
      reclaimableMB: +(reclaimableBytes / 1024 / 1024).toFixed(2),
      candidates: analysis.candidates,
      skipped: analysis.skipped,
      statistics: analysis.stats
    };
  }

  const requested = Array.isArray(args.selectedPaths) && args.selectedPaths.length
    ? new Map(args.selectedPaths.map((item) => [path.resolve(typeof item === 'string' ? item : item.path), item]))
    : new Map(analysis.candidates.map((item) => [path.resolve(item.path), item]));
  const eligible = new Map(analysis.candidates.map((item) => [path.resolve(item.path), item]));
  const deleted = [];
  const skipped = [...analysis.skipped];
  let freedBytes = 0;
  let index = 0;
  for (const [selectedPath, input] of requested) {
    index += 1;
    const candidate = eligible.get(selectedPath);
    if (!candidate) { skipped.push({ path: selectedPath, reason: 'not-in-current-preview' }); continue; }
    const snapshot = typeof input === 'object' && input.snapshot ? input.snapshot : candidate.snapshot;
    const verified = verifySnapshot(snapshot);
    if (!verified.ok) { skipped.push({ path: selectedPath, reason: 'changed-after-preview' }); continue; }
    try {
      fs.unlinkSync(selectedPath);
      freedBytes += candidate.sizeBytes;
      deleted.push(selectedPath);
      cleanEmptyParents(selectedPath, roots);
    } catch (error) {
      skipped.push({ path: selectedPath, reason: 'locked-or-denied', error: error.message });
    }
    onProgress?.({
      phase: 'cleaning', label: 'Clearing approved temp files', count: index, total: requested.size,
      pct: Math.round((index / Math.max(requested.size, 1)) * 100), currentActivity: selectedPath, cancelable: true
    });
  }
  return {
    mode: 'clean', dryRun: false, roots, minimumAgeDays,
    deletedCount: deleted.length, skippedCount: skipped.length, freedBytes,
    freedMB: +(freedBytes / 1024 / 1024).toFixed(2), deleted, skipped,
    statistics: analysis.stats
  };
};

module.exports.tempRoots = tempRoots;
module.exports.analyze = analyze;
