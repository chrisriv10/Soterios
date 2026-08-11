'use strict';

/**
 * End-to-end smoke test for suspicious-connection alerts using real system
 * data: a real TCP connection (from this process) to a test IP, real
 * Get-NetTCPConnection output, the real BlocklistService match path, and the
 * real NetworkAlertMonitor poll/alert/notify pipeline.
 *
 * Skips (exit 0) when the test IP is unreachable, e.g. offline machines.
 * Run: npm run smoke:alerts
 */

const net = require('net');
const NetworkMonitor = require('../../src/security/NetworkMonitor');
const { BlocklistService } = require('../../src/security/BlocklistService');
const NetworkAlertMonitor = require('../../src/security/NetworkAlertMonitor');

// IPs that are virtually always reachable (Cloudflare / Google public DNS),
// each injected as a single /32 test range into the in-memory blocklist.
const TEST_TARGETS = [
  { host: '1.1.1.1', port: 443 },
  { host: '8.8.8.8', port: 443 }
];

function connectOnce({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(5000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('connect timeout')); });
    socket.once('error', reject);
  });
}

async function testSuspiciousConnectionAlert() {
  let target = null;
  for (const candidate of TEST_TARGETS) {
    try {
      await connectOnce(candidate);
      target = candidate;
      break;
    } catch (_) {
      // try next candidate
    }
  }
  if (!target) {
    console.log(`SKIPPED suspicious-connection alert: no test IP reachable (offline?) — tried ${TEST_TARGETS.map((t) => t.host + ':' + t.port).join(', ')}`);
    return;
  }

  const alerts = [];
  const notifications = [];
  const blocklist = new BlocklistService({
    getBlocklistCache: () => null,
    setBlocklistCache: () => {}
  });
  blocklist.parseAndStore('spamhaus-drop', `${target.host}/32\n`, 4);
  if (!blocklist.isListed(target.host)) {
    throw new Error(`test blocklist entry for ${target.host} did not take effect`);
  }

  const monitor = new NetworkAlertMonitor({
    networkMonitor: new NetworkMonitor(),
    blocklistService: blocklist,
    cooldownMs: 0,
    pollMs: 60_000,
    db: { addAlert: (severity, message) => alerts.push({ severity, message }) },
    notify: (title, body, level) => notifications.push({ title, body, level })
  });

  // Keep a live connection open while polling so Get-NetTCPConnection reports it.
  const socket = net.connect({ host: target.host, port: target.port });
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.setTimeout(8000);
      socket.once('timeout', () => reject(new Error('connect timeout')));
    });
    const hits = await monitor.poll();
    const expectedRemote = target.host;
    if (hits.length < 1) throw new Error(`expected at least 1 alert hit, got ${hits.length}`);
    const ownHit = hits.find((h) => h.remoteAddress === expectedRemote && h.pid);
    if (!ownHit) throw new Error(`expected a hit for ${expectedRemote} with a PID, got ${JSON.stringify(hits)}`);
    if (alerts.length < 1) throw new Error(`expected at least 1 db alert, got ${alerts.length}`);
    if (notifications.length < 1) throw new Error(`expected at least 1 notification, got ${notifications.length}`);
  } finally {
    socket.destroy();
  }
  console.log(`PASS suspicious-connection alert end to end (${target.host}:${target.port})`);
}

async function main() {
  await testSuspiciousConnectionAlert();
  console.log('All network alert smoke checks passed.');
}

main().catch((err) => {
  console.error('Network alert smoke check failed:', err);
  process.exit(1);
});
