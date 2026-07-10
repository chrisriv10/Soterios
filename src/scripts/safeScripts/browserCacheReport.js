const fs = require('fs');
const path = require('path');
const os = require('os');

function dirSize(dirPath) {
  let total = 0;
  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (err) { return; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      try { if (entry.isDirectory()) walk(fullPath); else if (entry.isFile()) total += fs.statSync(fullPath).size; } catch (err) {}
    }
  }
  if (fs.existsSync(dirPath)) walk(dirPath);
  return total;
}

const CANDIDATES = [
  { name: 'Chrome', path: path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data/Default/Cache') },
  { name: 'Edge', path: path.join(os.homedir(), 'AppData/Local/Microsoft/Edge/User Data/Default/Cache') },
  { name: 'Brave', path: path.join(os.homedir(), 'AppData/Local/BraveSoftware/Brave-Browser/User Data/Default/Cache') },
  { name: 'Firefox', path: path.join(os.homedir(), 'AppData/Local/Mozilla/Firefox/Profiles') }
];

module.exports = async function browserCacheReport(args = {}, onProgress) {
  const total = CANDIDATES.length;
  const browsers = [];
  for (let i = 0; i < CANDIDATES.length; i++) {
    const c = CANDIDATES[i];
    // Unlike the file-walk scripts, the total step count here is known
    // ahead of time (always 4 candidates), so this is real fractional
    // progress, not just a running count.
    onProgress?.({ label: `Checking ${c.name} cache`, count: i, total });
    const bytes = dirSize(c.path);
    browsers.push({ name: c.name, path: c.path, exists: fs.existsSync(c.path), sizeMB: +(bytes / 1024 / 1024).toFixed(1) });
    onProgress?.({ label: `Checked ${c.name} cache`, count: i + 1, total });
  }
  return { totalMB: +((browsers.reduce((sum, b) => sum + b.sizeMB, 0))).toFixed(1), browsers };
};

module.exports.CANDIDATES = CANDIDATES;