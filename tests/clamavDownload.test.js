'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  SKIP_ENV_VAR,
  FORCE_ENV_VAR,
  MAX_DOWNLOAD_ATTEMPTS,
  RETRY_DELAY_MS,
  envFlagEnabled,
  downloadSkipReason,
  isTransientDownloadError,
  downloadClamAVWithRetry,
  run
} = require('../tools/download-clamav');

function captureLog() {
  const lines = [];
  return { lines, log: (msg) => lines.push(String(msg)) };
}

describe('download-clamav skip rules', () => {
  it('skips when SOTERIOS_SKIP_CLAMAV=1, even on Windows', () => {
    const reason = downloadSkipReason({ [SKIP_ENV_VAR]: '1' }, 'win32');
    assert.match(reason, /SOTERIOS_SKIP_CLAMAV/);
  });

  it('accepts common truthy flag values and rejects falsy ones', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', ' 1 ']) {
      assert.equal(envFlagEnabled({ FLAG: value }, 'FLAG'), true, `expected ${value} to be truthy`);
    }
    for (const value of ['0', 'false', 'no', '', undefined]) {
      assert.equal(envFlagEnabled({ FLAG: value }, 'FLAG'), false, `expected ${value} to be falsy`);
    }
  });

  it('proceeds on Windows without any flag', () => {
    assert.equal(downloadSkipReason({}, 'win32'), null);
  });

  it('skips by default on non-Windows platforms', () => {
    for (const platform of ['linux', 'darwin']) {
      const reason = downloadSkipReason({}, platform);
      assert.match(reason, /Windows binaries/);
      assert.match(reason, new RegExp(FORCE_ENV_VAR));
    }
  });

  it('still downloads on non-Windows when SOTERIOS_FORCE_CLAMAV=1', () => {
    assert.equal(downloadSkipReason({ [FORCE_ENV_VAR]: '1' }, 'linux'), null);
  });

  it('skip flag wins over force flag', () => {
    const reason = downloadSkipReason({ [SKIP_ENV_VAR]: '1', [FORCE_ENV_VAR]: '1' }, 'linux');
    assert.match(reason, /SOTERIOS_SKIP_CLAMAV/);
  });

  it('run() logs a skip instead of downloading on non-Windows', async () => {
    const { lines, log } = captureLog();
    await run({ env: {}, platform: 'linux', log });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^Skipping ClamAV download:/);
  });

  it('run() honors SOTERIOS_SKIP_CLAMAV on Windows', async () => {
    const { lines, log } = captureLog();
    await run({ env: { [SKIP_ENV_VAR]: '1' }, platform: 'win32', log });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /SOTERIOS_SKIP_CLAMAV/);
  });
});

describe('download-clamav transient error detection', () => {
  it('treats network-level axios failures as transient', () => {
    assert.equal(isTransientDownloadError({ isAxiosError: true, code: 'ECONNABORTED' }), true);
    assert.equal(isTransientDownloadError({ isAxiosError: true, code: 'ERR_NETWORK' }), true);
  });

  it('treats 5xx and 429 responses as transient but not other statuses', () => {
    for (const status of [500, 502, 503, 429]) {
      assert.equal(isTransientDownloadError({ isAxiosError: true, response: { status } }), true, `expected ${status} transient`);
    }
    for (const status of [400, 403, 404]) {
      assert.equal(isTransientDownloadError({ isAxiosError: true, response: { status } }), false, `expected ${status} non-transient`);
    }
  });

  it('treats stream/socket error codes as transient', () => {
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE']) {
      assert.equal(isTransientDownloadError({ code }), true, `expected ${code} transient`);
    }
  });

  it('treats checksum mismatches and plain errors as non-transient', () => {
    assert.equal(isTransientDownloadError(new Error('ClamAV archive checksum mismatch (expected abc, got def)')), false);
    assert.equal(isTransientDownloadError(new Error('Missing required ClamAV binary: clamscan.exe')), false);
    assert.equal(isTransientDownloadError({ code: 'EACCES' }), false);
    assert.equal(isTransientDownloadError(null), false);
  });
});

describe('download-clamav retry behavior', () => {
  it('succeeds without retrying when the download works first try', async () => {
    let calls = 0;
    const { lines, log } = captureLog();
    await downloadClamAVWithRetry({
      log,
      sleepFn: async () => {},
      downloadFn: async () => { calls += 1; }
    });
    assert.equal(calls, 1);
    assert.equal(lines.length, 0);
  });

  it('retries transient failures and then succeeds', async () => {
    let calls = 0;
    const delays = [];
    const { lines, log } = captureLog();
    await downloadClamAVWithRetry({
      log,
      sleepFn: async (ms) => delays.push(ms),
      downloadFn: async () => {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error('socket hangup'), { code: 'ECONNRESET' });
      }
    });
    assert.equal(calls, 3);
    assert.deepEqual(delays, [RETRY_DELAY_MS, RETRY_DELAY_MS * 2]);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /attempt 1\//);
    assert.match(lines[1], /attempt 2\//);
  });

  it('gives up after MAX_DOWNLOAD_ATTEMPTS on persistent transient failures', async () => {
    let calls = 0;
    const delays = [];
    await assert.rejects(
      downloadClamAVWithRetry({
        log: () => {},
        sleepFn: async (ms) => delays.push(ms),
        downloadFn: async () => {
          calls += 1;
          throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        }
      }),
      /timeout/
    );
    assert.equal(calls, MAX_DOWNLOAD_ATTEMPTS);
    assert.equal(delays.length, MAX_DOWNLOAD_ATTEMPTS - 1);
  });

  it('does not retry non-transient failures such as checksum mismatches', async () => {
    let calls = 0;
    const delays = [];
    await assert.rejects(
      downloadClamAVWithRetry({
        log: () => {},
        sleepFn: async (ms) => delays.push(ms),
        downloadFn: async () => {
          calls += 1;
          throw new Error('ClamAV archive checksum mismatch (expected abc, got def)');
        }
      }),
      /checksum mismatch/
    );
    assert.equal(calls, 1);
    assert.equal(delays.length, 0);
  });
});
