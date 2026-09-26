'use strict';

/**
 * Explicit allowlist of database settings the renderer may write through the
 * `db:setSetting` IPC channel (issue #182).
 *
 * The renderer is untrusted input at this boundary: only exactly-listed keys
 * are accepted, each with its own value validator/normalizer. Unknown keys
 * (including unknown `feature.*` keys and internal main-process keys) fail
 * closed — there is no prefix wildcard and no raw-DB fallback.
 *
 * Trusted main-process code keeps calling `DatabaseService.setSetting()`
 * directly and is unaffected by this schema.
 */

const { PRIVACY_SENSITIVE_FEATURES } = require('../core/privacyMode');
const { listLocales } = require('../i18n');

// Canonical theme set mirrored from the renderer's applyTheme allowlist
// (src/ui/js/api.js). Aliases below are the same two the renderer accepts.
const CANONICAL_THEMES = Object.freeze([
  'dark', 'light', 'ocean', 'emerald', 'sunset', 'violet', 'crimson',
  'terminal', 'midnight', 'bumblebee', 'monochrome', 'rose', 'aurora',
  'sand', 'cyber', 'mint',
]);
const THEME_ALIASES = Object.freeze({
  'black-red': 'crimson',
  'black-green': 'terminal',
});

const PROCESS_MODES = Object.freeze(['simple', 'technical']);

// Password strength model (src/tools/passwordTools.js) clamps scores to 0-100.
const MIN_PASSWORD_SCORE = 0;
const MAX_PASSWORD_SCORE = 100;

// Privacy snapshots are tiny (~6 booleans); generous cap rejects abuse.
const MAX_SNAPSHOT_CHARS = 4096;
// Hosts files are kilobytes in practice; 1 MiB bounds pathological input.
const MAX_HOSTS_CONTENT_CHARS = 1024 * 1024;
// ISO timestamps are short; bound rejects garbage before Date.parse.
const MAX_TIMESTAMP_CHARS = 100;

const PRIVACY_FEATURE_SET = new Set(PRIVACY_SENSITIVE_FEATURES);
const HOSTS_BASELINE_FIELDS = new Set(['hash', 'content', 'approvedAt']);

function fail(message) {
  return { ok: false, error: message };
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateBooleanSetting(value) {
  if (typeof value !== 'boolean') return fail('boolean required');
  return { ok: true, value };
}

function validateTheme(value) {
  if (typeof value !== 'string') return fail('string required');
  const requested = value.trim();
  const canonical = Object.prototype.hasOwnProperty.call(THEME_ALIASES, requested)
    ? THEME_ALIASES[requested]
    : requested;
  if (!CANONICAL_THEMES.includes(canonical)) return fail('unknown theme');
  return { ok: true, value: canonical };
}

function validateLocale(value) {
  if (typeof value !== 'string') return fail('string required');
  const requested = value.trim();
  let codes;
  try {
    codes = new Set(listLocales().map((entry) => entry.code));
  } catch (_) {
    return fail('locales unavailable');
  }
  if (!codes.has(requested)) return fail('unsupported locale');
  return { ok: true, value: requested };
}

function validatePasswordScore(value) {
  if (!Number.isInteger(value) || value < MIN_PASSWORD_SCORE || value > MAX_PASSWORD_SCORE) {
    return fail('integer 0-100 required');
  }
  return { ok: true, value };
}

function validateProcessMode(value) {
  if (typeof value !== 'string' || !PROCESS_MODES.includes(value)) {
    return fail('unsupported mode');
  }
  return { ok: true, value };
}

function validatePrivacySnapshot(value) {
  if (typeof value !== 'string') return fail('string required');
  if (value === '') return { ok: true, value: '' };
  if (value.length > MAX_SNAPSHOT_CHARS) return fail('snapshot too large');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (_) {
    return fail('snapshot must be valid JSON');
  }
  if (!isPlainRecord(parsed)) return fail('snapshot must be an object');
  for (const key of Object.keys(parsed)) {
    if (!PRIVACY_FEATURE_SET.has(key)) return fail('unknown snapshot key');
    if (typeof parsed[key] !== 'boolean') return fail('snapshot values must be boolean');
  }
  return { ok: true, value };
}

function validateHostsBaseline(value) {
  if (!isPlainRecord(value)) return fail('object required');
  const keys = Object.keys(value);
  if (keys.length !== HOSTS_BASELINE_FIELDS.size || !keys.every((key) => HOSTS_BASELINE_FIELDS.has(key))) {
    return fail('unexpected baseline shape');
  }
  if (typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(value.hash)) {
    return fail('hash must be SHA-256 hex');
  }
  if (typeof value.content !== 'string' || value.content.length > MAX_HOSTS_CONTENT_CHARS) {
    return fail('content must be bounded text');
  }
  if (typeof value.approvedAt !== 'string'
    || value.approvedAt.length === 0
    || value.approvedAt.length > MAX_TIMESTAMP_CHARS
    || Number.isNaN(Date.parse(value.approvedAt))) {
    return fail('approvedAt must be a timestamp');
  }
  return { ok: true, value };
}

function booleanEntry() {
  return validateBooleanSetting;
}

const RENDERER_WRITABLE_SETTINGS = Object.freeze({
  // Feature booleans written by Settings/Dashboard flows.
  'feature.realtimeProtection': booleanEntry(),
  'feature.autoReports': booleanEntry(),
  'feature.scanHistory': booleanEntry(),
  'feature.externalLookups': booleanEntry(),
  'feature.geoLookup': booleanEntry(),
  'feature.networkPerimeterMap': booleanEntry(),
  'feature.notificationsEnabled': booleanEntry(),
  'feature.scanNotifications': booleanEntry(),
  'feature.launchAtStartup': booleanEntry(),
  'feature.folderWatch': booleanEntry(),
  'feature.networkAlerts': booleanEntry(),
  'feature.networkTrafficHistory': booleanEntry(),
  'feature.aiAssistant': booleanEntry(),
  'feature.emergencyLockdown': booleanEntry(),
  'feature.privacyMode': booleanEntry(),
  // Report preferences.
  'reports.generateToolRunReports': booleanEntry(),
  'reports.skipDeleteConfirm': booleanEntry(),
  // Removable-drive auto-scan opt-in.
  'scan.autoScanRemovableDrives': booleanEntry(),
  // Setup completion marker.
  'app.setupComplete': booleanEntry(),
  // Enumerated / shaped values.
  'ui.theme': validateTheme,
  'ui.language': validateLocale,
  'feature.lastPasswordScore': validatePasswordScore,
  'processInspector.mode': validateProcessMode,
  'privacy.snapshot': validatePrivacySnapshot,
  'tools.hostsBaseline.v1': validateHostsBaseline,
});

function isRendererWritableSetting(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(RENDERER_WRITABLE_SETTINGS, key);
}

/**
 * Validate a renderer-supplied key/value pair.
 * @returns {{key: string, value: *}} normalized pair.
 * @throws {Error} with a deterministic, value-free message when the key is
 * not allowlisted or the value is invalid. Never writes to the database.
 */
function validateRendererSetting(key, value) {
  if (!isRendererWritableSetting(key)) {
    throw new Error('Setting is not writable from the renderer.');
  }
  const result = RENDERER_WRITABLE_SETTINGS[key](value);
  if (!result || result.ok !== true) {
    throw new Error(`Invalid value for setting "${key}".`);
  }
  return { key, value: result.value };
}

/**
 * Execute a renderer settings write: the exact logic owned by the
 * `db:setSetting` IPC handler, factored for direct testing. Dependencies are
 * injected so tests exercise this path without Electron.
 * @returns {*} the database write result.
 * @throws {Error} when the key/value is not allowlisted/valid. Nothing is
 * written (neither DB nor theme.json) in that case.
 */
function writeRendererSetting(deps, key, value) {
  const validated = validateRendererSetting(key, value);
  const result = deps.db.setSetting(validated.key, validated.value);
  if (validated.key === 'ui.theme') {
    try {
      const themePath = deps.path.join(deps.app.getPath('userData'), 'theme.json');
      deps.fs.writeFileSync(themePath, JSON.stringify({ theme: validated.value }, null, 2), 'utf8');
    } catch (_) { }
  }
  return result;
}

module.exports = {
  RENDERER_WRITABLE_SETTINGS,
  isRendererWritableSetting,
  validateRendererSetting,
  writeRendererSetting,
  CANONICAL_THEMES,
  THEME_ALIASES,
  PROCESS_MODES,
  PRIVACY_FEATURE_SET,
  MAX_SNAPSHOT_CHARS,
  MAX_HOSTS_CONTENT_CHARS,
};
