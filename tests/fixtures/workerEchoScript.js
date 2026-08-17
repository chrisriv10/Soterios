/**
 * Test fixture: echoes the supplied message back.
 *
 * @param {Object} [args={}]
 * @param {string} [args.message] - Message to echo.
 * @returns {{ echoed: string }} Echoed payload.
 */
module.exports = async function echoScript(args = {}) {
  return { echoed: args.message || 'ok' };
};
