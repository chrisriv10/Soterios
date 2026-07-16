module.exports = async function echoScript(args = {}) {
  return { echoed: args.message || 'ok' };
};
