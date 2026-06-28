// childRunner.js
// Usage: fork this module with two args: <absoluteScriptPath> <jsonArgs>
// It will require the script, invoke it with args, and send result via IPC.

(async () => {
  try {
    const scriptPath = process.argv[2];
    const raw = process.argv[3] || '{}';
    const args = JSON.parse(raw);
    if (!scriptPath) throw new Error('No script path provided');
    const scriptFn = require(scriptPath);
    if (typeof scriptFn !== 'function') throw new Error('Script does not export a function');
    const result = await scriptFn(args || {});
    if (process && process.send) process.send({ ok: true, result });
    process.exit(0);
  } catch (err) {
    if (process && process.send) process.send({ ok: false, error: err && err.message ? err.message : String(err), stack: err && err.stack });
    process.exit(1);
  }
})();
