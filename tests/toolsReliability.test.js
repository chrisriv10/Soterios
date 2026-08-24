'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const duplicateFinder = require('../src/core/duplicateFinder');
const hostsFileCheck = require('../src/scripts/safeScripts/hostsFileCheck');
const scheduledTasksReport = require('../src/scripts/safeScripts/scheduledTasksReport');

describe('Tools reliability fixtures', () => {
  it('does not impose a 100 MB duplicate scan ceiling', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-large-duplicate-'));
    try {
      const first = path.join(dir, 'first.bin');
      const second = path.join(dir, 'second.bin');
      const size = 101 * 1024 * 1024;
      fs.writeFileSync(first, Buffer.alloc(1));
      fs.writeFileSync(second, Buffer.alloc(1));
      fs.truncateSync(first, size);
      fs.truncateSync(second, size);
      const result = await duplicateFinder.findDuplicates({ roots: [dir] });
      assert.equal(result.duplicateGroups.length, 1);
      assert.equal(result.duplicateGroups[0].size, size);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('explains an unchanged default-style hosts file as verified clean', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-hosts-clean-'));
    try {
      const file = path.join(dir, 'hosts');
      fs.writeFileSync(file, '# default\n127.0.0.1 localhost\n::1 localhost\n');
      const first = await hostsFileCheck(file);
      const second = await hostsFileCheck({ hostsPath: file, baselineHash: first.hash, baselineContent: first.baselineCandidate.content });
      assert.equal(second.status, 'clean');
      assert.equal(second.entryCount, 0);
      assert.equal(second.baselineStatus, 'unchanged');
      assert.match(second.verdict, /verified clean/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('turns SID and GUID-heavy task names into readable labels', () => {
    assert.equal(scheduledTasksReport.friendlyTaskName({ TaskName: 'OneDrive Startup Task-S-1-5-21-100-200-300-1001' }), 'Microsoft OneDrive — Startup');
    assert.equal(scheduledTasksReport.friendlyTaskName({ TaskName: 'SoftLandingDeferralTask-{12345678-1234-1234-1234-123456789abc}' }), 'Microsoft Windows — Soft Landing Deferral');
  });
});

