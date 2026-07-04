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

module.exports = async function browserCacheReport() {
  const browsers = CANDIDATES.map((c) => { const bytes = dirSize(c.path); return { name: c.name, path: c.path, exists: fs.existsSync(c.path), sizeMB: +(bytes / 1024 / 1024).toFixed(1) }; });
  return { totalMB: +((browsers.reduce((sum, b) => sum + b.sizeMB, 0))).toFixed(1), browsers };
};

module.exports.CANDIDATES = CANDIDATES;