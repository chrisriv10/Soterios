// Read-only report of items configured to run at startup.
// Platform-aware: each OS stores this differently. This script never
// modifies anything — it only reports what it finds.

const { exec } = require('child_process');
const os = require('os');

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout);
    });
  });
}

module.exports = async function listStartupItems() {
  const platform = os.platform();
  const items = [];

  if (platform === 'darwin') {
    const out = await run('launchctl list');
    if (out) {
      out.split('\n').slice(1).forEach((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3 && parts[2] !== '-') {
          items.push({ name: parts[2], pid: parts[0], status: parts[1] });
        }
      });
    }
  } else if (platform === 'win32') {
    const out = await run('wmic startup get caption,command');
    if (out) {
      out.split('\n').slice(1).forEach((line) => {
        const trimmed = line.trim();
        if (trimmed) items.push({ raw: trimmed });
      });
    }
  } else {
    // Linux: check common autostart locations conceptually (best-effort)
    const out = await run('ls ~/.config/autostart 2>/dev/null');
    if (out) {
      out.split('\n').filter(Boolean).forEach((name) => items.push({ name }));
    }
  }

  return {
    platform,
    itemCount: items.length,
    items,
    note: 'This is a read-only report. No startup items were modified.'
  };
};
