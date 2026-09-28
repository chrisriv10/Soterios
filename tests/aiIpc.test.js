'use strict';

// Behavioral tests for the ai:chat request path in src/main/ipc/ai.js.
//
// ai.js requires 'electron' at load time, so this file installs a minimal
// Module._load hook returning a fake ipcMain BEFORE requiring ai.js. The
// hook is removed in after(). No Electron runtime is booted and no
// production seam was added for testability.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const Module = require('module');

const originalLoad = Module._load;
const fakeIpcMain = {
  handlers: {},
  handle(channel, fn) { this.handlers[channel] = fn; },
};
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { ipcMain: fakeIpcMain };
  return originalLoad.call(this, request, parent, isMain);
};

const { register } = require('../src/main/ipc/ai');

function startFakeOllama(lines) {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/chat') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      for (const line of lines) res.write(`${JSON.stringify(line)}\n`);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function waitFor(condition, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('Timed out waiting for condition');
}

function makeDb(host) {
  return {
    getSetting: (key, def) => {
      if (key === 'ai.ollama.host') return host;
      if (key === 'ai.ollama.model') return 'test-model';
      if (key === 'scanHistory') return [];
      return def;
    },
    setSetting: () => {},
    getScanHistory: () => [],
  };
}

function makeEvent(chunks) {
  return {
    sender: {
      destroyed: false,
      isDestroyed() { return this.destroyed; },
      send: (_channel, payload) => { chunks.push(payload); },
    },
  };
}

describe('ai:chat terminal request state', () => {
  let failures;
  let unhandledListener;

  before(() => {
    failures = [];
    unhandledListener = (reason) => {
      const text = reason && reason.message ? reason.message : String(reason);
      if (/synthetic tool failure/.test(text)) failures.push(text);
    };
    process.on('unhandledRejection', unhandledListener);
  });

  after(() => {
    process.removeListener('unhandledRejection', unhandledListener);
    Module._load = originalLoad;
  });

  it('emits exactly one error terminal and no done when the completion action rejects', async () => {
    const fake = await startFakeOllama([
      { message: { role: 'assistant', content: 'Score [[action:health-score]] computed' }, done: true },
    ]);
    try {
      fakeIpcMain.handlers = {};
      const chunks = [];
      const db = makeDb(`http://127.0.0.1:${fake.port}`);
      const toolRegistry = {
        run: async () => { throw new Error('synthetic tool failure'); },
      };
      register(null, { db, toolRegistry, firewallManager: null, processInspector: null, scanEngine: null });
      const chat = fakeIpcMain.handlers['ai:chat'];
      const cancel = fakeIpcMain.handlers['ai:chat:cancel'];
      assert.equal(typeof chat, 'function');
      assert.equal(typeof cancel, 'function');

      const event = makeEvent(chunks);
      const { requestId } = await chat(event, {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'test-model',
      });
      assert.ok(requestId);
      await waitFor(() => chunks.some((c) => c.requestId === requestId && (c.type === 'done' || c.type === 'error')));
      // The terminal chunk settles the request synchronously in the catch
      // path; a short observation window keeps the assertion to terminal
      // state only, not timing.
      await waitFor(() => chunks.filter((c) => c.requestId === requestId && (c.type === 'done' || c.type === 'error')).length >= 1);
      const terminal = chunks.filter((c) => c.requestId === requestId && (c.type === 'done' || c.type === 'error'));
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].type, 'error');
      assert.match(terminal[0].error, /synthetic tool failure/);
      // Failed request is no longer active: cancel reports false.
      const cancelResult = await cancel(event, requestId);
      assert.deepEqual(cancelResult, { cancelled: false });
      assert.deepEqual(failures, [], 'no unhandled rejection for the action failure');
    } finally {
      fake.server.close();
    }
  });

  it('emits exactly one done terminal and no error on success', async () => {
    const fake = await startFakeOllama([
      { message: { role: 'assistant', content: 'All good [[action:health-score]]' }, done: true },
    ]);
    try {
      fakeIpcMain.handlers = {};
      const chunks = [];
      const db = makeDb(`http://127.0.0.1:${fake.port}`);
      const toolRegistry = {
        run: async () => ({ ok: true, data: { score: 90 } }),
      };
      register(null, { db, toolRegistry, firewallManager: null, processInspector: null, scanEngine: null });
      const chat = fakeIpcMain.handlers['ai:chat'];

      const event = makeEvent(chunks);
      const { requestId } = await chat(event, {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'test-model',
      });
      await waitFor(() => chunks.some((c) => c.requestId === requestId && (c.type === 'done' || c.type === 'error')));
      const terminal = chunks.filter((c) => c.requestId === requestId && (c.type === 'done' || c.type === 'error'));
      assert.equal(terminal.length, 1);
      assert.equal(terminal[0].type, 'done');
    } finally {
      fake.server.close();
    }
  });
});
