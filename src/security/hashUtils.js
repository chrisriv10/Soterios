'use strict';

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

// Module-level cache keyed by "path|size|mtimeMs" so repeated hashing of
// unchanged files (e.g. the process viewer's 3s poll) is O(1) instead of
// re-reading every executable from disk.
const hashCache = new Map();
const CACHE_MAX_ENTRIES = 512;

function cacheKey(filePath, size, mtimeMs) {
  return `${filePath}|${size}|${mtimeMs}`;
}

/**
 * Hashes a file with SHA-256 asynchronously, streaming it in chunks so the
 * main process is never blocked by a large file.
 *
 * @param {string} filePath - Path to the file to hash.
 * @param {{ maxBytes?: number }} [options] - Optional size cap. Files larger
 *   than maxBytes are rejected (and never hashed).
 * @returns {Promise<string|null>} Hex SHA-256 digest, or null when the file
 *   is missing, unreadable, larger than maxBytes, or the cache already
 *   contains the exact same (path, size, mtimeMs) file.
 */
function hashFileStreaming(filePath, options = {}) {
  const maxBytes = typeof options.maxBytes === 'number' && options.maxBytes > 0
    ? options.maxBytes
    : DEFAULT_MAX_BYTES;

  return new Promise((resolve, reject) => {
    let stats;
    try {
      stats = fs.statSync(filePath);
    } catch (_) {
      resolve(null);
      return;
    }

    if (stats.size > maxBytes) {
      const err = new Error(`File too large for hash calculation (max ${Math.round(maxBytes / (1024 * 1024))}MB)`);
      err.code = 'HASH_FILE_TOO_LARGE';
      reject(err);
      return;
    }

    const key = cacheKey(filePath, stats.size, stats.mtimeMs);
    if (hashCache.has(key)) {
      resolve(hashCache.get(key));
      return;
    }

    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) {
        resolve(null);
      } else {
        reject(err);
      }
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const digest = hash.digest('hex');
      hashCache.set(key, digest);
      if (hashCache.size > CACHE_MAX_ENTRIES) {
        const oldestKey = hashCache.keys().next().value;
        hashCache.delete(oldestKey);
      }
      resolve(digest);
    });
  });
}

/**
 * Removes a single entry (e.g. after a trust/untrust action) so the next
 * hash reflects reality even if size+mtime are unchanged.
 */
function clearHashCache(filePath) {
  for (const key of hashCache.keys()) {
    if (key.startsWith(`${filePath}|`)) {
      hashCache.delete(key);
    }
  }
}

module.exports = { hashFileStreaming, clearHashCache };
