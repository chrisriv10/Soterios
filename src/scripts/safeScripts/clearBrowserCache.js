'use strict';

const fs = require('fs');
const path = require('path');
const { discoverBrowserCaches } = require('./browserCacheReport');
const { isInside } = require('../../core/pathSafety');

function emptyDirContents(dirPath) {
  let freedBytes = 0;
  let deletedCount = 0;
  const skipped = [];
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch (error) { return { freedBytes, deletedCount, skipped: [{ path: dirPath, reason: error.message }] }; }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isSymbolicLink()) { skipped.push({ path: fullPath, reason: 'reparse-point' }); continue; }
    if (entry.isDirectory()) {
      const result = emptyDirContents(fullPath);
      freedBytes += result.freedBytes;
      deletedCount += result.deletedCount;
      skipped.push(...result.skipped);
      try { if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath); } catch (_) {}
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const size = fs.statSync(fullPath).size;
      fs.unlinkSync(fullPath);
      freedBytes += size;
      deletedCount += 1;
    } catch (error) {
      skipped.push({ path: fullPath, reason: error.message });
    }
  }
  return { freedBytes, deletedCount, skipped };
}

module.exports = async function clearBrowserCache(args = {}, onProgress) {
  const browsers = await discoverBrowserCaches();
  const requested = Array.isArray(args.browsers) && args.browsers.length
    ? new Set(args.browsers.map((value) => String(value).toLowerCase()))
    : null;
  const selected = browsers.filter((browser) => browser.exists && (!requested || requested.has(browser.id.toLowerCase()) || requested.has(browser.name.toLowerCase())));
  const results = [];
  let processed = 0;
  const total = selected.reduce((sum, browser) => sum + browser.profiles.reduce((value, profile) => value + profile.cachePaths.length, 0), 0);
  for (const browser of selected) {
    const outcome = { id: browser.id, name: browser.name, running: browser.running, freedBytes: 0, deletedCount: 0, skipped: [] };
    for (const profile of browser.profiles) {
      for (const cachePath of profile.cachePaths) {
        processed += 1;
        if (!isInside(cachePath, browser.root)) {
          outcome.skipped.push({ path: cachePath, reason: 'outside-browser-root' });
          continue;
        }
        const result = emptyDirContents(cachePath);
        outcome.freedBytes += result.freedBytes;
        outcome.deletedCount += result.deletedCount;
        outcome.skipped.push(...result.skipped);
        onProgress?.({
          phase: 'cleaning', label: `Clearing ${browser.name} cache`, count: processed, total,
          pct: Math.round((processed / Math.max(total, 1)) * 100), currentActivity: cachePath, cancelable: true
        });
      }
    }
    outcome.freedMB = +(outcome.freedBytes / 1024 / 1024).toFixed(1);
    results.push(outcome);
  }
  const totalBytes = results.reduce((sum, result) => sum + result.freedBytes, 0);
  return {
    totalBytes,
    totalMB: +(totalBytes / 1024 / 1024).toFixed(1),
    deletedCount: results.reduce((sum, result) => sum + result.deletedCount, 0),
    skippedCount: results.reduce((sum, result) => sum + result.skipped.length, 0),
    browsers: results,
    note: results.some((result) => result.running)
      ? 'Some browsers were running, so locked cache files were skipped.'
      : 'Only browser cache folders were cleared.'
  };
};

module.exports.emptyDirContents = emptyDirContents;
