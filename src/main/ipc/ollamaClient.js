'use strict';

/**
 * Pure Ollama HTTP client — no Electron imports so it can be unit-tested
 * with plain Node. ai.js wires this to IPC.
 */

const DEFAULT_HOST = 'http://localhost:11434';
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 20000;

function normalizeHost(host) {
  let value = String(host || '').trim();
  if (!value) return DEFAULT_HOST;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value.replace(/\/+$/, '');
}

function isValidHost(host) {
  let value = normalizeHost(host);
  let url = null;
  try {
    url = new URL(value);
  } catch (_) {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error('Messages must be an array');
  }
  if (messages.length === 0) {
    throw new Error('No messages provided');
  }
  if (messages.length > MAX_MESSAGES) {
    throw new Error(`Message history too long (max ${MAX_MESSAGES})`);
  }
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      throw new Error('Each message must be an object');
    }
    const role = message.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      throw new Error(`Unsupported message role: ${String(role)}`);
    }
    if (typeof message.content !== 'string' || message.content.trim() === '') {
      throw new Error('Message content must be a non-empty string');
    }
    if (message.content.length > MAX_MESSAGE_CHARS) {
      throw new Error(`Message too long (max ${MAX_MESSAGE_CHARS} chars)`);
    }
  }
  return true;
}

function buildChatPayload(messages, model, systemPrompt) {
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error('No model selected');
  }
  const payloadMessages = [];
  if (typeof systemPrompt === 'string' && systemPrompt.trim() !== '') {
    payloadMessages.push({ role: 'system', content: systemPrompt.slice(0, MAX_MESSAGE_CHARS) });
  }
  payloadMessages.push(...messages);
  return {
    model: model.trim(),
    messages: payloadMessages,
    stream: true,
    options: { temperature: 0.4 }
  };
}

async function fetchModelTags(host, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const base = normalizeHost(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Ollama connection timed out')), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api/tags`, {
      method: 'GET',
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`Ollama responded with HTTP ${res.status}`);
    }
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models.map((m) => ({
      name: m.name,
      size: m.size || 0,
      modified_at: m.modified_at || ''
    })) : [];
    return { ok: true, models, version: data.version || '' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streams a chat completion. Calls onDelta(text) per chunk, then onDone().
 * Uses NDJSON from Ollama /api/chat. Resolves when the stream finishes
 * cleanly, rejects on transport/parse errors or abort.
 */
async function streamChat(host, messages, model, { systemPrompt, onDelta, onDone, signal, fetchImpl = fetch } = {}) {
  const base = normalizeHost(host);
  const payload = buildChatPayload(messages, model, systemPrompt);
  let response = null;
  try {
    response = await fetchImpl(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
  } catch (err) {
    const aborted = signal && signal.aborted;
    throw aborted ? new Error('cancelled') : new Error(`Could not reach Ollama at ${base}`);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      if (text) detail = `: ${text.slice(0, 300)}`;
    } catch (_) {}
    throw new Error(`Ollama responded with HTTP ${response.status}${detail}`);
  }
  if (!response.body) {
    throw new Error('Ollama returned an empty stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    let chunk = null;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (signal && signal.aborted) throw new Error('cancelled');
      throw err;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        let json = null;
        try {
          json = JSON.parse(line);
        } catch (_) {
          throw new Error('Received malformed stream data from Ollama');
        }
        if (json.error) {
          throw new Error(String(json.error).slice(0, 300));
        }
        const content = json.message && typeof json.message.content === 'string' ? json.message.content : '';
        if (content) {
          if (onDelta) onDelta(content);
        }
        if (json.done) {
          if (onDone) onDone();
          return;
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }
  // Stream ended without a done marker.
  if (onDone) onDone();
}

module.exports = {
  DEFAULT_HOST,
  MAX_MESSAGES,
  MAX_MESSAGE_CHARS,
  normalizeHost,
  isValidHost,
  validateMessages,
  buildChatPayload,
  fetchModelTags,
  streamChat
};
