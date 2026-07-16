'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const workerManager = require('../src/core/workerManager');

describe('workerManager', () => {
  it('runs a script in a worker thread and returns the result', async () => {
    const scriptPath = path.join(__dirname, 'fixtures/workerEchoScript.js');
    const result = await workerManager.runTask({
      scriptPath,
      args: { message: 'hello-worker' }
    });
    assert.deepEqual(result, { echoed: 'hello-worker' });
  });

  it('rejects canceled tasks', async () => {
    const scriptPath = path.join(__dirname, 'fixtures/workerEchoScript.js');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => workerManager.runTask({ scriptPath, args: {}, signal: controller.signal }),
      /canceled/i
    );
  });
});
