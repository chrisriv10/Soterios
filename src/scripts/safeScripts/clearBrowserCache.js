const fs = require('fs');
const path = require('path');
const { CANDIDATES } = require('./browserCacheReport');

// Recursively deletes the CONTENTS of a directory (not the directory itself
// -- Chromium-based browsers recreate their Cache folder on next launch, and
// leaving the top-level folder in place avoids any issue if the browser
// still holds a handle to it while running).
function emptyDirContents(dirPath, log) {
  let freed = 0;
  let deleted = 0;
  let skipped = 0;

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return { freed, deleted, skipped };
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = emptyDirContents(fullPath, log);
      freed += sub.freed;
      deleted += sub.deleted;
      skipped += sub.skipped;
      try {
        if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
      } catch (err) {
        // Non-fatal -- leaving an empty subdirectory behind is harmless.
      }
      continue;
    }
    try {
      const size = fs.statSync(fullPath).size;
      fs.unlinkSync(fullPath);
      freed += size;
      deleted++;
    } catch (err) {
      skipped++;
      log.push(`Skipped (locked/denied, browser may still be running): ${fullPath}`);
    }
  }

  return { freed, deleted, skipped };
}

// Firefox stores its actual disk cache in per-profile "cache2" (plus a few
// other cache-named folders) under the LOCAL AppData profile path -- not the
// whole Local\...\Profiles tree the report uses for sizing. The Local
// profile folder as a whole can also contain site storage (IndexedDB/
// localStorage) that isn't really "cache" in the everyday sense, and the
// actual profile identity/bookmarks/logins live entirely under Roaming, not
// here. Only clearing these specific subfolders avoids deleting anything
// beyond what a "clear cache" action should touch.
const FIREFOX_CACHE_FOLDER_NAMES = ['cache2', 'startupCache', 'shader-cache', 'OfflineCache'];

function clearFirefoxCache(profilesRoot, log) {
  let freed = 0;
  let deleted = 0;
  let skipped = 0;

  let profileDirs;
  try {
    profileDirs = fs.readdirSync(profilesRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (err) {
    return { freed, deleted, skipped };
  }

  for (const profile of profileDirs) {
    for (const folderName of FIREFOX_CACHE_FOLDER_NAMES) {
      const target = path.join(profilesRoot, profile.name, folderName);
      if (fs.existsSync(target)) {
        const result = emptyDirContents(target, log);
        freed += result.freed;
        deleted += result.deleted;
        skipped += result.skipped;
      }
    }
  }

  return { freed, deleted, skipped };
}

module.exports = async function clearBrowserCache(args = {}) {
  // An empty/omitted browsers list means "clear everything found" -- the
  // UI's "Clear All" action relies on this rather than needing to know the
  // exact candidate list itself.
  const requested = Array.isArray(args.browsers) && args.browsers.length
    ? args.browsers
    : CANDIDATES.map((c) => c.name);

  const log = [];
  const results = [];

  for (const candidate of CANDIDATES) {
    if (!requested.includes(candidate.name)) continue;

    if (!fs.existsSync(candidate.path)) {
      results.push({ name: candidate.name, cleared: false, freedMB: 0, note: 'Not found.' });
      continue;
    }

    const outcome = candidate.name === 'Firefox'
      ? clearFirefoxCache(candidate.path, log)
      : emptyDirContents(candidate.path, log);

    results.push({
      name: candidate.name,
      cleared: true,
      freedMB: +(outcome.freed / 1024 / 1024).toFixed(1),
      deletedCount: outcome.deleted,
      skippedCount: outcome.skipped
    });
  }

  const totalMB = +(results.reduce((sum, r) => sum + (r.freedMB || 0), 0)).toFixed(1);

  return {
    totalMB,
    browsers: results,
    log: log.slice(0, 30),
    note: 'Close browsers before clearing for best results -- files still in use may be skipped.'
  };
};
