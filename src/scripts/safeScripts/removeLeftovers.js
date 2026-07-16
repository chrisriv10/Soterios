'use strict';

const fs = require('fs');
const path = require('path');
const { isProtected } = require('./protectedPaths');

module.exports = async function removeLeftovers(args = {}) {
  const dryRun = args.dryRun !== false;
  const paths = Array.isArray(args.paths) ? args.paths : [];
  const removed = [];
  const skipped = [];
  const log = [];

  for (const targetPath of paths) {
    if (!targetPath || typeof targetPath !== 'string') {
      skipped.push({ path: targetPath, reason: 'invalid-path' });
      continue;
    }

    if (isProtected(targetPath)) {
      log.push(`Refused (protected system location): ${targetPath}`);
      skipped.push({ path: targetPath, reason: 'protected' });
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(targetPath);
    } catch (_) {
      skipped.push({ path: targetPath, reason: 'missing' });
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
      fs.rmSync(targetPath, { recursive: true, force: true });
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
