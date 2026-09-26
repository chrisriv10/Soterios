'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  RENDERER_WRITABLE_SETTINGS,
  isRendererWritableSetting,
  validateRendererSetting,
  CANONICAL_THEMES,
  PROCESS_MODES,
} = require('../src/main/rendererWritableSettings');

const IPC_SYSTEM_PATH = path.join(__dirname, '..', 'src', 'main', 'ipc', 'system.js');
const IPC_SYSTEM_SOURCE = fs.readFileSync(IPC_SYSTEM_PATH, 'utf8');

function throwsNotWritable(key, value) {
  assert.throws(
    () => validateRendererSetting(key, value),
    /Setting is not writable from the renderer\./,
    `expected rejection for ${JSON.stringify(key)}`
  );
}

function throwsInvalidValue(key, value) {
  assert.throws(
    () => validateRendererSetting(key, value),
    new RegExp(`Invalid value for setting "${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\.`),
    `expected invalid-value rejection for ${JSON.stringify(key)}`
  );
}

describe('renderer-writable settings schema shape', () => {
  it('exposes a frozen exact-match schema with a validator per key', () => {
    assert.equal(Object.isFrozen(RENDERER_WRITABLE_SETTINGS), true);
    for (const key of Object.keys(RENDERER_WRITABLE_SETTINGS)) {
      assert.equal(typeof RENDERER_WRITABLE_SETTINGS[key], 'function', key);
    }
  });

  it('matches the exact expected key set (catches accidental additions)', () => {
    assert.deepEqual(Object.keys(RENDERER_WRITABLE_SETTINGS).sort(), [
      'app.setupComplete',
      'feature.aiAssistant',
      'feature.autoReports',
      'feature.emergencyLockdown',
      'feature.externalLookups',
      'feature.folderWatch',
      'feature.geoLookup',
      'feature.lastPasswordScore',
      'feature.launchAtStartup',
      'feature.networkAlerts',
      'feature.networkPerimeterMap',
      'feature.networkTrafficHistory',
      'feature.notificationsEnabled',
      'feature.privacyMode',
      'feature.realtimeProtection',
      'feature.scanHistory',
      'feature.scanNotifications',
      'privacy.snapshot',
      'processInspector.mode',
      'reports.generateToolRunReports',
      'reports.skipDeleteConfirm',
      'scan.autoScanRemovableDrives',
      'tools.hostsBaseline.v1',
      'ui.language',
      'ui.theme',
    ]);
  });

  it('every legitimate renderer-written key is represented in the schema', () => {
    const uiDir = path.join(__dirname, '..', 'src', 'ui');
    const literalKeys = new Set();
    const visit = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { visit(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        const source = fs.readFileSync(full, 'utf8');
        for (const match of source.matchAll(/db:setSetting',\s*'([^']+)'/g)) {
          literalKeys.add(match[1]);
        }
      }
    };
    visit(uiDir);
    assert.ok(literalKeys.size > 0, 'expected to find renderer db:setSetting call sites');
    for (const key of literalKeys) {
      assert.equal(isRendererWritableSetting(key), true, `renderer-written key missing from schema: ${key}`);
    }
  });
});

describe('unknown and internal keys fail closed', () => {
  it('rejects arbitrary unknown keys without writing', () => {
    for (const key of ['totally.fake.key', 'feature.', '', 'x', 'db', 'settings']) {
      throwsNotWritable(key, true);
    }
  });

  it('rejects unknown feature.* keys with no raw fallback', () => {
    for (const key of [
      'feature.someFutureUnknownFlag',
      'feature.autoReports.evil',
      'feature.autoReports.',
      'feature.autoUpdates',
      'feature.vpnAutoConnect',
      'feature.systemMonitoring',
    ]) {
      throwsNotWritable(key, true);
      throwsNotWritable(key, false);
    }
  });

  it('rejects prototype-chain-style keys', () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      throwsNotWritable(key, true);
      assert.equal(isRendererWritableSetting(key), false);
    }
  });

  it('rejects non-string keys', () => {
    for (const key of [123, null, undefined, {}, [], true]) {
      throwsNotWritable(key, true);
    }
  });

  it('rejects internal main-process-only keys (privileged-path protection)', () => {
    for (const key of [
      'tools.disabledStartupItems.v1',
      'process.reputationApiKeyEncrypted',
      'process.reputationEnabled',
      'security.emergencyLockdown.allowlist',
      'firewall.trustedIps',
      'vpn.lastProfile',
      'ai.ollama.host',
      'ai.ollama.model',
      'maintenance.schedule',
      'schedule.config',
      'tools.persistenceBaseline.v1',
      'processHistoryRetentionDays',
    ]) {
      throwsNotWritable(key, true);
      throwsNotWritable(key, { planted: 'command' });
    }
  });
});

describe('boolean settings are strictly boolean', () => {
  const BOOLEAN_KEYS = [
    'feature.realtimeProtection',
    'feature.autoReports',
    'feature.scanHistory',
    'feature.externalLookups',
    'feature.geoLookup',
    'feature.networkPerimeterMap',
    'feature.notificationsEnabled',
    'feature.scanNotifications',
    'feature.launchAtStartup',
    'feature.folderWatch',
    'feature.networkAlerts',
    'feature.networkTrafficHistory',
    'feature.aiAssistant',
    'feature.emergencyLockdown',
    'feature.privacyMode',
    'reports.generateToolRunReports',
    'reports.skipDeleteConfirm',
    'scan.autoScanRemovableDrives',
    'app.setupComplete',
  ];

  it('accepts true and false for every boolean key', () => {
    for (const key of BOOLEAN_KEYS) {
      assert.deepEqual(validateRendererSetting(key, true), { key, value: true });
      assert.deepEqual(validateRendererSetting(key, false), { key, value: false });
    }
  });

  it('rejects truthy/falsy impostors without normalization', () => {
    for (const key of ['feature.autoReports', 'reports.skipDeleteConfirm', 'scan.autoScanRemovableDrives', 'app.setupComplete']) {
      for (const value of ['false', 'true', '0', '', 1, 0, null, undefined, {}, [], NaN]) {
        throwsInvalidValue(key, value);
      }
    }
  });
});

describe('theme validation', () => {
  it('accepts every canonical theme', () => {
    assert.equal(CANONICAL_THEMES.length, 16);
    for (const theme of CANONICAL_THEMES) {
      assert.deepEqual(validateRendererSetting('ui.theme', theme), { key: 'ui.theme', value: theme });
    }
  });

  it('normalizes the two known renderer aliases to canonical values', () => {
    assert.deepEqual(validateRendererSetting('ui.theme', 'black-red'), { key: 'ui.theme', value: 'crimson' });
    assert.deepEqual(validateRendererSetting('ui.theme', 'black-green'), { key: 'ui.theme', value: 'terminal' });
  });

  it('rejects traversal, casing, unknown, and non-string themes', () => {
    for (const value of ['../../evil', 'DARK', '', null, 123, {}, [], 'x'.repeat(5000)]) {
      throwsInvalidValue('ui.theme', value);
    }
    // Whitespace-padded canonical still normalizes (renderer-equivalent trim).
    assert.deepEqual(validateRendererSetting('ui.theme', 'dark\n'), { key: 'ui.theme', value: 'dark' });
    assert.deepEqual(validateRendererSetting('ui.theme', 'crimson '), { key: 'ui.theme', value: 'crimson' });
  });

  it('error messages never leak the submitted value', () => {
    const hostile = 'EvilValue-9f8a7b6c5d4e';
    try {
      validateRendererSetting('ui.theme', hostile);
      assert.fail('expected throw');
    } catch (error) {
      assert.ok(!String(error.message).includes(hostile));
    }
  });
});

describe('locale validation', () => {
  it('accepts supported locales exactly', () => {
    for (const locale of ['en', 'de', 'pt-BR', 'zh-CN', 'ar']) {
      assert.deepEqual(validateRendererSetting('ui.language', locale), { key: 'ui.language', value: locale });
    }
  });

  it('rejects unsupported, unbounded, and non-string locales', () => {
    for (const value of ['xx', 'en-US', '', 'EN', null, 123, {}, [], 'e'.repeat(5000)]) {
      throwsInvalidValue('ui.language', value);
    }
  });
});

describe('password score validation', () => {
  it('accepts the established 0-100 integer range', () => {
    for (const score of [0, 55, 100]) {
      assert.deepEqual(validateRendererSetting('feature.lastPasswordScore', score), {
        key: 'feature.lastPasswordScore',
        value: score,
      });
    }
  });

  it('rejects non-integers, out-of-range, and non-numbers', () => {
    for (const value of [-1, 101, 1.5, NaN, Infinity, -Infinity, '55', null, undefined, {}, []]) {
      throwsInvalidValue('feature.lastPasswordScore', value);
    }
  });
});

describe('processInspector.mode validation', () => {
  it('accepts the supported modes', () => {
    assert.deepEqual(PROCESS_MODES.slice().sort(), ['simple', 'technical']);
    for (const mode of PROCESS_MODES) {
      assert.deepEqual(validateRendererSetting('processInspector.mode', mode), {
        key: 'processInspector.mode',
        value: mode,
      });
    }
  });

  it('rejects anything else without defaulting', () => {
    for (const value of ['rootkit-mode', 'Simple', '', null, 123, {}, []]) {
      throwsInvalidValue('processInspector.mode', value);
    }
  });
});

describe('privacy.snapshot validation', () => {
  const VALID = JSON.stringify({
    externalLookups: false,
    geoLookup: true,
    aiAssistant: false,
    networkTrafficHistory: true,
    scanHistory: false,
    autoReports: true,
  });

  it('accepts a valid snapshot and the empty clear representation', () => {
    assert.deepEqual(validateRendererSetting('privacy.snapshot', VALID), { key: 'privacy.snapshot', value: VALID });
    assert.deepEqual(validateRendererSetting('privacy.snapshot', ''), { key: 'privacy.snapshot', value: '' });
    assert.deepEqual(validateRendererSetting('privacy.snapshot', '{}'), { key: 'privacy.snapshot', value: '{}' });
  });

  it('rejects malformed JSON, arrays, null, and non-strings', () => {
    for (const value of ['{bad json', '[]', 'null', '123', '"str"', 123, null, undefined, {}, []]) {
      throwsInvalidValue('privacy.snapshot', value);
    }
  });

  it('rejects unknown keys, non-boolean values, and oversized input', () => {
    throwsInvalidValue('privacy.snapshot', JSON.stringify({ externalLookups: true, evil: true }));
    throwsInvalidValue('privacy.snapshot', JSON.stringify({ externalLookups: 'yes' }));
    throwsInvalidValue('privacy.snapshot', JSON.stringify({ externalLookups: 1 }));
    // NOTE: object-literal { __proto__: ... } cannot express the attack (it
    // sets the prototype); the raw JSON string form is the real vector.
    throwsInvalidValue('privacy.snapshot', '{"__proto__": true}');
    throwsInvalidValue('privacy.snapshot', '{"constructor": {"prototype": {"x": 1}}}');
    throwsInvalidValue('privacy.snapshot', `{"externalLookups":true,"pad":"${'x'.repeat(5000)}"}`);
  });
});

describe('tools.hostsBaseline.v1 validation', () => {
  const VALID = {
    hash: 'a'.repeat(64),
    content: '127.0.0.1 localhost',
    approvedAt: new Date('2026-09-01T00:00:00.000Z').toISOString(),
  };

  it('accepts the exact persisted baseline shape', () => {
    assert.deepEqual(validateRendererSetting('tools.hostsBaseline.v1', { ...VALID }), {
      key: 'tools.hostsBaseline.v1',
      value: { ...VALID },
    });
  });

  it('rejects malformed baselines', () => {
    throwsInvalidValue('tools.hostsBaseline.v1', null);
    throwsInvalidValue('tools.hostsBaseline.v1', 'string');
    throwsInvalidValue('tools.hostsBaseline.v1', []);
    throwsInvalidValue('tools.hostsBaseline.v1', {});
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, hash: 'xyz' });
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, hash: 'a'.repeat(63) });
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, content: 123 });
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, approvedAt: 'not-a-date' });
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, approvedAt: '' });
    throwsInvalidValue('tools.hostsBaseline.v1', { hash: VALID.hash, content: VALID.content });
  });

  it('rejects unexpected fields that could plant privileged data', () => {
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, command: 'evil.exe' });
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, path: 'C:\\evil' });
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, hostsPathOverride: 'C:\\evil' });
  });

  it('rejects oversized content', () => {
    throwsInvalidValue('tools.hostsBaseline.v1', { ...VALID, content: 'x'.repeat(1024 * 1024 + 1) });
  });
});

describe('handler integration (static)', () => {
  it('db:setSetting delegates to the schema writer with no raw fallback', () => {
    const start = IPC_SYSTEM_SOURCE.indexOf("ipcMain.handle('db:setSetting'");
    assert.ok(start !== -1);
    const end = IPC_SYSTEM_SOURCE.indexOf('});', start);
    const block = IPC_SYSTEM_SOURCE.slice(start, end);
    assert.ok(block.includes('writeRendererSetting('), 'handler must validate first');
    assert.ok(!block.includes('setFlag'), 'featureFlags fallback must not bypass the schema');
    assert.ok(!block.includes('startsWith('), 'no prefix-based admission');
    assert.ok(!block.includes('db.setSetting(key'), 'raw key must never reach the DB');
  });

  it('theme.json mirroring lives behind validation in the writer', () => {
    const helperPath = path.join(__dirname, '..', 'src', 'main', 'rendererWritableSettings.js');
    const helperSource = fs.readFileSync(helperPath, 'utf8');
    assert.ok(helperSource.includes('JSON.stringify({ theme: validated.value }'), 'mirror must use the validated value');
  });

  it('featureFlags module is untouched for reads and other consumers', () => {
    assert.ok(IPC_SYSTEM_SOURCE.includes('featureFlags.getFlag(db, key, def)'), 'db:getSetting behavior preserved');
  });
});

describe('handler write path (behavioral)', () => {
  const { writeRendererSetting } = require('../src/main/rendererWritableSettings');
  const DatabaseService = require('../src/core/database');

  function testDeps() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-settings-ipc-'));
    const userData = path.join(dir, 'userData');
    fs.mkdirSync(userData, { recursive: true });
    const db = new DatabaseService(path.join(dir, 'test.db'));
    const deps = {
      db,
      app: { getPath: (name) => (name === 'userData' ? userData : dir) },
      fs,
      path,
    };
    const cleanup = () => {
      try { db.db.close(); } catch (_) {}
      fs.rmSync(dir, { recursive: true, force: true });
    };
    return { deps, db, userData, cleanup };
  }

  it('rejects disallowed keys with nothing persisted', () => {
    const { deps, db, cleanup } = testDeps();
    try {
      for (const [key, value] of [
        ['totally.fake.key', true],
        ['feature.someFutureUnknownFlag', true],
        ['tools.disabledStartupItems.v1', { planted: true }],
        ['__proto__', true],
      ]) {
        assert.throws(() => writeRendererSetting(deps, key, value), /Setting is not writable from the renderer\./);
        assert.equal(db.getSetting(key, 'absent'), 'absent', `row leaked for ${key}`);
      }
    } finally {
      cleanup();
    }
  });

  it('rejects invalid values with nothing persisted and no theme.json', () => {
    const { deps, db, userData, cleanup } = testDeps();
    try {
      assert.throws(() => writeRendererSetting(deps, 'feature.autoReports', 'false'), /Invalid value for setting/);
      assert.equal(db.getSetting('feature.autoReports', 'absent'), 'absent');
      assert.throws(() => writeRendererSetting(deps, 'ui.theme', '../../evil'), /Invalid value for setting/);
      assert.equal(db.getSetting('ui.theme', 'absent'), 'absent');
      assert.equal(fs.existsSync(path.join(userData, 'theme.json')), false);
    } finally {
      cleanup();
    }
  });

  it('persists valid writes and mirrors canonical themes', () => {
    const { deps, db, userData, cleanup } = testDeps();
    try {
      writeRendererSetting(deps, 'feature.autoReports', true);
      assert.equal(db.getSetting('feature.autoReports'), true);
      writeRendererSetting(deps, 'ui.theme', 'black-red');
      assert.equal(db.getSetting('ui.theme'), 'crimson');
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(userData, 'theme.json'), 'utf8')),
        { theme: 'crimson' }
      );
    } finally {
      cleanup();
    }
  });
});

describe('trust boundary: main-process writes stay unrestricted', () => {
  it('DatabaseService.setSetting still accepts internal keys directly', () => {
    const DatabaseService = require('../src/core/database');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-settings-'));
    const dbPath = path.join(dir, 'test.db');
    const db = new DatabaseService(dbPath);
    try {
      db.setSetting('tools.disabledStartupItems.v1', { planted: true });
      assert.deepEqual(db.getSetting('tools.disabledStartupItems.v1'), { planted: true });
      db.setSetting('internal.key', [1, 2, 3]);
      assert.deepEqual(db.getSetting('internal.key'), [1, 2, 3]);
    } finally {
      try { db.db.close(); } catch (_) {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
