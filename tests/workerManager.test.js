'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
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

  it('exposes cancel() on the returned task handle', async () => {
    const scriptPath = path.join(__dirname, 'fixtures/workerSlowScript.js');
    const task = workerManager.runTask({ scriptPath, args: { delayMs: 5000 } });
    assert.equal(typeof task.cancel, 'function');
    assert.equal(task.cancel(), true);
    await assert.rejects(() => task, /canceled|exited/i);
  });

  it('cancels tracked child processes before reporting a timeout', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-worker-'));
    const pidFile = path.join(tempDir, 'child.pid');
    const scriptPath = path.join(__dirname, 'fixtures/workerChildScript.js');

    try {
      await assert.rejects(
        () => workerManager.runTask({ scriptPath, args: { pidFile }, timeoutMs: 1_500 }),
        /timed out/i
      );

      const pidDeadline = Date.now() + 1_000;
      while (!fs.existsSync(pidFile) && Date.now() < pidDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(fs.existsSync(pidFile), true, 'fixture should start a tracked child process');
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      assert.ok(Number.isInteger(pid) && pid > 0);
      const deadline = Date.now() + 2_000;
      let alive = true;
      while (alive && Date.now() < deadline) {
        try { process.kill(pid, 0); } catch (_) { alive = false; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(alive, false, 'tracked child should be cleaned up before timeout settles');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
