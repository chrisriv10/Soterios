'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { assessMutation, defaultMutationRoots } = require('../../core/pathSafety');

// Approved mutation roots for legacy leftover removal: the shared user/temp
// maintenance roots plus the current user's Local/Roaming AppData trees,
// where uninstalled-application leftovers legitimately live. NOT a blanket
// AppData allow: assessMutation still excludes shared protected subtrees
// (Soterios app data, Microsoft Protect/Credentials, credential stores) and
// rejects reparse traversal. ProgramData stays protected per shared policy.
// Derived per call so environment overrides apply.
function approvedMutationRoots() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [localAppData, appData, ...defaultMutationRoots()];
}

// Map a shared assessMutation failure to this script's skip reasons.
// Coupled to assessMutation's reason sentences by design (same repository);
// unknown reasons fail closed, never as missing.
function refusalReason(safety) {
  const reason = (safety && safety.reason) || '';
  if (reason === 'Path no longer exists.') return 'missing';
  if (reason.startsWith('Protected ')) return 'protected';
  if (reason.includes('outside approved')) return 'outside-approved-roots';
  if (reason.startsWith('Reparse ')) return 'reparse-or-symlink';
  return 'refused';
}

module.exports = async function removeLeftovers(args = {}) {
  const dryRun = args.dryRun !== false;
  const paths = Array.isArray(args.paths) ? args.paths : [];
  const removed = [];
  const skipped = [];
  const log = [];
  const allowedRoots = approvedMutationRoots();

  for (const targetPath of paths) {
    if (!targetPath || typeof targetPath !== 'string') {
      skipped.push({ path: targetPath, reason: 'invalid-path' });
      continue;
    }

    // Dry runs enforce the identical policy: an unsafe path is reported as
    // skipped/refused here, never as a successful "Would remove" candidate.
    const safety = assessMutation(targetPath, { allowedRoots });
    if (!safety.ok) {
      const reason = refusalReason(safety);
      if (reason === 'missing') {
        skipped.push({ path: targetPath, reason: 'missing' });
      } else {
        log.push(`Refused (${reason}): ${targetPath}`);
        skipped.push({ path: targetPath, reason });
      }
      continue;
    }

    // Operate only on the validated resolved path, inspected with lstat so
    // a link swapped in after assessment is never followed as a directory.
    const target = safety.path;
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (_) {
      skipped.push({ path: targetPath, reason: 'missing' });
      continue;
    }

    if (stat.isSymbolicLink()) {
      log.push(`Refused (reparse-or-symlink): ${targetPath}`);
      skipped.push({ path: targetPath, reason: 'reparse-or-symlink' });
      continue;
    }

    if (!stat.isDirectory()) {
      skipped.push({ path: targetPath, reason: 'not-a-directory' });
      continue;
    }

    if (dryRun) {
      log.push(`Would remove: ${targetPath}`);
      removed.push({ path: targetPath, dryRun: true });
      continue;
    }

    try {
      // Recursive rm resolves entries with lstat semantics: child links are
      // removed as links, not traversed. Ancestor and target links are
      // already rejected above, so only genuine directory content is removed.
      fs.rmSync(target, { recursive: true, force: true });
      log.push(`Removed: ${targetPath}`);
      removed.push({ path: targetPath, dryRun: false });
    } catch (err) {
      log.push(`Failed: ${targetPath} (${err.message || err})`);
      skipped.push({ path: targetPath, reason: 'delete-failed' });
    }
  }

  return {
    dryRun,
    removedCount: removed.length,
    skippedCount: skipped.length,
    removed,
    skipped,
    log
  };
};
