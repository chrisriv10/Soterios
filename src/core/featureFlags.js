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
  vpnAutoConnect: false,
});

const FLAG_KEYS = Object.freeze(Object.keys(DEFAULT_FLAGS));

function isKnownFlag(key) {
  const logicalKey = key.startsWith('feature.') ? key.substring(8) : key;
  return Object.prototype.hasOwnProperty.call(DEFAULT_FLAGS, logicalKey);
}

function getFlag(db, key, fallback) {
  if (!isKnownFlag(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  const dbKey = key.startsWith('feature.') ? key : `feature.${key}`;
  const raw = db.getSetting(dbKey, undefined);
  if (raw === undefined || raw === null) {
    const logicalKey = key.startsWith('feature.') ? key.substring(8) : key;
    return typeof fallback === 'undefined' ? DEFAULT_FLAGS[logicalKey] : fallback;
  }
  return Boolean(raw);
}

function setFlag(db, key, value) {
  if (!isKnownFlag(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  const boolValue = Boolean(value);
  const dbKey = key.startsWith('feature.') ? key : `feature.${key}`;
  db.setSetting(dbKey, boolValue);
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
