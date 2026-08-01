// src/core/featureFlags.js
// Single source of truth for feature-flag defaults, typed keys, and
// get/set semantics. Falls back to defaults when a key is missing from
// the database, and rejects writes to unknown keys in debug builds.

const DEFAULT_FLAGS = Object.freeze({
  realtimeProtection: true,
  autoReports: true,
  scanHistory: true,
  externalLookups: true,
  geoLookup: true,
  networkPerimeterMap: true,
  notificationsEnabled: true,
  scanNotifications: true,
  launchAtStartup: false,
  folderWatch: true,
  networkAlerts: true,
  networkTrafficHistory: true,
  autoUpdates: true,
});

const FLAG_KEYS = Object.freeze(Object.keys(DEFAULT_FLAGS));

function isKnownFlag(key) {
  return Object.prototype.hasOwnProperty.call(DEFAULT_FLAGS, key);
}

function getFlag(db, key, fallback) {
  if (!isKnownFlag(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  const raw = db.getSetting(key, undefined);
  if (raw === undefined || raw === null) {
    return typeof fallback === 'undefined' ? DEFAULT_FLAGS[key] : fallback;
  }
  return Boolean(raw);
}

function setFlag(db, key, value) {
  if (!isKnownFlag(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  const boolValue = Boolean(value);
  db.setSetting(key, boolValue);
  return boolValue;
}

function getDefaults() {
  return { ...DEFAULT_FLAGS };
}

module.exports = {
  DEFAULT_FLAGS,
  FLAG_KEYS,
  isKnownFlag,
  getFlag,
  setFlag,
  getDefaults,
};
