'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { canonicalItem, compareSnapshots } = require('../src/main/persistenceMonitor');

describe('PersistenceMonitor snapshot comparison', () => {
  it('produces stable ids and canonical added, modified, and removed changes', () => {
    const keep = canonicalItem({ source: 'Registry Run', name: 'App', location: 'HKCU:Run', command: 'one.exe' });
    const modified = canonicalItem({ source: 'Registry Run', name: 'App', location: 'HKCU:Run', command: 'two.exe' });
    const removed = canonicalItem({ source: 'Startup Folder', name: 'Old.lnk', location: 'Startup', command: 'old.exe' });
    const added = canonicalItem({ source: 'Windows Service', name: 'NewSvc', location: 'Auto', command: 'new.exe' });
    assert.equal(keep.id, modified.id);
    const diff = compareSnapshots([keep, removed], [modified, added]);
    assert.equal(diff.modified.length, 1);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.removed.length, 1);
    assert.equal(diff.total, 3);
  });
});

