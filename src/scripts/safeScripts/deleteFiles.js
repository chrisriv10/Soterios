const fs = require('fs');
const path = require('path');

// Even though largeFilesReport.js already skips some risky directories when
// scanning, a large file could still legitimately turn up under Windows or
// Program Files (e.g. a big shared resource/DLL). Deleting those blind,
// just because a user checked a box, risks breaking installed software or
// the OS itself -- refuse those regardless of selection.
const PROTECTED_PREFIXES = [
  'c:\\windows\\',
  'c:\\program files\\',
  'c:\\program files (x86)\\'
];

function isProtected(p) {
  const resolved = path.resolve(p).toLowerCase();
  return PROTECTED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

module.exports = async function deleteFiles(args = {}) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  let deletedCount = 0;
  let skippedCount = 0;
  let freedBytes = 0;
  const log = [];

  for (const p of paths) {
    if (!p || typeof p !== 'string') {
      skippedCount++;
      continue;
    }

    if (isProtected(p)) {
      log.push(`Refused (protected system location): ${p}`);
      skippedCount++;
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(p);
    } catch (err) {
      log.push(`Skipped (not found, may already be deleted): ${p}`);
      skippedCount++;
      continue;
    }

    if (!stat.isFile()) {
      log.push(`Skipped (not a file): ${p}`);
      skippedCount++;
      continue;
    }

    try {
      fs.unlinkSync(p);
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
