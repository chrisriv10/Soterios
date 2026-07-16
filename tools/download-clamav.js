const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const AdmZip = require('adm-zip');

const CLAMAV_URL = 'https://github.com/Cisco-Talos/clamav/releases/download/clamav-1.5.2/clamav-1.5.2.win.x64.zip';
const CLAMAV_SHA256 = '6f868ed7a7e5a15aced82c53a4fa9f3f42fa9d7f7de14a606ba8db0756518eed';
const REQUIRED_BINARIES = ['clamscan.exe', 'freshclam.exe'];
const TARGET_DIR = path.join(__dirname, '..', 'assets', 'clamav');
const ZIP_PATH = path.join(__dirname, '..', 'assets', 'clamav.zip');
const DOWNLOAD_TIMEOUT_MS = 120000;

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

function flattenExtractedDir(rootDir) {
  const entries = fs.readdirSync(rootDir);
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;
    for (const file of fs.readdirSync(entryPath)) {
      const src = path.join(entryPath, file);
      const dst = path.join(rootDir, file);
      if (!fs.existsSync(dst)) {
        fs.renameSync(src, dst);
      }
    }
    fs.rmdirSync(entryPath);
  }
}

function validateInstall(dir) {
  for (const binary of REQUIRED_BINARIES) {
    const binaryPath = path.join(dir, binary);
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Missing required ClamAV binary: ${binary}`);
    }
  }
}

function restoreBackupIfNeeded(backupDir, backupCreated) {
  if (!backupCreated || !fs.existsSync(backupDir)) return;
  if (!fs.existsSync(TARGET_DIR)) {
    fs.renameSync(backupDir, TARGET_DIR);
    return;
  }
  removePath(backupDir);
}

async function downloadClamAV() {
  if (fs.existsSync(TARGET_DIR) && fs.existsSync(path.join(TARGET_DIR, 'clamscan.exe'))) {
    console.log('ClamAV already downloaded.');
    return;
  }

  console.log(`Downloading ClamAV from ${CLAMAV_URL}...`);
  fs.mkdirSync(path.join(__dirname, '..', 'assets'), { recursive: true });

  const tempDir = `${TARGET_DIR}.tmp-${process.pid}`;
  const backupDir = `${TARGET_DIR}.bak-${process.pid}`;
  let backupCreated = false;

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

    const writer = fs.createWriteStream(ZIP_PATH);
    await pipeline(response.data, writer);

    const digest = await sha256File(ZIP_PATH);
    if (digest !== CLAMAV_SHA256) {
      throw new Error(`ClamAV archive checksum mismatch (expected ${CLAMAV_SHA256}, got ${digest})`);
    }

    removePath(tempDir);
    fs.mkdirSync(tempDir, { recursive: true });

    console.log('Extracting ClamAV...');
    const zip = new AdmZip(ZIP_PATH);
    zip.extractAllTo(tempDir, true);
    flattenExtractedDir(tempDir);
    validateInstall(tempDir);

    if (fs.existsSync(TARGET_DIR)) {
      fs.renameSync(TARGET_DIR, backupDir);
      backupCreated = true;
    }

    try {
      fs.renameSync(tempDir, TARGET_DIR);
    } catch (swapErr) {
      restoreBackupIfNeeded(backupDir, backupCreated);
      backupCreated = false;
      throw swapErr;
    }

    if (backupCreated && fs.existsSync(backupDir)) {
      try {
        removePath(backupDir);
      } catch (cleanupErr) {
        console.warn(`Failed to remove old ClamAV backup at ${backupDir}: ${cleanupErr.message}`);
      }
      backupCreated = false;
    }

    removePath(ZIP_PATH);
    console.log('ClamAV downloaded and extracted successfully.');
  } catch (err) {
    removePath(tempDir);
    removePath(ZIP_PATH);
    restoreBackupIfNeeded(backupDir, backupCreated);
    throw err;
  }
}

downloadClamAV().catch((err) => {
  console.error(err);
  process.exit(1);
});
