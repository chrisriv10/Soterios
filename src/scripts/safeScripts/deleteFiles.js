const fs = require('fs');
const os = require('os');
const path = require('path');
const { assessMutation, defaultMutationRoots } = require('../../core/pathSafety');

// Approved mutation roots for legacy file cleanup: the shared user/temp
// maintenance roots plus the current user's Local/Roaming AppData trees,
// where browser caches and application leftovers legitimately live. This is
// NOT a blanket AppData allow: assessMutation still excludes shared
// protected subtrees (Soterios app data, Microsoft Protect/Credentials,
// credential stores) and rejects reparse traversal. ProgramData stays
// protected per shared policy even though discovery may report candidates
// there. Derived per call so environment overrides apply.
function approvedMutationRoots() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [localAppData, appData, ...defaultMutationRoots()];
}

// Map a shared assessMutation failure to this script's skip/refusal shape.
// Coupled to assessMutation's reason sentences by design (same repository);
// unknown reasons fail closed as refusals, never as missing.
function refusalFor(safety) {
  const reason = (safety && safety.reason) || '';
  if (reason === 'Path no longer exists.') return { code: 'missing', missing: true };
  if (reason.startsWith('Protected ')) return { code: 'protected' };
  if (reason.includes('outside approved')) return { code: 'outside-approved-roots' };
  if (reason.startsWith('Reparse ')) return { code: 'reparse-or-symlink' };
  return { code: 'refused' };
}

module.exports = async function deleteFiles(args = {}) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  let deletedCount = 0;
  let skippedCount = 0;
  let freedBytes = 0;
  const log = [];
  const allowedRoots = approvedMutationRoots();

  for (const p of paths) {
    if (!p || typeof p !== 'string') {
      skippedCount++;
      continue;
    }

    const safety = assessMutation(p, { allowedRoots });
    if (!safety.ok) {
      const refusal = refusalFor(safety);
      if (refusal.missing) {
        log.push(`Skipped (not found, may already be deleted): ${p}`);
      } else {
        log.push(`Refused (${refusal.code}): ${p}`);
      }
      skippedCount++;
      continue;
    }

    // Operate only on the validated resolved path, inspected with lstat so
    // a link swapped in after assessment is never followed as a file.
    const target = safety.path;
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (err) {
      log.push(`Skipped (not found, may already be deleted): ${p}`);
      skippedCount++;
      continue;
    }

    if (stat.isSymbolicLink()) {
      log.push(`Refused (reparse-or-symlink): ${p}`);
      skippedCount++;
      continue;
    }

    if (!stat.isFile()) {
      log.push(`Skipped (not a file): ${p}`);
      skippedCount++;
      continue;
    }

    try {
      fs.unlinkSync(target);
      freedBytes += stat.size;
      deletedCount++;
      log.push(`Deleted: ${p} (${stat.size} bytes)`);
    } catch (err) {
      log.push(`Skipped (locked/denied): ${p}`);
      skippedCount++;
    }
  }

  return {
    deletedCount,
    skippedCount,
    freedBytes,
    freedMB: +(freedBytes / 1e6).toFixed(2),
    log
  };
};
