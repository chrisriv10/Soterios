/**
 * Centralised progress normalisation used by the scan engine and IPC
 * handlers. Guarantees finite integers in the 0-100 range so every
 * caller does not have to re-implement the same guards.
 */

/**
 * Clamp a raw progress value to a safe 0-100 integer.
 * @param {*} value - Raw progress value.
 * @returns {number} Clamped integer percentage.
 */
function clampProgress(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

module.exports = {
  clampProgress,
};
