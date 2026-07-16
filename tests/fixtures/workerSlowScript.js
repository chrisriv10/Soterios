module.exports = async function slowScript(args = {}) {
  const delayMs = Number(args.delayMs) || 5000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { done: true };
};
