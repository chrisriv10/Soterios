// childRunner.js
// Usage: fork this module with two args: <absoluteScriptPath> <jsonArgs>
// It will require the script, invoke it with args plus a progress callback,
// and send the result via IPC. Messages sent back to the parent are tagged
// with a 'type' field ('progress' vs 'done') so progress updates sent
// during a script's run are never mistaken for its final result.

(async () => {
  try {
    const scriptPath = process.argv[2];
    const raw = process.argv[3] || '{}';
    const args = JSON.parse(raw);
    if (!scriptPath) throw new Error('No script path provided');
    const scriptFn = require(scriptPath);
    if (typeof scriptFn !== 'function') throw new Error('Script does not export a function');

    // Passed as a second argument to every script. Scripts that don't
    // accept/call it (most of them -- only file-walk-based scripts report
    // progress) simply ignore the extra argument, which is safe in JS.
    const onProgress = (payload) => {
      if (process && process.send) {
        try { process.send({ type: 'progress', payload }); } catch (_) {}
      }
    };

    const result = await scriptFn(args || {}, onProgress);
    if (process && process.send) process.send({ type: 'done', ok: true, result });
    process.exit(0);
  } catch (err) {
    if (process && process.send) process.send({ type: 'done', ok: false, error: err && err.message ? err.message : String(err), stack: err && err.stack });
    process.exit(1);
  }
})();