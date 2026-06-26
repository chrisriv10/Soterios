const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');

const CLAMAV_URL = 'https://github.com/Cisco-Talos/clamav/releases/download/clamav-1.5.2/clamav-1.5.2.win.x64.zip';
const TARGET_DIR = path.join(__dirname, '..', 'assets', 'clamav');
const ZIP_PATH = path.join(__dirname, '..', 'assets', 'clamav.zip');

async function downloadClamAV() {
  if (fs.existsSync(TARGET_DIR) && fs.existsSync(path.join(TARGET_DIR, 'clamscan.exe'))) {
    console.log('ClamAV already downloaded.');
    return;
  }

  console.log(`Downloading ClamAV from ${CLAMAV_URL}...`);
  fs.mkdirSync(path.join(__dirname, '..', 'assets'), { recursive: true });

  const response = await axios({
    url: CLAMAV_URL,
    method: 'GET',
    responseType: 'stream',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    }
  });

  const writer = fs.createWriteStream(ZIP_PATH);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  console.log('Extracting ClamAV...');
  const zip = new AdmZip(ZIP_PATH);
  zip.extractAllTo(TARGET_DIR, true);

  // The zip extracts into a subfolder like clamav-1.5.2.win.x64
  // Move the contents up one level for easier access
  const entries = fs.readdirSync(TARGET_DIR);
  for (const entry of entries) {
    const entryPath = path.join(TARGET_DIR, entry);
    if (fs.statSync(entryPath).isDirectory()) {
      const files = fs.readdirSync(entryPath);
      for (const file of files) {
        const src = path.join(entryPath, file);
        const dst = path.join(TARGET_DIR, file);
        if (!fs.existsSync(dst)) {
          fs.renameSync(src, dst);
        }
      }
      fs.rmdirSync(entryPath);
    }
  }

  fs.unlinkSync(ZIP_PATH);
  console.log('ClamAV downloaded and extracted successfully.');
}

downloadClamAV().catch(console.error);
