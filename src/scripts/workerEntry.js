'use strict';

const { parentPort, workerData } = require('worker_threads');

(async () => {
  try {
    const { scriptPath, args } = workerData || {};
    if (!scriptPath) throw new Error('No script path provided');
    const scriptFn = require(scriptPath);
    if (typeof scriptFn !== 'function') throw new Error('Script does not export a function');

    const onProgress = (payload) => {
      parentPort.postMessage({ type: 'progress', payload });
    };

    const result = await scriptFn(args || {}, onProgress);
    parentPort.postMessage({ type: 'done', ok: true, result });
  } catch (err) {
    parentPort.postMessage({
      type: 'done',
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
})();
