const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HeuristicEngine = require('../src/security/HeuristicEngine');

describe('HeuristicEngine.analyze', () => {
  const engine = new HeuristicEngine();
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-heuristic-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns score 0 for files larger than 50 MB', async () => {
    const filePath = path.join(tempDir, 'large.bin');
    const fd = fs.openSync(filePath, 'w');
    try {
      fs.ftruncateSync(fd, 50 * 1024 * 1024 + 1);
    } finally {
      fs.closeSync(fd);
    }

    const result = await engine.analyze(filePath);
    assert.deepEqual(result, { score: 0, signals: [] });
  });

  it('flags high-entropy content', async () => {
    const filePath = path.join(tempDir, 'packed.bin');
    const highEntropy = Buffer.alloc(8192);
    for (let i = 0; i < highEntropy.length; i++) {
      highEntropy[i] = i % 256;
    }
    fs.writeFileSync(filePath, highEntropy);

    const result = await engine.analyze(filePath);
    assert.ok(result.score > 0);
    assert.ok(result.signals.some((signal) => signal.message.includes('entropy')));
  });

  it('flags PE header in non-executable extension', async () => {
    const filePath = path.join(tempDir, 'invoice.pdf');
    const payload = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(256, 0x41)]);
    fs.writeFileSync(filePath, payload);

    const result = await engine.analyze(filePath);
    assert.ok(result.signals.some((signal) => signal.message.includes('PE executable header')));
    assert.ok(result.score >= 35);
  });
});
