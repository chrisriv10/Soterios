'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  SystemRestoreManager,
  validateDescription,
  normalizeRestorePoint,
  classifyRestoreError,
  parseListOutput,
  createLaunch,
  maxSequenceNumber,
  errorMessageFor,
  LIST_SCRIPT,
  CREATE_SCRIPT,
  DEFAULT_DESCRIPTION,
  MAX_DESCRIPTION_LENGTH,
  DESCRIPTION_ENV_VAR,
  CREATE_SUCCESS_MARKER,
} = require('../src/main/systemRestore');

const MODULE_PATH = path.join(__dirname, '..', 'src', 'main', 'systemRestore.js');
const MODULE_SOURCE = fs.readFileSync(MODULE_PATH, 'utf8');

function quietLogger() {
  return { info() {}, warn() {}, error() {} };
}

function managerWithScript(responses, overrides = {}) {
  // responses: array of { stdout, stderr } or Error to throw, consumed per call.
  const calls = [];
  const queue = responses.slice();
  const mgr = new SystemRestoreManager({
    platform: 'win32',
    now: () => 1780000000000,
    logger: quietLogger(),
    runCommand: async (request) => {
      calls.push(request);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error('unexpected extra command invocation');
      return next;
    },
    ...overrides,
  });
  return { mgr, calls };
}

function listJson(rows) {
  return JSON.stringify({
    points: rows.map((row, index) => ({
      sequenceNumber: row.sequenceNumber ?? index + 1,
      creationTime: row.creationTime ?? '2026-09-20T10:00:00.000Z',
      description: row.description ?? `Point ${index + 1}`,
      restorePointType: 12,
      eventType: 100,
    })),
  });
}

describe('validateDescription', () => {
  it('trims and accepts a normal description', () => {
    assert.deepEqual(validateDescription('  Soterios maintenance  '), {
      ok: true,
      description: 'Soterios maintenance',
    });
  });

  it('accepts the default description', () => {
    assert.equal(validateDescription(DEFAULT_DESCRIPTION).ok, true);
  });

  it('rejects non-string input as empty', () => {
    for (const value of [undefined, null, 42, {}, []]) {
      const result = validateDescription(value);
      assert.equal(result.ok, false);
      assert.equal(result.code, 'description_empty');
    }
  });

  it('rejects empty and whitespace-only input', () => {
    for (const value of ['', '   ', '\t ']) {
      const result = validateDescription(value);
      assert.equal(result.ok, false);
      assert.equal(result.code, 'description_empty');
    }
  });

  it('rejects descriptions over the conservative cap', () => {
    const result = validateDescription('x'.repeat(MAX_DESCRIPTION_LENGTH + 1));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'description_too_long');
  });

  it('accepts a description at exactly the cap', () => {
    assert.equal(validateDescription('x'.repeat(MAX_DESCRIPTION_LENGTH)).ok, true);
  });

  it('rejects CR and LF instead of stripping them', () => {
    for (const value of ['line one\nline two', 'line one\rline two', 'a\r\nb']) {
      const result = validateDescription(value);
      assert.equal(result.ok, false);
      assert.equal(result.code, 'description_invalid');
    }
  });

  it('rejects control characters', () => {
    for (const value of ['a\x00b', 'a\x07b', 'a\x7Fb']) {
      assert.equal(validateDescription(value).code, 'description_invalid');
    }
  });

  it('preserves unicode letters and punctuation', () => {
    const input = 'Soterios Wartung – vor Treiber-Update (Nr. 2) ✓';
    const result = validateDescription(input);
    assert.equal(result.ok, true);
    assert.equal(result.description, input);
  });
});

describe('normalizeRestorePoint', () => {
  it('normalizes a valid row with string numbers', () => {
    assert.deepEqual(normalizeRestorePoint({
      sequenceNumber: '7',
      creationTime: '2026-09-23T12:00:00.000Z',
      description: 'Test',
      restorePointType: '12',
      eventType: '100',
    }), {
      sequenceNumber: 7,
      createdAt: '2026-09-23T12:00:00.000Z',
      createdAtMs: Date.parse('2026-09-23T12:00:00.000Z'),
      description: 'Test',
      restorePointType: 12,
      eventType: 100,
    });
  });

  it('returns null for missing or non-positive sequence numbers', () => {
    const base = { creationTime: '2026-09-23T12:00:00.000Z', description: 'x' };
    assert.equal(normalizeRestorePoint({ ...base, sequenceNumber: 0 }), null);
    assert.equal(normalizeRestorePoint({ ...base, sequenceNumber: -3 }), null);
    assert.equal(normalizeRestorePoint({ ...base, sequenceNumber: 'abc' }), null);
    assert.equal(normalizeRestorePoint({ ...base, sequenceNumber: 2.5 }), null);
    assert.equal(normalizeRestorePoint(base), null);
  });

  it('returns null for unparsable creation times', () => {
    assert.equal(normalizeRestorePoint({ sequenceNumber: 1, creationTime: 'not a date' }), null);
    assert.equal(normalizeRestorePoint({ sequenceNumber: 1 }), null);
  });

  it('returns null for non-object input', () => {
    assert.equal(normalizeRestorePoint(null), null);
    assert.equal(normalizeRestorePoint(undefined), null);
    assert.equal(normalizeRestorePoint('x'), null);
    assert.equal(normalizeRestorePoint(42), null);
  });

  it('defaults unknown types to null and non-string descriptions to empty', () => {
    const point = normalizeRestorePoint({ sequenceNumber: 3, creationTime: '2026-09-23T12:00:00.000Z' });
    assert.equal(point.restorePointType, null);
    assert.equal(point.eventType, null);
    assert.equal(point.description, '');
  });
});

describe('parseListOutput', () => {
  it('sorts newest-first and drops malformed rows', () => {
    const parsed = parseListOutput(JSON.stringify({
      points: [
        { sequenceNumber: 2, creationTime: '2026-09-21T10:00:00.000Z', description: 'B' },
        { sequenceNumber: 'bad', creationTime: '2026-09-22T10:00:00.000Z', description: 'bad' },
        { sequenceNumber: 5, creationTime: '2026-09-22T10:00:00.000Z', description: 'E' },
      ],
    }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.points.map((p) => p.sequenceNumber), [5, 2]);
  });

  it('accepts an empty point array', () => {
    const parsed = parseListOutput('{"points":[]}');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.points, []);
  });

  it('rejects empty, oversized, unparsable, and wrong-shape output', () => {
    assert.equal(parseListOutput('').ok, false);
    assert.equal(parseListOutput('   ').ok, false);
    assert.equal(parseListOutput('{not json').ok, false);
    assert.equal(parseListOutput('{"points":"nope"}').ok, false);
    assert.equal(parseListOutput('{"other":[]}').ok, false);
    assert.equal(parseListOutput('[1,2]').ok, false);
  });

  it('rejects oversized output without parsing', () => {
    const huge = `{"points":[{"sequenceNumber":1,"creationTime":"2026-09-23T12:00:00.000Z","description":"${'x'.repeat(1024 * 1024 + 1)}"}]}`;
    const result = parseListOutput(huge);
    assert.equal(result.ok, false);
  });
});

describe('classifyRestoreError', () => {
  it('maps timeout flags first', () => {
    assert.equal(classifyRestoreError({ timedOut: true, stderr: 'Access denied' }), 'timeout');
  });

  it('maps privilege failures', () => {
    assert.equal(classifyRestoreError({ stderr: 'Get-ComputerRestorePoint : Access denied' }), 'requires_elevation');
    assert.equal(classifyRestoreError({ message: 'Access is denied. (0x80070005)' }), 'requires_elevation');
    assert.equal(classifyRestoreError({ stderr: 'The requested operation requires elevation.' }), 'requires_elevation');
  });

  it('maps user cancellation', () => {
    assert.equal(classifyRestoreError({ message: 'The operation was canceled by the user (0x800704C7)' }), 'cancelled');
  });

  it('maps missing cmdlet / unsupported platform', () => {
    assert.equal(classifyRestoreError({ stderr: 'Get-ComputerRestorePoint is not recognized as the name of a cmdlet' }), 'unsupported');
    assert.equal(classifyRestoreError({ stderr: 'Invalid namespace 0x8004100E' }), 'unsupported');
  });

  it('maps documented create-side frequency failures', () => {
    assert.equal(
      classifyRestoreError({ stderr: 'Cannot create a new restore point: a restore point has already been created within the past 24 hours.' }),
      'frequency_limited'
    );
  });

  it('falls back to failed', () => {
    assert.equal(classifyRestoreError({ stderr: 'Something strange happened' }), 'failed');
    assert.equal(classifyRestoreError({}), 'failed');
  });
});

describe('errorMessageFor', () => {
  it('has a message for every machine code', () => {
    for (const code of ['requires_elevation', 'cancelled', 'unsupported', 'frequency_limited', 'timeout', 'busy', 'description_empty', 'description_too_long', 'description_invalid', 'not_confirmed', 'failed', 'no_such_code']) {
      const message = errorMessageFor(code, 'detail text');
      assert.equal(typeof message, 'string');
      assert.ok(message.length > 10, code);
    }
  });
});

describe('maxSequenceNumber', () => {
  it('returns 0 for empty input and the max otherwise', () => {
    assert.equal(maxSequenceNumber([]), 0);
    assert.equal(maxSequenceNumber(null), 0);
    assert.equal(maxSequenceNumber([{ sequenceNumber: 3 }, { sequenceNumber: 9 }, { sequenceNumber: 4 }]), 9);
  });
});

describe('listRestorePoints', () => {
  it('reports unsupported off Windows without spawning', async () => {
    const { mgr, calls } = managerWithScript([]);
    const win = await new SystemRestoreManager({ platform: 'darwin', logger: quietLogger() }).listRestorePoints();
    assert.equal(win.ok, false);
    assert.equal(win.code, 'unsupported');
    assert.equal(calls.length, 0);
  });

  it('returns available points newest-first', async () => {
    const { mgr } = managerWithScript([{ stdout: listJson([{ sequenceNumber: 2 }, { sequenceNumber: 9 }]), stderr: '' }]);
    const result = await mgr.listRestorePoints();
    assert.equal(result.ok, true);
    assert.equal(result.status, 'available');
    assert.equal(result.count, 2);
    assert.deepEqual(result.points.map((p) => p.sequenceNumber), [9, 2]);
  });

  it('reports an empty store as unconfirmed with an honest message', async () => {
    const { mgr } = managerWithScript([{ stdout: '{"points":[]}', stderr: '' }]);
    const result = await mgr.listRestorePoints();
    assert.equal(result.ok, true);
    assert.equal(result.status, 'unconfirmed');
    assert.ok(result.message.includes('cannot tell the difference'));
  });

  it('maps access-denied stderr to requires_elevation', async () => {
    const error = new Error('Command failed: powershell.exe');
    error.code = 1;
    error.stderr = 'Get-ComputerRestorePoint : Access denied';
    const { mgr } = managerWithScript([error]);
    const result = await mgr.listRestorePoints();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'requires_elevation');
  });
});

describe('createRestorePoint', () => {
  it('rejects invalid input without spawning', async () => {
    const { mgr, calls } = managerWithScript([]);
    const result = await mgr.createRestorePoint('   ');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'description_empty');
    assert.equal(calls.length, 0);
  });

  it('reports unsupported off Windows without spawning', async () => {
    const { mgr, calls } = managerWithScript([]);
    const win = await new SystemRestoreManager({ platform: 'linux', logger: quietLogger() }).createRestorePoint('x');
    assert.equal(win.ok, false);
    assert.equal(win.code, 'unsupported');
    assert.equal(calls.length, 0);
  });

  it('creates and verifies the new point', async () => {
    const before = listJson([{ sequenceNumber: 5, description: 'Old' }]);
    const after = JSON.stringify({
      points: [
        { sequenceNumber: 5, creationTime: '2026-09-20T10:00:00.000Z', description: 'Old', restorePointType: 12, eventType: 100 },
        { sequenceNumber: 6, creationTime: new Date(1780000001000).toISOString(), description: 'Soterios maintenance', restorePointType: 12, eventType: 100 },
      ],
    });
    const { mgr, calls } = managerWithScript([
      { stdout: before, stderr: '' },
      { stdout: `${CREATE_SUCCESS_MARKER}\r\n`, stderr: '' },
      { stdout: after, stderr: '' },
    ]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'created');
    assert.equal(result.point.sequenceNumber, 6);
    assert.equal(calls.length, 3);
  });

  it('returns not_confirmed when the command runs but no point appears', async () => {
    const before = listJson([{ sequenceNumber: 5, description: 'Old' }]);
    const { mgr } = managerWithScript([
      { stdout: before, stderr: '' },
      { stdout: `${CREATE_SUCCESS_MARKER}\r\n`, stderr: '' },
      { stdout: before, stderr: '' },
    ]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not_confirmed');
  });

  it('never claims created when the marker is missing and nothing verifies', async () => {
    const before = listJson([{ sequenceNumber: 5, description: 'Old' }]);
    const { mgr } = managerWithScript([
      { stdout: before, stderr: '' },
      { stdout: '', stderr: '' },
      { stdout: before, stderr: '' },
    ]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, false);
    assert.ok(['failed', 'not_confirmed'].includes(result.code));
  });

  it('aborts when the baseline list fails', async () => {
    const error = new Error('Command failed');
    error.code = 1;
    error.stderr = 'Access denied';
    const { mgr, calls } = managerWithScript([error]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'requires_elevation');
    assert.equal(result.stage, 'pre_list');
    assert.equal(calls.length, 1);
  });

  it('dedupes concurrent creates and resets the flag afterwards', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const before = listJson([{ sequenceNumber: 5, description: 'Old' }]);
    const calls = [];
    const mgr = new SystemRestoreManager({
      platform: 'win32',
      now: () => 1780000000000,
      logger: quietLogger(),
      runCommand: async (request) => {
        calls.push(request);
        if (calls.length === 1) {
          await gate;
          return { stdout: before, stderr: '' };
        }
        return { stdout: before, stderr: '' };
      },
    });
    const first = mgr.createRestorePoint('First point');
    const second = await mgr.createRestorePoint('Second point');
    assert.equal(second.ok, false);
    assert.equal(second.code, 'busy');
    release();
    await first;
    assert.equal(mgr.createInFlight, false);
    // A later create is accepted again (fails here only on verification).
    const third = await mgr.createRestorePoint('Third point');
    assert.ok(['not_confirmed', 'failed'].includes(third.code));
  });

  it('reconciles a timeout via verification when the point landed', async () => {
    const before = listJson([{ sequenceNumber: 5, description: 'Old' }]);
    const after = JSON.stringify({
      points: [
        { sequenceNumber: 5, creationTime: '2026-09-20T10:00:00.000Z', description: 'Old', restorePointType: 12, eventType: 100 },
        { sequenceNumber: 6, creationTime: new Date(1780000001000).toISOString(), description: 'Soterios maintenance', restorePointType: 12, eventType: 100 },
      ],
    });
    const timeout = new Error('Command timed out');
    timeout.killed = true;
    const { mgr } = managerWithScript([
      { stdout: before, stderr: '' },
      timeout,
      { stdout: after, stderr: '' },
    ]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'created');
    assert.equal(result.verifiedAfterTimeout, true);
  });

  it('reports timeout when verification finds nothing', async () => {
    const before = listJson([{ sequenceNumber: 5, description: 'Old' }]);
    const timeout = new Error('Command timed out');
    timeout.killed = true;
    const { mgr } = managerWithScript([
      { stdout: before, stderr: '' },
      timeout,
      { stdout: before, stderr: '' },
    ]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'timeout');
  });

  it('maps cancel and frequency failures', async () => {
    const before = listJson([{ sequenceNumber: 5, description: 'Old' }]);
    const cancelled = new Error('failed');
    cancelled.code = 1;
    cancelled.stderr = 'The operation was canceled by the user';
    const limited = new Error('failed');
    limited.code = 1;
    limited.stderr = 'a restore point has already been created within the past 24 hours';
    const first = managerWithScript([{ stdout: before, stderr: '' }, cancelled]);
    assert.equal((await first.mgr.createRestorePoint('Soterios maintenance')).code, 'cancelled');
    const second = managerWithScript([{ stdout: before, stderr: '' }, limited]);
    assert.equal((await second.mgr.createRestorePoint('Soterios maintenance')).code, 'frequency_limited');
  });

  it('passes the description via environment, never via argv', async () => {
    const evil = '"; Write-Host pwned; #';
    const checked = validateDescription(evil);
    assert.equal(checked.ok, true);
    const before = listJson([]);
    const { mgr, calls } = managerWithScript([
      { stdout: before, stderr: '' },
      { stdout: `${CREATE_SUCCESS_MARKER}\r\n`, stderr: '' },
      { stdout: before, stderr: '' },
    ]);
    await mgr.createRestorePoint(evil);
    const createCall = calls[1];
    assert.equal(createCall.env[DESCRIPTION_ENV_VAR], evil);
    assert.equal(createCall.file, 'powershell.exe');
    assert.ok(!createCall.args.join(' ').includes(evil));
    for (const call of calls) {
      const encoded = call.args[call.args.indexOf('-EncodedCommand') + 1];
      const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
      assert.ok(!decoded.includes(evil), 'user input must never reach the fixed script');
    }
  });
});

describe('fixed scripts', () => {
  it('lists with Get-ComputerRestorePoint and emits a points envelope', () => {
    assert.ok(LIST_SCRIPT.includes('Get-ComputerRestorePoint'));
    assert.ok(LIST_SCRIPT.includes('ConvertTo-Json'));
    assert.ok(!LIST_SCRIPT.includes('Checkpoint-Computer'));
  });

  it('creates exactly one MODIFY_SETTINGS point from the env description', () => {
    const matches = CREATE_SCRIPT.match(/Checkpoint-Computer/g) || [];
    assert.equal(matches.length, 1);
    assert.ok(CREATE_SCRIPT.includes('-RestorePointType MODIFY_SETTINGS'));
    assert.ok(CREATE_SCRIPT.includes(`$env:${DESCRIPTION_ENV_VAR}`));
    assert.ok(CREATE_SCRIPT.includes(CREATE_SUCCESS_MARKER));
  });
});

describe('launch shape', () => {
  it('spawns powershell.exe with an argv array and no shell', () => {
    const launch = createLaunch(LIST_SCRIPT);
    assert.equal(launch.file, 'powershell.exe');
    assert.deepEqual(launch.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    assert.ok(!('shell' in launch));
    const decoded = Buffer.from(launch.args[3], 'base64').toString('utf16le');
    assert.equal(decoded, LIST_SCRIPT);
  });
});

describe('module safety surface', () => {
  it('contains no elevation, restore, deletion, VSS, persistence, or scheduler hooks', () => {
    for (const token of [
      'Start-Process',
      '-Verb',
      'RunAs',
      'Restore-Computer',
      'Remove-ComputerRestorePoint',
      'Enable-ComputerRestore',
      'Disable-ComputerRestore',
      'APPLICATION_INSTALL',
      'APPLICATION_UNINSTALL',
      'toolRegistry',
      'maintenanceScheduler',
      'SystemAudit',
      "require('fs')",
      'require("fs")',
      'writeFile',
    ]) {
      assert.ok(!MODULE_SOURCE.includes(token), `forbidden token present: ${token}`);
    }
    assert.ok(!/shell\s*:/.test(MODULE_SOURCE), 'no shell option may be configured');
  });

  it('documents only MODIFY_SETTINGS as the restore point type', () => {
    const types = CREATE_SCRIPT.match(/-RestorePointType\s+[A-Z_]+/g) || [];
    assert.deepEqual(types, ['-RestorePointType MODIFY_SETTINGS']);
  });
});

describe('IPC wiring', () => {
  it('exposes exactly the list and create channels', () => {
    const ipcPath = path.join(__dirname, '..', 'src', 'main', 'ipc', 'systemRestore.js');
    const source = fs.readFileSync(ipcPath, 'utf8');
    assert.ok(source.includes("'systemRestore:list'"));
    assert.ok(source.includes("'systemRestore:create'"));
    const handles = source.match(/ipcMain\.handle\('([^']+)'/g) || [];
    assert.deepEqual(handles, ["ipcMain.handle('systemRestore:list'", "ipcMain.handle('systemRestore:create'"]);
  });

  it('registers the manager in the service registry', () => {
    const registryPath = path.join(__dirname, '..', 'src', 'main', 'serviceRegistry.js');
    const source = fs.readFileSync(registryPath, 'utf8');
    assert.ok(source.includes('systemRestoreManager'));
    assert.ok(source.includes("require('./systemRestore')"));
  });
});

describe('in-flight guard lifecycle (audit #1)', () => {
  const NOW = 1780000000000;
  const oldPoint = () => ({
    sequenceNumber: 5,
    creationTime: new Date(NOW - 86400000).toISOString(),
    description: 'Old',
    restorePointType: 12,
    eventType: 100,
  });

  it('holds the guard through timeout reconciliation: intruder gets busy, guard clears after settle', async () => {
    const calls = [];
    let releaseVerify;
    const verifyGate = new Promise((resolve) => { releaseVerify = resolve; });
    const timeoutError = new Error('Command timed out');
    timeoutError.killed = true;
    const mgr = new SystemRestoreManager({
      platform: 'win32',
      now: () => NOW,
      logger: quietLogger(),
      runCommand: async (request) => {
        calls.push(request);
        if (calls.length === 1) return { stdout: JSON.stringify({ points: [oldPoint()] }), stderr: '' };
        if (calls.length === 2) throw timeoutError;
        await verifyGate;
        return { stdout: JSON.stringify({ points: [oldPoint()] }), stderr: '' };
      },
    });
    const first = mgr.createRestorePoint('Soterios maintenance');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(mgr.createInFlight, true);
    const intruder = await mgr.createRestorePoint('Intruder point');
    assert.equal(intruder.ok, false);
    assert.equal(intruder.code, 'busy');
    assert.equal(mgr.createInFlight, true);
    releaseVerify();
    const result = await first;
    assert.equal(result.ok, false);
    assert.equal(result.code, 'timeout');
    assert.equal(mgr.createInFlight, false);
    // The timed-out checkpoint was the only mutation: exactly one create invoke ran.
    assert.equal(calls.filter((c) => c.env && c.env[DESCRIPTION_ENV_VAR]).length, 1);
  });

  it('holds the guard while the create command is pending and clears only after settle', async () => {
    const calls = [];
    let releaseCreate;
    const createGate = new Promise((resolve) => { releaseCreate = resolve; });
    const mgr = new SystemRestoreManager({
      platform: 'win32',
      now: () => NOW,
      logger: quietLogger(),
      runCommand: async (request) => {
        calls.push(request);
        if (calls.length === 1) return { stdout: JSON.stringify({ points: [oldPoint()] }), stderr: '' };
        if (calls.length === 2) {
          await createGate;
          return { stdout: `${CREATE_SUCCESS_MARKER}\r\n`, stderr: '' };
        }
        return { stdout: JSON.stringify({ points: [oldPoint()] }), stderr: '' };
      },
    });
    const first = mgr.createRestorePoint('Soterios maintenance');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const intruder = await mgr.createRestorePoint('Second point');
    assert.equal(intruder.code, 'busy');
    assert.equal(mgr.createInFlight, true);
    releaseCreate();
    const result = await first;
    assert.equal(result.code, 'not_confirmed');
    assert.equal(mgr.createInFlight, false);
  });

  it('never races or abandons the underlying operation', () => {
    assert.ok(!/Promise\.race/.test(MODULE_SOURCE), 'no Promise.race may abandon the child');
    assert.ok(!/Promise\.any/.test(MODULE_SOURCE), 'no Promise.any may abandon the child');
  });
});

describe('verification identity and time bounds (audit #2)', () => {
  const NOW = 1780000000000;
  const oldPoint = (seq = 5) => ({
    sequenceNumber: seq,
    creationTime: new Date(NOW - 86400000).toISOString(),
    description: 'Old',
    restorePointType: 12,
    eventType: 100,
  });
  const freshPoint = (seq, description, ms) => ({
    sequenceNumber: seq,
    creationTime: new Date(ms).toISOString(),
    description,
    restorePointType: 12,
    eventType: 100,
  });
  function createWithAfter(afterRows) {
    const responses = [
      { stdout: JSON.stringify({ points: [oldPoint()] }), stderr: '' },
      { stdout: `${CREATE_SUCCESS_MARKER}\r\n`, stderr: '' },
      { stdout: JSON.stringify({ points: afterRows }), stderr: '' },
    ];
    return new SystemRestoreManager({
      platform: 'win32',
      now: () => NOW,
      logger: quietLogger(),
      runCommand: async () => {
        const next = responses.shift();
        if (!next) throw new Error('unexpected extra command invocation');
        return next;
      },
    });
  }

  it('rejects a new sequence with the wrong description', async () => {
    const mgr = createWithAfter([oldPoint(), freshPoint(6, 'Something else', NOW + 1000)]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not_confirmed');
  });

  it('rejects a far-future-dated matching point', async () => {
    for (const future of [NOW + 3600000, NOW + 86400000 * 30]) {
      const mgr = createWithAfter([oldPoint(), freshPoint(6, 'Soterios maintenance', future)]);
      const result = await mgr.createRestorePoint('Soterios maintenance');
      assert.equal(result.ok, false, `future offset ${future - NOW}ms must not verify`);
      assert.equal(result.code, 'not_confirmed');
    }
  });

  it('accepts a point just inside the upper skew bound', async () => {
    const mgr = createWithAfter([oldPoint(), freshPoint(6, 'Soterios maintenance', NOW + 59000)]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, true);
    assert.equal(result.status, 'created');
    assert.equal(result.point.sequenceNumber, 6);
  });

  it('detects the new identity when pruning keeps the count the same', async () => {
    const before = [oldPoint(5), { ...oldPoint(6), description: 'Mid', creationTime: new Date(NOW - 43200000).toISOString() }];
    const responses = [
      { stdout: JSON.stringify({ points: before }), stderr: '' },
      { stdout: `${CREATE_SUCCESS_MARKER}\r\n`, stderr: '' },
      // Oldest pruned (5 gone), new point 7 present: same count, new identity.
      { stdout: JSON.stringify({ points: [before[1], freshPoint(7, 'Soterios maintenance', NOW + 1000)] }), stderr: '' },
    ];
    const mgr = new SystemRestoreManager({
      platform: 'win32',
      now: () => NOW,
      logger: quietLogger(),
      runCommand: async () => responses.shift(),
    });
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, true);
    assert.equal(result.point.sequenceNumber, 7);
  });

  it('rejects a same-description point older than the lower bound', async () => {
    const mgr = createWithAfter([oldPoint(), freshPoint(6, 'Soterios maintenance', NOW - 61000)]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not_confirmed');
  });

  it('is independent of after-list ordering', async () => {
    const mgr = createWithAfter([freshPoint(6, 'Soterios maintenance', NOW + 1000), oldPoint()]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, true);
    assert.equal(result.point.sequenceNumber, 6);
  });

  it('prefers the highest matching sequence when several verify', async () => {
    const mgr = createWithAfter([
      oldPoint(),
      freshPoint(6, 'Soterios maintenance', NOW + 500),
      freshPoint(7, 'Soterios maintenance', NOW + 800),
    ]);
    const result = await mgr.createRestorePoint('Soterios maintenance');
    assert.equal(result.ok, true);
    assert.equal(result.point.sequenceNumber, 7);
  });
});

describe('hostile descriptions stay data (audit #3)', () => {
  const NOW = 1780000000000;
  const HOSTILE = [
    "it's quoted",
    'say "hi"',
    'back`tick',
    '$(Get-Process)',
    '${env:PATH}',
    'a;b',
    'a|b',
    'a&b',
    'a>b',
    'a<b',
    'a#b',
    'Ünïcodé–ß',
    'emoji 🎉 test',
    '"; Checkpoint-Computer -Description pwned; #',
    "$env:SOTERIOS_RESTORE_DESC='x'",
    'Soterios & Maintenance | (test)',
  ];

  it('keeps argv and fixed source identical; only the env value changes', async () => {
    let referenceArgs = null;
    let referenceDecoded = null;
    for (const input of HOSTILE) {
      const validated = validateDescription(input);
      assert.equal(validated.ok, true, `hostile input must validate as inert text: ${input}`);
      const calls = [];
      const mgr = new SystemRestoreManager({
        platform: 'win32',
        now: () => NOW,
        logger: quietLogger(),
        runCommand: async (request) => {
          calls.push(request);
          return { stdout: '{"points":[]}', stderr: '' };
        },
      });
      await mgr.createRestorePoint(input);
      const createCall = calls[1];
      assert.ok(createCall, `expected a create invoke for ${input}`);
      assert.equal(createCall.file, 'powershell.exe');
      assert.equal(createCall.env[DESCRIPTION_ENV_VAR], validated.description);
      const encoded = createCall.args[createCall.args.indexOf('-EncodedCommand') + 1];
      const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
      assert.equal(decoded, CREATE_SCRIPT);
      assert.ok(!createCall.args.join(' ').includes(input), `input leaked into argv: ${input}`);
      assert.ok(!decoded.includes(input), `input leaked into script source: ${input}`);
      if (referenceArgs === null) {
        referenceArgs = createCall.args.join('|');
        referenceDecoded = decoded;
      } else {
        assert.equal(createCall.args.join('|'), referenceArgs, `argv diverged for ${input}`);
        assert.equal(decoded, referenceDecoded, `script source diverged for ${input}`);
      }
    }
  });
});

describe('child environment and logging hygiene (audit #4)', () => {
  const NOW = 1780000000000;

  it('inherits the parent environment, scopes the description to the child, never mutates process.env', async () => {
    const seen = [];
    const mgr = new SystemRestoreManager({
      platform: 'win32',
      now: () => NOW,
      logger: quietLogger(),
      runCommand: async (request) => {
        seen.push(request.env);
        return { stdout: '{"points":[]}', stderr: '' };
      },
    });
    await mgr.createRestorePoint('Env hygiene check');
    assert.ok(seen.length >= 2);
    const createEnv = seen[1];
    assert.equal(createEnv[DESCRIPTION_ENV_VAR], 'Env hygiene check');
    assert.equal(createEnv.SystemRoot, process.env.SystemRoot);
    assert.equal(createEnv.Path, process.env.Path);
    assert.ok(!('SOTERIOS_RESTORE_DESC' in process.env), 'parent environment must stay clean');
  });

  it('never logs the description', async () => {
    const logged = [];
    const spy = {
      info: (...args) => logged.push(args),
      warn: (...args) => logged.push(args),
      error: (...args) => logged.push(args),
    };
    const secret = 'Supercalifragilistic-desc-12345';
    const responses = [
      { stdout: '{"points":[]}', stderr: '' },
      { stdout: `${CREATE_SUCCESS_MARKER}\r\n`, stderr: '' },
      {
        stdout: JSON.stringify({ points: [{ sequenceNumber: 9, creationTime: new Date(NOW + 500).toISOString(), description: secret, restorePointType: 12, eventType: 100 }] }),
        stderr: '',
      },
    ];
    const mgr = new SystemRestoreManager({
      platform: 'win32',
      now: () => NOW,
      logger: spy,
      runCommand: async () => responses.shift(),
    });
    await mgr.createRestorePoint(secret);
    await mgr.listRestorePoints();
    assert.ok(logged.length > 0, 'expected some log output to inspect');
    for (const args of logged) {
      assert.ok(!JSON.stringify(args).includes(secret), 'description leaked into logs');
    }
  });
});

describe('malformed renderer payloads (audit #5)', () => {
  const NOW = 1780000000000;

  it('rejects non-shape payloads without spawning', async () => {
    const cases = [
      ['number', 123],
      ['null', null],
      ['array', ['x']],
      ['array-of-objects', [{ description: 'x' }]],
      ['object-empty', {}],
      ['missing', undefined],
      ['boolean', true],
      ['nested-description', { description: { text: 'x' } }],
    ];
    for (const [name, payload] of cases) {
      let spawned = 0;
      const mgr = new SystemRestoreManager({
        platform: 'win32',
        now: () => NOW,
        logger: quietLogger(),
        runCommand: async () => { spawned += 1; return { stdout: '{"points":[]}', stderr: '' }; },
      });
      const result = await mgr.createRestorePoint(payload);
      assert.equal(result.ok, false, name);
      assert.equal(result.code, 'description_empty', name);
      assert.equal(spawned, 0, `${name} must not spawn`);
    }
  });

  it('consumes only the description and ignores extra properties', async () => {
    const calls = [];
    const mgr = new SystemRestoreManager({
      platform: 'win32',
      now: () => NOW,
      logger: quietLogger(),
      runCommand: async (request) => {
        calls.push(request);
        return { stdout: '{"points":[]}', stderr: '' };
      },
    });
    await mgr.createRestorePoint({ description: '  ok  ', script: 'evil', timeout: 1, env: { X: 'y' } });
    assert.ok(calls.length > 0, 'valid description proceeds');
    assert.equal(calls[1].env[DESCRIPTION_ENV_VAR], 'ok');
    assert.ok(!('script' in calls[1]) && !('timeout' in calls[1]), 'extra payload fields must not reach the runner');
  });
});
