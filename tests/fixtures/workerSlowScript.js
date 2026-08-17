/**
 * Test fixture: delays for the requested duration then resolves.
 *
 * @param {Object} [args={}]
 * @param {number} [args.delayMs=5000] - Delay in milliseconds.
 * @returns {{ done: boolean }} Always resolves with `{ done: true }`.
 */
module.exports = async function slowScript(args = {}) {
  const delayMs = Number(args.delayMs) || 5000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { done: true };
};
