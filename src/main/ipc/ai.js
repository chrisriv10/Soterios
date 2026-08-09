'use strict';

const { ipcMain } = require('electron');
const {
  DEFAULT_HOST,
  normalizeHost,
  isValidHost,
  validateMessages,
  fetchModelTags,
  streamChat,
} = require('./ollamaClient');

const HOST_SETTING_KEY = 'ai.ollama.host';
const MODEL_SETTING_KEY = 'ai.ollama.model';
const REQUEST_TIMEOUT_MS = 120000;

const activeRequests = new Map();

function sendChunk(event, payload) {
  if (!event.sender.isDestroyed()) {
    event.sender.send('ai:chat:chunk', payload);
  }
}

function cancelRequest(requestId) {
  const entry = activeRequests.get(requestId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  try {
    entry.controller.abort();
  } catch (_) {}
  activeRequests.delete(requestId);
  return true;
}

function getConfig(db) {
  return {
    host: normalizeHost(db.getSetting(HOST_SETTING_KEY, DEFAULT_HOST)),
    model: String(db.getSetting(MODEL_SETTING_KEY, '') || '')
  };
}

function register(mainWindow, { db }) {
  ipcMain.handle('ai:status', async () => {
    const { host } = getConfig(db);
    if (!isValidHost(host)) {
      return { ok: false, running: false, error: `Invalid Ollama host: ${host}` };
    }
    const tags = await fetchModelTags(host, { timeoutMs: 4000 });
    return {
      ok: tags.ok,
      running: tags.ok,
      error: tags.ok ? '' : tags.error,
      version: tags.version || '',
      models: tags.models || [],
      host
    };
  });

  ipcMain.handle('ai:chat', async (event, request) => {
    const messages = request && request.messages;
    const model = request && request.model;
    validateMessages(messages);

    const { host } = getConfig(db);
    if (!isValidHost(host)) {
      throw new Error(`Invalid Ollama host: ${host}`);
    }
    if (typeof model !== 'string' || model.trim() === '') {
      throw new Error('No model selected');
    }

    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort(new Error('Ollama request timed out'));
      } catch (_) {}
    }, REQUEST_TIMEOUT_MS);
    activeRequests.set(requestId, { controller, timer });

    sendChunk(event, { requestId, type: 'start' });

    streamChat(host, messages, model, {
      onDelta: (delta) => sendChunk(event, { requestId, type: 'delta', delta }),
      onDone: () => {
        clearTimeout(timer);
        activeRequests.delete(requestId);
        sendChunk(event, { requestId, type: 'done' });
      },
      signal: controller.signal
    }).catch((err) => {
      clearTimeout(timer);
      activeRequests.delete(requestId);
      const cancelled = !!(err && err.message === 'cancelled');
      sendChunk(event, { requestId, type: 'error', error: cancelled ? 'cancelled' : (err && err.message ? err.message : 'Unknown Ollama error') });
    });

    return { requestId };
  });

  ipcMain.handle('ai:chat:cancel', (_event, requestId) => {
    return { cancelled: cancelRequest(String(requestId || '')) };
  });

  ipcMain.handle('ai:config:get', () => getConfig(db));

  ipcMain.handle('ai:config:set', (_event, config) => {
    const next = config || {};
    const host = normalizeHost(next.host || DEFAULT_HOST);
    if (!isValidHost(host)) {
      throw new Error(`Invalid Ollama host: ${host} (only localhost is allowed)`);
    }
    db.setSetting(HOST_SETTING_KEY, host);
    if (typeof next.model === 'string') {
      db.setSetting(MODEL_SETTING_KEY, next.model.trim());
    }
    return getConfig(db);
  });

  // Clean up any in-flight requests when the window closes.
  const onWindowClosed = () => {
    for (const requestId of Array.from(activeRequests.keys())) {
      cancelRequest(requestId);
    }
  };
  if (mainWindow) {
    mainWindow.once('closed', onWindowClosed);
  }
}

module.exports = { register };
