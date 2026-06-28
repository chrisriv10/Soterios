const { exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

function run(cmd) {
  return new Promise((resolve) => { exec(cmd, { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => { if (err) resolve(null); else resolve(stdout); }); });
}

function parseRegOutput(out) {
  const items = [];
  if (!out) return items;
  const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // reg query output often has lines like: "<Name>    REG_SZ    <Value>"
  for (const line of lines) {
    const m = line.match(/^([^\s].*?)\s+REG_\w+\s+(.*)$/i);
    if (m) items.push({ name: m[1].trim(), command: m[2].trim(), source: 'registry' });
  }
  return items;
}

module.exports = async function listStartupItems() {
  const platform = os.platform();
  const items = [];

  if (platform === 'darwin') {
    const out = await run('launchctl list');
    if (out) out.split('\n').slice(1).forEach((line) => { const parts = line.trim().split(/\s+/); if (parts.length >= 3 && parts[2] !== '-') items.push({ name: parts[2], pid: parts[0], status: parts[1], source: 'launchctl' }); });
  } else if (platform === 'win32') {
    // Check registry Run keys (HKLM and HKCU)
    const hklm = await run('reg query "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" 2>nul');
    const hkcu = await run('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" 2>nul');
    items.push(...parseRegOutput(hklm));
    items.push(...parseRegOutput(hkcu));

    // Also check Startup folders
    try {
      const appData = process.env.APPDATA || '';
      const programData = process.env.ProgramData || '';
      const userStartup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      const allStartup = path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      [ ['user', userStartup], ['all', allStartup] ].forEach(([scope, dir]) => {
        try {
          if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(file => items.push({ name: file, path: path.join(dir, file), scope, source: 'startup-folder' }));
          }
        } catch (_) { }
      });
    } catch (_) { }

    // Fallback: wmic if nothing found
    if (items.length === 0) {
      const out = await run('wmic startup get caption,command');
      if (out) out.split(/\r?\n/).slice(1).forEach((line) => { const trimmed = line.trim(); if (trimmed) items.push({ raw: trimmed, source: 'wmic' }); });
    }
  } else {
    const out = await run('ls ~/.config/autostart 2>/dev/null');
    if (out) out.split('\n').filter(Boolean).forEach((name) => items.push({ name, source: 'autostart' }));
  }

  return { platform, itemCount: items.length, items, note: 'This is a read-only report. No startup items were modified.' };
};
