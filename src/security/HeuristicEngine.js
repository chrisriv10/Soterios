const fs = require('fs');
const path = require('path');

const MAX_ANALYZE_BYTES = 50 * 1024 * 1024;
const SAMPLE_BYTES = 1024 * 1024;
const HIGH_ENTROPY_THRESHOLD = 7.2;

const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.dll', '.scr', '.com', '.bat', '.cmd', '.msi', '.ps1', '.vbs', '.js', '.jar', '.sys'
]);

function shannonEntropy(buffer) {
  if (!buffer.length) return 0;
  const freq = new Uint32Array(256);
  for (const byte of buffer) freq[byte]++;
  let entropy = 0;
  const len = buffer.length;
  for (let i = 0; i < 256; i++) {
    if (freq[i] === 0) continue;
    const p = freq[i] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

class HeuristicEngine {
  constructor() {}

  async analyze(filePath) {
    const empty = { score: 0, signals: [] };
    if (!filePath || typeof filePath !== 'string') return empty;

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_) {
      return empty;
    }

    if (!stat.isFile() || stat.size > MAX_ANALYZE_BYTES) return empty;

    const bytesToRead = Math.min(stat.size, SAMPLE_BYTES);
    let sample;
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buffer = Buffer.alloc(bytesToRead);
        const read = fs.readSync(fd, buffer, 0, bytesToRead, 0);
        sample = buffer.subarray(0, read);
      } finally {
        fs.closeSync(fd);
      }
    } catch (_) {
      return empty;
    }

    const signals = [];
    const entropy = shannonEntropy(sample);
    if (entropy >= HIGH_ENTROPY_THRESHOLD) {
      signals.push({
        points: Math.min(40, Math.round((entropy - 7.0) * 50)),
        message: `High byte entropy (${entropy.toFixed(2)}) may indicate packing or encryption`
      });
    }

    if (sample.length >= 2 && sample[0] === 0x4d && sample[1] === 0x5a) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext && !EXECUTABLE_EXTENSIONS.has(ext)) {
        signals.push({
          points: 35,
          message: `PE executable header found in ${ext} file`
        });
      }
    }

    const score = Math.min(100, signals.reduce((total, signal) => total + signal.points, 0));
    return { score, signals };
  }
}

module.exports = HeuristicEngine;
