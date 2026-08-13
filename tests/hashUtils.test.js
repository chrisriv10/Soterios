'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { hashFileStreaming, clearHashCache } = require('../src/security/hashUtils');

function makeTempFile(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hashutils-'));
  const filePath = path.join(dir, 'sample.bin');
  const buf = crypto.randomBytes(bytes);
  fs.writeFileSync(filePath, buf);
  return { filePath, buf };
}

function cleanupTemp(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { }
}

describe('hashFileStreaming', () => {
  beforeEach(() => {
    clearHashCache('');
  });

  it('returns the same SHA-256 as hashing the whole buffer', async () => {
    const { filePath, buf } = makeTempFile(64 * 1024);
    try {
      const digest = await hashFileStreaming(filePath);
      const expected = crypto.createHash('sha256').update(buf).digest('hex');
      assert.equal(digest, expected);
    } finally {
      cleanupTemp(path.dirname(filePath));
    }
  });

  it('serves repeat calls for unchanged files from the cache', async () => {
    const { filePath } = makeTempFile(1024);
    try {
      const first = await hashFileStreaming(filePath);
      const second = await hashFileStreaming(filePath);
      assert.equal(second, first);
    } finally {
      cleanupTemp(path.dirname(filePath));
    }
  });

  it('rejects files larger than maxBytes without hashing them', async () => {
    const { filePath } = makeTempFile(1024);
    try {
      await assert.rejects(
        () => hashFileStreaming(filePath, { maxBytes: 512 }),
        (err) => err && err.code === 'HASH_FILE_TOO_LARGE'
      );
    } finally {
      cleanupTemp(path.dirname(filePath));
    }
  });

  it('resolves null for a missing or unreadable file', async () => {
    assert.equal(await hashFileStreaming(path.join(os.tmpdir(), 'does-not-exist-xyz.bin')), null);
  });

  it('re-hashes after clearHashCache even when size+mtime are unchanged', async () => {
    const { filePath, buf } = makeTempFile(1024);
    try {
      const first = await hashFileStreaming(filePath);
      assert.equal(await hashFileStreaming(filePath), first);

      clearHashCache(filePath);

      // Rewrite the file with identical size so the cache key would match.
      const sameSizeBuf = crypto.randomBytes(buf.length);
      fs.writeFileSync(filePath, sameSizeBuf);
      // Restore the original mtime so size+mtimeMs are identical to before.
      const st = fs.statSync(filePath);
      fs.utimesSync(filePath, st.atime, st.mtime);
      const second = await hashFileStreaming(filePath);
      assert.notEqual(second, first);
    } finally {
      cleanupTemp(path.dirname(filePath));
    }
  });
});