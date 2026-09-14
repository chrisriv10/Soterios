'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const AdmZip = require('adm-zip');
const {
  extractZipSecurely,
  sanitizeEntryName,
  inflateRawLimited,
} = require('../tools/secure-zip-extract');
const dl = require('../tools/download-clamav');

// Raw ZIP builder so tests can craft exact entry names and metadata
// (adm-zip normalizes traversal names on creation, which would hide attacks).
// Supports central/local disagreements via explicit overrides.
function buildRawZip(files) {
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const method = f.method ?? 0;
    const flags = f.flags ?? 0x0800;
    const localMethod = f.localMethod ?? method;
    const localFlags = f.localFlags ?? flags;
    const nameBuf = Buffer.from(f.name, 'utf8');
    const localNameBuf = Buffer.from(f.localName ?? f.name, 'utf8');
    let payload;
    if (f.rawComp) {
      payload = Buffer.from(f.rawComp);
    } else if (method === 8) {
      payload = zlib.deflateRawSync(Buffer.from(f.data || ''));
    } else {
      payload = Buffer.from(f.data || '');
    }
    const uncompLen = f.rawComp
      ? (f.uncompLen ?? payload.length)
      : Buffer.from(f.data || '').length;
    const centralComp = f.centralCompSize ?? payload.length;
    const centralUncomp = f.centralUncompSize ?? uncompLen;
    const localComp = f.localCompSize ?? centralComp;
    const localUncomp = f.localUncompSize ?? centralUncomp;
    const localOffset = f.localOffset ?? offset;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(localFlags, 6);
    lh.writeUInt16LE(localMethod, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(0, 14);
    lh.writeUInt32LE(localComp, 18);
    lh.writeUInt32LE(localUncomp, 22);
    lh.writeUInt16LE(localNameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, localNameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(centralComp, 20);
    cd.writeUInt32LE(centralUncomp, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(f.externalAttr || 0, 38);
    cd.writeUInt32LE(localOffset, 42);
    centrals.push(cd, nameBuf);
    offset += lh.length + localNameBuf.length + payload.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of centrals) cdSize += c.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...centrals, eocd]);
}

function writeZip(p, buf) {
  fs.writeFileSync(p, buf);
}

describe('ClamAV secure extraction (Dependabot #51)', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-clamav-sec-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  });

  it('extracts into a clean temporary directory', () => {
    const zipPath = path.join(tmp, 'clean.zip');
    const zip = new AdmZip();
    zip.addFile('hello.txt', Buffer.from('hello world'));
    zip.addFile('sub/nested.txt', Buffer.from('nested content'));
    zip.writeZip(zipPath);

    const dest = path.join(tmp, 'out');
    fs.mkdirSync(dest);
    const result = extractZipSecurely(zipPath, dest);
    assert.equal(result.files, 2);
    assert.equal(fs.readFileSync(path.join(dest, 'hello.txt'), 'utf8'), 'hello world');
    assert.equal(fs.readFileSync(path.join(dest, 'sub', 'nested.txt'), 'utf8'), 'nested content');
  });

  it('rejects checksum mismatch before extraction', async () => {
    const zipPath = path.join(tmp, 'good.zip');
    const zip = new AdmZip();
    zip.addFile('clamscan.exe', Buffer.from('scan'));
    zip.addFile('freshclam.exe', Buffer.from('fresh'));
    zip.writeZip(zipPath);
    const goodHash = await dl.sha256File(zipPath);

    await assert.rejects(dl.verifyChecksum(zipPath, '00'.repeat(32)), /checksum mismatch/i);

    const assets = path.join(tmp, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    const target = path.join(assets, 'clamav');
    await assert.rejects(
      dl.installStagedArchive(zipPath, {
        targetDir: target,
        stagingParent: assets,
        expectedSha256: 'ff'.repeat(32),
      }),
      /checksum mismatch/i
    );
    assert.equal(fs.existsSync(target), false);
    // Good hash still installs.
    await dl.installStagedArchive(zipPath, {
      targetDir: target,
      stagingParent: assets,
      expectedSha256: goodHash,
    });
    assert.equal(fs.existsSync(path.join(target, 'clamscan.exe')), true);
  });

  it('does not follow a pre-existing destination symlink/junction', () => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');

    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest, { recursive: true });
    const linkPath = path.join(dest, 'link');
    // 'junction' works without admin on Windows and behaves as a dir symlink on POSIX.
    fs.symlinkSync(outside, linkPath, 'junction');

    const zipPath = path.join(tmp, 'attack.zip');
    const zip = new AdmZip();
    zip.addFile('link/pwned.txt', Buffer.from('pwned'));
    zip.writeZip(zipPath);

    assert.throws(() => extractZipSecurely(zipPath, dest), /symlink|reparse/i);
    assert.equal(fs.existsSync(path.join(outside, 'pwned.txt')), false);
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
    assert.equal(fs.existsSync(path.join(dest, 'link', 'pwned.txt')), false);
  });

  it('refuses to overwrite a final-path symlink', (t) => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'secret');

    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest, { recursive: true });
    try {
      fs.symlinkSync(secret, path.join(dest, 'victim.txt'));
    } catch (err) {
      t.diagnostic(`skipped file-symlink setup (needs privilege): ${err.message}`);
      return;
    }

    const zipPath = path.join(tmp, 'final.zip');
    const zip = new AdmZip();
    zip.addFile('victim.txt', Buffer.from('pwned'));
    zip.writeZip(zipPath);

    assert.throws(() => extractZipSecurely(zipPath, dest), /symlink|overwrite|existing/i);
    assert.equal(fs.readFileSync(secret, 'utf8'), 'secret');
  });

  it('rejects traversal and absolute entry names without writing outside', () => {
    const cases = ['../evil.txt', 'a/../../evil.txt', '/absolute.txt', 'C:/evil.txt', 'a//b.txt'];
    for (const name of cases) {
      assert.throws(() => sanitizeEntryName(name, 0), /Rejecting/i, `expected reject for ${name}`);
    }
    const zipPath = path.join(tmp, 'traversal.zip');
    writeZip(zipPath, buildRawZip([{ name: '../evil.txt', data: 'pwned' }]));
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    assert.throws(() => extractZipSecurely(zipPath, dest), /traversal|Rejecting/i);
    assert.equal(fs.existsSync(path.join(tmp, 'evil.txt')), false);
    assert.equal(fs.existsSync(path.join(dest, 'evil.txt')), false);
  });

  it('rejects backslash, UNC, drive and device-style paths', () => {
    const cases = [
      'a\\..\\..\\evil.txt',
      '\\absolute.txt',
      'C:\\evil.txt',
      'c:drive-relative.txt',
      '\\\\server\\share\\evil.txt',
      '//server/share/evil.txt',
      '\\\\?\\C:\\evil.txt',
    ];
    for (const name of cases) {
      assert.throws(() => sanitizeEntryName(name, 0), /Rejecting/i, `expected reject for ${name}`);
    }
    for (const [i, name] of cases.entries()) {
      const zipPath = path.join(tmp, `unc-${i}.zip`);
      writeZip(zipPath, buildRawZip([{ name, data: 'pwned' }]));
      const dest = path.join(tmp, `unc-dest-${i}`);
      fs.mkdirSync(dest);
      assert.throws(() => extractZipSecurely(zipPath, dest), /Rejecting/i, `expected extract reject for ${name}`);
    }
    assert.equal(fs.existsSync(path.join(tmp, 'evil.txt')), false);
  });

  it('rejects NTFS ADS names, reserved device names and trailing dot/space', () => {
    const cases = [
      'dir/file.txt:evil',
      'file:ads',
      'CON',
      'con.txt',
      'NUL',
      'COM1',
      'lpt9.dat',
      'AUX',
      'prn',
      'file.txt.',
      'name ',
      'dir /x.txt',
    ];
    for (const name of cases) {
      assert.throws(() => sanitizeEntryName(name, 0), /Rejecting/i, `expected reject for ${name}`);
    }
    const zipPath = path.join(tmp, 'ads.zip');
    writeZip(
      zipPath,
      buildRawZip([
        { name: 'dir/file.txt:evil', data: 'x' },
        { name: 'ok.txt', data: 'ok' },
      ])
    );
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    assert.throws(() => extractZipSecurely(zipPath, dest), /Rejecting/i);
    assert.equal(fs.existsSync(path.join(dest, 'ok.txt')), false);
  });

  it('rejects case-insensitive colliding entries', () => {
    const zipPath = path.join(tmp, 'collide.zip');
    writeZip(
      zipPath,
      buildRawZip([
        { name: 'A/file.txt', data: 'first' },
        { name: 'a/file.txt', data: 'second' },
      ])
    );
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    assert.throws(() => extractZipSecurely(zipPath, dest), /Colliding/i);
  });

  it('rejects archive symlink entries', () => {
    assert.throws(
      () => sanitizeEntryName('link', 0o120777 << 16),
      /symlink/i
    );
    const zipPath = path.join(tmp, 'symlink.zip');
    writeZip(
      zipPath,
      buildRawZip([{ name: 'link', data: '/etc/passwd', externalAttr: (0o120777 << 16) >>> 0 }])
    );
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    assert.throws(() => extractZipSecurely(zipPath, dest), /symlink/i);
    assert.equal(fs.existsSync(path.join(dest, 'link')), false);
  });

  it('rejects malformed and truncated archives without out-of-bounds reads', () => {
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    const bad = [
      ['empty', Buffer.alloc(0)],
      ['tiny', Buffer.from([1, 2, 3])],
      ['random', crypto.randomBytes(100)],
    ];
    for (const [label, buf] of bad) {
      const p = path.join(tmp, `${label}.zip`);
      writeZip(p, buf);
      assert.throws(() => extractZipSecurely(p, dest), /Invalid zip/, label);
    }
    const good = buildRawZip([{ name: 'a.txt', data: 'hi' }]);
    const trunc = path.join(tmp, 'trunc.zip');
    writeZip(trunc, good.subarray(0, Math.floor(good.length / 2)));
    assert.throws(() => extractZipSecurely(trunc, dest), /Invalid zip|end-of-central-directory/i);

    const cdOffset = good.readUInt32LE(good.length - 6);
    const cutCentral = path.join(tmp, 'cutcentral.zip');
    writeZip(cutCentral, good.subarray(0, cdOffset + 10));
    assert.throws(
      () => extractZipSecurely(cutCentral, dest),
      /Truncated central|end-of-central-directory/i
    );
  });

  it('rejects invalid local-header offsets', () => {
    const zipPath = path.join(tmp, 'badoff.zip');
    writeZip(zipPath, buildRawZip([{ name: 'a.txt', data: 'hi', localOffset: 99999 }]));
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    assert.throws(() => extractZipSecurely(zipPath, dest), /Truncated local header/i);
  });

  it('rejects central/local disagreements', () => {
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    const cases = [
      ['name mismatch', { name: 'good.txt', localName: 'evil.txt', data: 'x' }, /filename mismatch/i],
      ['method mismatch', { name: 'm.txt', data: 'x', localMethod: 8 }, /method mismatch/i],
      ['size mismatch', { name: 's.txt', data: 'abc', centralUncompSize: 100 }, /Size mismatch/i],
      [
        'central/local size disagreement',
        { name: 'd.txt', data: 'abc', centralUncompSize: 100, localUncompSize: 3 },
        /size mismatch/i,
      ],
    ];
    for (const [label, entry, re] of cases) {
      const p = path.join(tmp, `${label.replace(/\W+/g, '_')}.zip`);
      writeZip(p, buildRawZip([entry]));
      assert.throws(() => extractZipSecurely(p, dest), re, label);
    }
  });

  it('rejects unsupported compression, encryption and Zip64', () => {
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);

    const unsupported = path.join(tmp, 'unsupported.zip');
    writeZip(unsupported, buildRawZip([{ name: 'u.bin', data: 'x', method: 12, localMethod: 12 }]));
    assert.throws(() => extractZipSecurely(unsupported, dest), /Unsupported compression/i);

    const encrypted = path.join(tmp, 'encrypted.zip');
    writeZip(
      encrypted,
      buildRawZip([{ name: 'e.bin', data: 'x', flags: 0x0801, localFlags: 0x0801 }])
    );
    assert.throws(() => extractZipSecurely(encrypted, dest), /Encrypted/i);

    const zip64 = Buffer.from(buildRawZip([{ name: 'a.txt', data: 'hi' }]));
    const eocd = zip64.length - 22;
    zip64.writeUInt16LE(0xffff, eocd + 8);
    zip64.writeUInt16LE(0xffff, eocd + 10);
    const zip64Path = path.join(tmp, 'zip64.zip');
    writeZip(zip64Path, zip64);
    assert.throws(() => extractZipSecurely(zip64Path, dest), /Zip64/i);
  });

  it('enforces decompression limits on actual output, not metadata', () => {
    // Lying metadata (claims 5 bytes, really 100): size check must still fire.
    const real = Buffer.alloc(100, 0x41);
    const lying = path.join(tmp, 'lying.zip');
    writeZip(
      lying,
      buildRawZip([{
        name: 'lying.bin',
        method: 8,
        rawComp: zlib.deflateRawSync(real),
        uncompLen: 100,
        centralUncompSize: 5,
        localUncompSize: 5,
      }])
    );
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    assert.throws(() => extractZipSecurely(lying, dest), /Size mismatch/i);

    // Real cap enforced during inflation even when metadata would allow more.
    const tiny = path.join(tmp, 'tiny.zip');
    writeZip(
      tiny,
      buildRawZip([{
        name: 'bomb.bin',
        method: 8,
        rawComp: zlib.deflateRawSync(real),
        uncompLen: 100,
        centralUncompSize: 5,
        localUncompSize: 5,
      }])
    );
    assert.throws(
      () => {
        const destTiny = path.join(tmp, 'dest2');
        fs.mkdirSync(destTiny);
        return extractZipSecurely(tiny, destTiny, { maxSingleFile: 10 });
      },
      /single-file limit/i
    );

    // Unit-level: the limiter itself caps real bytes.
    assert.throws(
      () => inflateRawLimited(zlib.deflateRawSync(Buffer.alloc(100, 7)), 10, 'probe'),
      /single-file limit/i
    );
  });

  it('enforces total-size and entry-count limits', () => {
    // Deflate entries: ~200-byte file expands to 2000 bytes, so the compressed
    // file passes the archive-size guard while actual output trips the total.
    const total = path.join(tmp, 'total.zip');
    writeZip(
      total,
      buildRawZip([
        { name: 'a.bin', method: 8, data: Buffer.alloc(1000, 0x41) },
        { name: 'b.bin', method: 8, data: Buffer.alloc(1000, 0x42) },
      ])
    );
    const dest = path.join(tmp, 'dest');
    fs.mkdirSync(dest);
    assert.throws(() => extractZipSecurely(total, dest, { maxTotal: 500 }), /total size limit/i);

    const many = path.join(tmp, 'many.zip');
    writeZip(
      many,
      buildRawZip([
        { name: 'a.txt', data: 'a' },
        { name: 'b.txt', data: 'b' },
        { name: 'c.txt', data: 'c' },
      ])
    );
    const dest2 = path.join(tmp, 'dest2');
    fs.mkdirSync(dest2);
    assert.throws(() => extractZipSecurely(many, dest2, { maxFiles: 2 }), /Too many entries/i);
  });

  it('preserves rollback and cleans staging after extraction failure', async () => {
    const assets = path.join(tmp, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    const target = path.join(assets, 'clamav');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'clamscan.exe'), 'old-scan');
    fs.writeFileSync(path.join(target, 'freshclam.exe'), 'old-fresh');

    const badZip = path.join(tmp, 'bad.zip');
    const bad = new AdmZip();
    bad.addFile('only.txt', Buffer.from('incomplete'));
    bad.writeZip(badZip);
    const badHash = await dl.sha256File(badZip);

    await assert.rejects(
      dl.installStagedArchive(badZip, {
        targetDir: target,
        stagingParent: assets,
        expectedSha256: badHash,
      }),
      /Missing required ClamAV binary/i
    );
    // Rollback: old install intact.
    assert.equal(fs.readFileSync(path.join(target, 'clamscan.exe'), 'utf8'), 'old-scan');
    // Cleanup: no staging leftovers, no backup leftovers.
    const leftovers = fs.readdirSync(assets).filter((n) => n !== 'clamav');
    assert.deepEqual(leftovers, []);
  });

  it('rejects required binaries that are links, not regular files', (t) => {
    const dir = path.join(tmp, 'clam');
    fs.mkdirSync(dir, { recursive: true });
    const outside = path.join(tmp, 'outside-bin');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'real.exe'), 'x');
    try {
      fs.symlinkSync(outside, path.join(dir, 'clamscan.exe'), 'junction');
    } catch (err) {
      t.diagnostic(`skipped link setup: ${err.message}`);
      return;
    }
    fs.writeFileSync(path.join(dir, 'freshclam.exe'), 'x');
    assert.throws(() => dl.validateInstall(dir), /Missing required ClamAV binary/i);
  });

  it('treats a partial install as not downloaded', () => {
    const dir = path.join(tmp, 'partial-clam');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'clamscan.exe'), 'x');
    assert.equal(dl.hasCompleteInstall(dir), false);
    fs.writeFileSync(path.join(dir, 'freshclam.exe'), 'x');
    assert.equal(dl.hasCompleteInstall(dir), true);
    assert.equal(dl.hasCompleteInstall(path.join(tmp, 'missing')), false);
  });

  it('uses secure private staging dirs, not predictable pid paths', () => {
    const parent = path.join(tmp, 'parent');
    fs.mkdirSync(parent, { recursive: true });
    const a = dl.createSecureStagingDir(parent);
    const b = dl.createSecureStagingDir(parent);
    try {
      assert.notEqual(a, b);
      assert.ok(a.startsWith(path.resolve(parent)));
      assert.ok(fs.existsSync(a) && fs.existsSync(b));
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
    const source = fs.readFileSync(path.join(__dirname, '..', 'tools', 'download-clamav.js'), 'utf8');
    assert.doesNotMatch(source, /extractAllTo/);
    assert.doesNotMatch(source, /extractEntryTo/);
    assert.doesNotMatch(source, /require\(['"]adm-zip['"]\)/);
    assert.doesNotMatch(source, /\.tmp-\$\{process\.pid\}/);
    assert.match(source, /mkdtempSync/);
  });

  it('flattens a single top-level folder like the real ClamAV archive', async () => {
    const assets = path.join(tmp, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    const target = path.join(assets, 'clamav');
    const zipPath = path.join(tmp, 'nested.zip');
    const zip = new AdmZip();
    zip.addFile('clamav-1.5.2.win.x64/clamscan.exe', Buffer.from('scan'));
    zip.addFile('clamav-1.5.2.win.x64/freshclam.exe', Buffer.from('fresh'));
    zip.writeZip(zipPath);
    const hash = await dl.sha256File(zipPath);
    await dl.installStagedArchive(zipPath, {
      targetDir: target,
      stagingParent: assets,
      expectedSha256: hash,
    });
    assert.equal(fs.existsSync(path.join(target, 'clamscan.exe')), true);
    assert.equal(fs.existsSync(path.join(target, 'freshclam.exe')), true);
    assert.deepEqual(fs.readdirSync(assets).filter((n) => n !== 'clamav'), []);
  });
});
