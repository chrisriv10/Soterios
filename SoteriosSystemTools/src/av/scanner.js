// Lightweight local signature scanner.
//
// This is NOT a replacement for real antivirus software. It does exactly
// two things, transparently:
//   1. Hashes files (SHA-256) and compares against a local JSON signature
//      database (src/av/signatureDB.json) that the user controls/updates.
//   2. Flags files with simple heuristics (suspicious location, suspicious
//      extension, abnormally high entropy) as "suspicious" for human review.
//
// It never auto-deletes anything. Quarantine is an explicit, reversible
// move-to-folder action triggered by the user.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const SIGNATURE_DB_PATH = path.join(__dirname, 'signatureDB.json');
const QUARANTINE_DIR = path.join(os.homedir(), '.soterios-quarantine');

const SUSPICIOUS_EXTENSIONS = new Set([
  '.scr', '.pif', '.vbs', '.js', '.jse', '.wsf', '.hta', '.cpl'
]);

function loadSignatureDB() {
  try {
    const raw = fs.readFileSync(SIGNATURE_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.signatures || [];
  } catch (err) {
    console.error('[scanner] Failed to load signature DB:', err);
    return [];
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Shannon entropy over byte distribution — a crude packer/encryption signal.
// Most legitimate executables sit well below ~7.5; fully packed/encrypted
// payloads often approach 8 (the theoretical max for byte data).
function calculateEntropy(buffer) {
  if (buffer.length === 0) return 0;
  const freq = new Array(256).fill(0);
  for (const byte of buffer) freq[byte]++;
  let entropy = 0;
  for (const count of freq) {
    if (count === 0) continue;
    const p = count / buffer.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function runHeuristics(filePath, sampleBuffer) {
  const flags = [];
  const ext = path.extname(filePath).toLowerCase();
  const normalizedPath = filePath.toLowerCase();

  if (SUSPICIOUS_EXTENSIONS.has(ext)) {
    flags.push(`Suspicious extension (${ext})`);
  }

  const tempIndicators = ['\\temp\\', '/tmp/', '\\appdata\\local\\temp', '/var/tmp/'];
  if (tempIndicators.some((t) => normalizedPath.includes(t))) {
    flags.push('Running/located in a temp directory');
  }

  if (sampleBuffer && sampleBuffer.length > 0) {
    const entropy = calculateEntropy(sampleBuffer);
    if (entropy > 7.5) {
      flags.push(`High entropy (${entropy.toFixed(2)}/8.0) — possibly packed or encrypted`);
    }
  }

  return flags;
}

async function scanFile(filePath, signatures) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return { path: filePath, status: 'error', error: 'Could not stat file' };
  }

  if (!stat.isFile()) {
    return { path: filePath, status: 'skipped', reason: 'Not a regular file' };
  }

  // Cap how much we read for entropy sampling on huge files (perf)
  const MAX_SAMPLE_BYTES = 2 * 1024 * 1024; // 2MB
  let sampleBuffer = Buffer.alloc(0);
  try {
    const fd = fs.openSync(filePath, 'r');
    const size = Math.min(stat.size, MAX_SAMPLE_BYTES);
    sampleBuffer = Buffer.alloc(size);
    fs.readSync(fd, sampleBuffer, 0, size, 0);
    fs.closeSync(fd);
  } catch (err) {
    // non-fatal; heuristics will just skip entropy
  }

  let hash;
  try {
    hash = await hashFile(filePath);
  } catch (err) {
    return { path: filePath, status: 'error', error: 'Could not read/hash file' };
  }

  const match = signatures.find((sig) => sig.hash.toLowerCase() === hash.toLowerCase());
  if (match) {
    return {
      path: filePath,
      status: 'match',
      hash,
      sizeBytes: stat.size,
      signatureName: match.name
    };
  }

  const heuristicFlags = runHeuristics(filePath, sampleBuffer);
  if (heuristicFlags.length > 0) {
    return {
      path: filePath,
      status: 'suspicious',
      hash,
      sizeBytes: stat.size,
      flags: heuristicFlags
    };
  }

  return { path: filePath, status: 'clean', hash, sizeBytes: stat.size };
}

function walkDirectory(dirPath, onFile, options = {}) {
  const maxDepth = options.maxDepth ?? 12;

  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      return; // permission denied etc — skip silently
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        onFile(fullPath);
      }
    }
  }

  walk(dirPath, 0);
}

function quarantineFile(filePath) {
  if (!fs.existsSync(QUARANTINE_DIR)) {
    fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
  }
  const destName = `${Date.now()}_${path.basename(filePath)}`;
  const dest = path.join(QUARANTINE_DIR, destName);
  fs.renameSync(filePath, dest);
  return dest;
}

module.exports = {
  loadSignatureDB,
  hashFile,
  scanFile,
  walkDirectory,
  quarantineFile,
  QUARANTINE_DIR
};
