'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const { extractZipSecurely, isInside, assertNoSymlinkOrReparse } = require('./secure-zip-extract');

const CLAMAV_URL = 'https://github.com/Cisco-Talos/clamav/releases/download/clamav-1.5.2/clamav-1.5.2.win.x64.zip';
const CLAMAV_SHA256 = '6f868ed7a7e5a15aced82c53a4fa9f3f42fa9d7f7de14a606ba8db0756518eed';
const REQUIRED_BINARIES = ['clamscan.exe', 'freshclam.exe'];
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const TARGET_DIR = path.join(ASSETS_DIR, 'clamav');
// Legacy fixed download path from before the secure-extraction fix. It is only
// ever removed (rm of a symlink removes the link itself), never written to.
const LEGACY_ZIP_PATH = path.join(ASSETS_DIR, 'clamav.zip');
const DOWNLOAD_TIMEOUT_MS = 120000;

// The pinned archive only ships Windows binaries, so downloading it on other
// platforms is wasted work for contributors. SOTERIOS_SKIP_CLAMAV=1 always
// skips the bootstrap (offline or minimal installs) and
// SOTERIOS_FORCE_CLAMAV=1 forces the download anyway, e.g. when assembling a
// Windows package from a non-Windows host.
const SKIP_ENV_VAR = 'SOTERIOS_SKIP_CLAMAV';
const FORCE_ENV_VAR = 'SOTERIOS_FORCE_CLAMAV';
const PACKAGE_PLATFORM = 'win32';
const MAX_DOWNLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

const TRUTHY_FLAG_VALUES = new Set(['1', 'true', 'yes']);

// Network failures worth retrying: resets, refused/aborted connections,
// DNS hiccups, timeouts, rate limiting, and server-side 5xx responses.
// Checksum mismatches and local filesystem errors are deliberately absent —
// a tampered or corrupt archive must fail fast rather than be retried into
// acceptance.
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ERR_NETWORK',
  'ERR_BAD_RESPONSE'
]);

function envFlagEnabled(env, name) {
  return TRUTHY_FLAG_VALUES.has(String(env[name] || '').trim().toLowerCase());
}

// Returns a human-readable reason when the download should be skipped, or
// null when it should proceed.
function downloadSkipReason(env = process.env, platform = process.platform) {
  if (envFlagEnabled(env, SKIP_ENV_VAR)) {
    return `${SKIP_ENV_VAR} is set`;
  }
  if (platform !== PACKAGE_PLATFORM && !envFlagEnabled(env, FORCE_ENV_VAR)) {
    return `the pinned ClamAV archive only contains Windows binaries (platform: ${platform}; set ${FORCE_ENV_VAR}=1 to download anyway)`;
  }
  return null;
}

function isTransientDownloadError(err) {
  if (!err) return false;
  if (err.isAxiosError) {
    if (!err.response) return true;
    return err.response.status === 429 || err.response.status >= 500;
  }
  return TRANSIENT_ERROR_CODES.has(err.code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyChecksum(filePath, expectedDigest) {
  const digest = await sha256File(filePath);
  if (digest.toLowerCase() !== String(expectedDigest).toLowerCase()) {
    throw new Error(`ClamAV archive checksum mismatch (expected ${expectedDigest}, got ${digest})`);
  }
  return digest;
}

function assertSafeDir(pathToCheck, label) {
  const resolved = path.resolve(pathToCheck);
  let st;
  try {
    st = fs.lstatSync(resolved);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`${label} is a symlink: ${resolved}`);
  }
  // Reparse points/junctions are not symlinks to lstat: reject those too
  // where Node exposes them (Windows).
  assertNoSymlinkOrReparse(resolved);
}

function createSecureStagingDir(parentDir) {
  fs.mkdirSync(parentDir, { recursive: true });
  assertSafeDir(parentDir, 'Staging parent');
  const staging = fs.mkdtempSync(path.join(parentDir, '.clamav-staging-'));
  try {
    fs.chmodSync(staging, 0o700);
  } catch (_) {
    // Windows ACLs ignore POSIX modes; random suffix already isolates the dir.
  }
  return staging;
}

function createUniqueBackupPath(parentDir, baseName) {
  const suffix = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  return path.join(parentDir, `${baseName}.bak-${suffix}`);
}

function flattenExtractedDir(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const entries = fs.readdirSync(resolvedRoot);
  for (const entry of entries) {
    const entryPath = path.join(resolvedRoot, entry);
    let st;
    try {
      st = fs.lstatSync(entryPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing to flatten symlink: ${entryPath}`);
    }
    assertNoSymlinkOrReparse(entryPath);
    if (!st.isDirectory()) continue;
    for (const file of fs.readdirSync(entryPath)) {
      const src = path.join(entryPath, file);
      const dst = path.join(resolvedRoot, file);
      if (!isInside(src, resolvedRoot) || !isInside(dst, resolvedRoot)) {
        throw new Error('Flatten target escapes extraction root');
      }
      let srcStat;
      try {
        srcStat = fs.lstatSync(src);
      } catch (err) {
        if (err && err.code === 'ENOENT') continue;
        throw err;
      }
      if (srcStat.isSymbolicLink()) {
        throw new Error(`Refusing to flatten symlink: ${src}`);
      }
      assertNoSymlinkOrReparse(src);
      let dstStat = null;
      try {
        dstStat = fs.lstatSync(dst);
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
      if (dstStat) {
        if (dstStat.isSymbolicLink()) {
          throw new Error(`Refusing to overwrite symlink: ${dst}`);
        }
        continue;
      }
      fs.renameSync(src, dst);
    }
    fs.rmdirSync(entryPath);
  }
}

function validateInstall(dir) {
  for (const binary of REQUIRED_BINARIES) {
    const binaryPath = path.join(dir, binary);
    let st = null;
    try {
      st = fs.lstatSync(binaryPath);
    } catch (_) {
      st = null;
    }
    if (!st || st.isSymbolicLink() || !st.isFile()) {
      throw new Error(`Missing required ClamAV binary: ${binary}`);
    }
  }
}

function restoreBackupIfNeeded(backupDir, backupCreated, targetDir = TARGET_DIR) {
  if (!backupCreated || !backupDir || !fs.existsSync(backupDir)) return;
  if (!fs.existsSync(targetDir)) {
    fs.renameSync(backupDir, targetDir);
    return;
  }
  removePath(backupDir);
}

async function installStagedArchive(stagedZipPath, options = {}) {
  const targetDir = options.targetDir || TARGET_DIR;
  const stagingParent = options.stagingParent || path.dirname(path.resolve(targetDir));
  const expectedSha256 = options.expectedSha256 || CLAMAV_SHA256;

  // Verify digest BEFORE any extraction or install. A mismatch never touches
  // the current installation.
  await verifyChecksum(stagedZipPath, expectedSha256);

  const stagingRoot = options.stagingRoot || createSecureStagingDir(stagingParent);
  const createdStaging = !options.stagingRoot;
  const extractDir = path.join(stagingRoot, 'extract');
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }
  let backupDir = null;
  let backupCreated = false;
  let extractMoved = false;

  try {
    console.log('Extracting ClamAV...');
    extractZipSecurely(stagedZipPath, extractDir);
    flattenExtractedDir(extractDir);
    validateInstall(extractDir);

    if (fs.existsSync(targetDir)) {
      assertSafeDir(targetDir, 'Current install');
      backupDir = options.backupDir || createUniqueBackupPath(stagingParent, path.basename(targetDir));
      if (fs.existsSync(backupDir)) {
        assertSafeDir(backupDir, 'Backup path');
        removePath(backupDir);
      }
      fs.renameSync(targetDir, backupDir);
      backupCreated = true;
    }

    try {
      fs.renameSync(extractDir, targetDir);
      extractMoved = true;
    } catch (swapErr) {
      restoreBackupIfNeeded(backupDir, backupCreated, targetDir);
      backupCreated = false;
      throw swapErr;
    }

    if (backupCreated && backupDir && fs.existsSync(backupDir)) {
      try {
        removePath(backupDir);
      } catch (cleanupErr) {
        console.warn(`Failed to remove old ClamAV backup at ${backupDir}: ${cleanupErr.message}`);
      }
      backupCreated = false;
    }

    return { targetDir, backupCleaned: !backupCreated };
  } catch (err) {
    if (!extractMoved) {
      try {
        removePath(extractDir);
      } catch (_) {}
    } else if (fs.existsSync(targetDir)) {
      // Swap succeeded but later cleanup failed; leave the new install in place.
    }
    restoreBackupIfNeeded(backupDir, backupCreated, targetDir);
    throw err;
  } finally {
    if (createdStaging) {
      try {
        removePath(stagingRoot);
      } catch (_) {}
    }
  }
}

function hasCompleteInstall(dir) {
  return fs.existsSync(dir) &&
    REQUIRED_BINARIES.every((binary) => fs.existsSync(path.join(dir, binary)));
}

async function downloadClamAV({ log = console.log } = {}) {
  if (hasCompleteInstall(TARGET_DIR)) {
    log('ClamAV already downloaded.');
    return;
  }

  log(`Downloading ClamAV from ${CLAMAV_URL}...`);
  const stagingRoot = createSecureStagingDir(ASSETS_DIR);
  const stagedZipPath = path.join(stagingRoot, 'clamav.zip');

  try {
    const response = await axios({
      url: CLAMAV_URL,
      method: 'GET',
      responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });

    // 'wx' fails closed if the staging file already exists instead of
    // truncating through a pre-planted link; the staging name itself is random.
    const writer = fs.createWriteStream(stagedZipPath, { mode: 0o600, flags: 'wx' });
    await pipeline(response.data, writer);

    // installStagedArchive reuses the same staging root so the verified
    // archive and the extraction directory stay on one filesystem (atomic
    // rename into assets/) and are cleaned up together.
    await installStagedArchive(stagedZipPath, {
      targetDir: TARGET_DIR,
      stagingParent: ASSETS_DIR,
      stagingRoot,
      expectedSha256: CLAMAV_SHA256,
    });

    try {
      removePath(stagingRoot);
    } catch (_) {}
    try {
      removePath(LEGACY_ZIP_PATH);
    } catch (_) {}
    log('ClamAV downloaded and extracted successfully.');
  } catch (err) {
    try {
      removePath(stagingRoot);
    } catch (_) {}
    try {
      removePath(LEGACY_ZIP_PATH);
    } catch (_) {}
    // Rollback of an existing install (if any) is handled inside
    // installStagedArchive; a download/verify failure never touches TARGET_DIR.
    throw err;
  }
}

// Retries the download a small number of times for transient network
// failures. Verification failures (checksum, missing binaries) are not
// transient and propagate immediately.
async function downloadClamAVWithRetry({ log = console.log, sleepFn = sleep, downloadFn = downloadClamAV } = {}) {
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await downloadFn({ log });
      return;
    } catch (err) {
      if (!isTransientDownloadError(err) || attempt === MAX_DOWNLOAD_ATTEMPTS) {
        throw err;
      }
      const delayMs = RETRY_DELAY_MS * attempt;
      log(`ClamAV download attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed (${err.message}). Retrying in ${delayMs}ms...`);
      await sleepFn(delayMs);
    }
  }
}

async function run({ env = process.env, platform = process.platform, log = console.log } = {}) {
  const skipReason = downloadSkipReason(env, platform);
  if (skipReason) {
    log(`Skipping ClamAV download: ${skipReason}.`);
    return;
  }
  await downloadClamAVWithRetry({ log });
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  CLAMAV_URL,
  CLAMAV_SHA256,
  REQUIRED_BINARIES,
  TARGET_DIR,
  ASSETS_DIR,
  LEGACY_ZIP_PATH,
  ZIP_PATH: LEGACY_ZIP_PATH,
  DOWNLOAD_TIMEOUT_MS,
  SKIP_ENV_VAR,
  FORCE_ENV_VAR,
  PACKAGE_PLATFORM,
  MAX_DOWNLOAD_ATTEMPTS,
  RETRY_DELAY_MS,
  envFlagEnabled,
  downloadSkipReason,
  isTransientDownloadError,
  removePath,
  sha256File,
  verifyChecksum,
  createSecureStagingDir,
  createUniqueBackupPath,
  flattenExtractedDir,
  validateInstall,
  hasCompleteInstall,
  restoreBackupIfNeeded,
  installStagedArchive,
  downloadClamAV,
  downloadClamAVWithRetry,
  run
};
