/**
 * Single source of truth for feature-flag defaults, typed keys, and
 * get/set semantics. Falls back to defaults when a key is missing from
 * the database, and rejects writes to unknown keys in debug builds.
 */

/**
 * Check whether a flag key is known.
 * @param {string} key
 * @returns {boolean}
 */
function isKnownFlag(key) {
  const logicalKey = key.startsWith('feature.') ? key.substring(8) : key;
  return Object.prototype.hasOwnProperty.call(DEFAULT_FLAGS, logicalKey);
}

  /**
   * Get a boolean feature flag from the database or default.
   * @param {object} db
   * @param {string} key
   * @param {*} [fallback]
   * @returns {boolean}
   */
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

  /**
   * Set a boolean feature flag in the database.
   * @param {object} db
   * @param {string} key
   * @param {boolean} value
   * @returns {boolean}
   */
  function setFlag(db, key, value) {
  if (!isKnownFlag(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  const boolValue = Boolean(value);
  const dbKey = key.startsWith('feature.') ? key : `feature.${key}`;
  db.setSetting(dbKey, boolValue);
  return boolValue;
}

  /**
   * Get a shallow copy of the default feature flags.
   * @returns {Object}
   */
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
