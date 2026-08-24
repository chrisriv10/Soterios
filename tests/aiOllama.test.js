'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const {
  DEFAULT_HOST,
  normalizeHost,
  isValidHost,
  validateMessages,
  buildChatPayload,
  fetchModelTags,
  streamChat,
} = require('../src/main/ipc/ollamaClient');

function startFakeOllama(handler) {
  const server = http.createServer((req, res) => handler(req, res));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function ndjsonResponse(res, lines) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  for (const line of lines) {
    res.write(`${JSON.stringify(line)}\n`);
  }
  res.end();
}

describe('ollamaClient normalizeHost', () => {
  it('returns default host for empty input', () => {
    assert.equal(normalizeHost(''), DEFAULT_HOST);
    assert.equal(normalizeHost(null), DEFAULT_HOST);
    assert.equal(normalizeHost('   '), DEFAULT_HOST);
  });

  it('adds http:// when scheme is missing', () => {
    assert.equal(normalizeHost('localhost:11434'), 'http://localhost:11434');
  });

  it('strips trailing slashes', () => {
    assert.equal(normalizeHost('http://localhost:11434///'), 'http://localhost:11434');
  });

  it('keeps https scheme', () => {
    assert.equal(normalizeHost('https://localhost:11435'), 'https://localhost:11435');
  });
});

describe('ollamaClient isValidHost', () => {
  it('accepts localhost variants', () => {
    assert.equal(isValidHost('http://localhost:11434'), true);
    assert.equal(isValidHost('localhost:11434'), true);
    assert.equal(isValidHost('http://127.0.0.1:11434'), true);
    assert.equal(isValidHost('http://[::1]:11434'), true);
  });

  it('rejects remote and malformed hosts', () => {
    assert.equal(isValidHost('http://ollama.example.com'), false);
    assert.equal(isValidHost('https://api.openai.com'), false);
    assert.equal(isValidHost('ftp://localhost'), false);
    assert.equal(isValidHost('not a url'), false);
    assert.equal(isValidHost('http://'), false);
  });
});

describe('ollamaClient validateMessages', () => {
  it('accepts a valid history', () => {
    assert.equal(validateMessages([{ role: 'user', content: 'hi' }]), true);
    assert.equal(
      validateMessages([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
      true
    );
  });

  it('rejects non-array, empty, and oversized histories', () => {
    assert.throws(() => validateMessages('nope'), /array/i);
    assert.throws(() => validateMessages([]), /No messages/i);
    const tooMany = Array.from({ length: 51 }, () => ({ role: 'user', content: 'x' }));
    assert.throws(() => validateMessages(tooMany), /too long/i);
  });

  it('rejects bad roles, content types, and oversized content', () => {
    assert.throws(() => validateMessages([{ role: 'admin', content: 'x' }]), /role/i);
    assert.throws(() => validateMessages([{ role: 'user', content: '' }]), /non-empty/i);
    assert.throws(() => validateMessages([{ role: 'user', content: 42 }]), /non-empty/i);
    assert.throws(() => validateMessages([{ role: 'user', content: 'x'.repeat(20001) }]), /too long/i);
  });
});

describe('ollamaClient buildChatPayload', () => {
  it('builds a streaming payload with the model', () => {
    const payload = buildChatPayload([{ role: 'user', content: 'hi' }], 'llama3.2');
    assert.equal(payload.model, 'llama3.2');
    assert.equal(payload.stream, true);
    assert.equal(payload.messages.length, 1);
  });

  it('rejects a missing model', () => {
    assert.throws(() => buildChatPayload([{ role: 'user', content: 'hi' }], ''), /model/i);
    assert.throws(() => buildChatPayload([{ role: 'user', content: 'hi' }], undefined), /model/i);
  });

  it('prepends a system message when a system prompt is given', () => {
    const payload = buildChatPayload([{ role: 'user', content: 'hi' }], 'llama3.2', 'You are strict.');
    assert.equal(payload.messages.length, 2);
    assert.equal(payload.messages[0].role, 'system');
    assert.equal(payload.messages[0].content, 'You are strict.');
    assert.equal(payload.messages[1].role, 'user');
  });

  it('does not prepend a system message for empty or missing prompts', () => {
    assert.equal(buildChatPayload([{ role: 'user', content: 'hi' }], 'llama3.2').messages.length, 1);
    assert.equal(buildChatPayload([{ role: 'user', content: 'hi' }], 'llama3.2', '').messages.length, 1);
    assert.equal(buildChatPayload([{ role: 'user', content: 'hi' }], 'llama3.2', '   ').messages.length, 1);
  });
});

describe('ollamaClient fetchModelTags', () => {
  let fake;

  before(async () => {
    fake = await startFakeOllama((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3.2', size: 123, modified_at: 'now' }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  after(() => fake.server.close());

  it('returns models from the tags endpoint', async () => {
    const result = await fetchModelTags(`http://127.0.0.1:${fake.port}`, { fetchImpl: fetch });
    assert.equal(result.ok, true);
    assert.equal(result.models.length, 1);
    assert.equal(result.models[0].name, 'llama3.2');
  });

  it('reports unreachable servers as ok:false', async () => {
    const result = await fetchModelTags('http://127.0.0.1:1', { timeoutMs: 500, fetchImpl: fetch });
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('times out on a hanging server', async () => {
    const result = await fetchModelTags(`http://127.0.0.1:${fake.port}`, {
      timeoutMs: 30,
      fetchImpl: (url, opts) => new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(opts.signal.reason || new Error('aborted')));
      })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /timed out/i);
  });
});

describe('ollamaClient streamChat', () => {
  let fake;
  const deltas = ['Hel', 'lo ', 'world'];
  const chunks = [
    ...deltas.map((d) => ({ message: { role: 'assistant', content: d } })),
    { message: { role: 'assistant', content: '' }, done: true }
  ];

  before(async () => {
    fake = await startFakeOllama((req, res) => {
      if (req.url === '/api/chat') {
        ndjsonResponse(res, chunks);
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  after(() => fake.server.close());

  it('streams deltas and calls onDone', async () => {
    const received = [];
    let done = false;
    await streamChat(
      `http://127.0.0.1:${fake.port}`,
      [{ role: 'user', content: 'hi' }],
      'llama3.2',
      {
        onDelta: (d) => received.push(d),
        onDone: () => { done = true; },
        fetchImpl: fetch
      }
    );
    assert.deepEqual(received, deltas);
    assert.equal(done, true);
  });

  it('sends the system prompt as the first message', async () => {
    let sentBody = null;
    const captureServer = await startFakeOllama((req, res) => {
      if (req.url === '/api/chat') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          sentBody = JSON.parse(body);
          ndjsonResponse(res, [{ message: { role: 'assistant', content: 'ok' }, done: true }]);
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    try {
      await streamChat(
        `http://127.0.0.1:${captureServer.port}`,
        [{ role: 'user', content: 'hi' }],
        'llama3.2',
        { systemPrompt: 'You are strict.', fetchImpl: fetch }
      );
      assert.ok(sentBody, 'expected a request body');
      assert.equal(sentBody.messages.length, 2);
      assert.equal(sentBody.messages[0].role, 'system');
      assert.equal(sentBody.messages[0].content, 'You are strict.');
    } finally {
      captureServer.server.close();
    }
  });

  it('throws on an HTTP error status', async () => {
    await assert.rejects(
      streamChat(
        `http://127.0.0.1:${fake.port}`,
        [{ role: 'user', content: 'hi' }],
        'llama3.2',
        { fetchImpl: () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') }) }
      ),
      /HTTP 500/
    );
  });

  it('throws cancelled when aborted mid-stream', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      streamChat(
        `http://127.0.0.1:${fake.port}`,
        [{ role: 'user', content: 'hi' }],
        'llama3.2',
        { signal: controller.signal, fetchImpl: fetch }
      ),
      /cancelled/
    );
  });

  it('throws when Ollama reports an error line', async () => {
    const errorServer = await startFakeOllama((req, res) => {
      ndjsonResponse(res, [{ error: 'model not found' }]);
    });
    try {
      await assert.rejects(
        streamChat(
          `http://127.0.0.1:${errorServer.port}`,
          [{ role: 'user', content: 'hi' }],
          'llama3.2',
          { fetchImpl: fetch }
        ),
        /model not found/
      );
    } finally {
      errorServer.server.close();
    }
  });

  it('throws on malformed stream data', async () => {
    const malformedServer = await startFakeOllama((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.end('{not json}\n');
    });
    try {
      await assert.rejects(
        streamChat(
          `http://127.0.0.1:${malformedServer.port}`,
          [{ role: 'user', content: 'hi' }],
          'llama3.2',
          { fetchImpl: fetch }
        ),
        /malformed/i
      );
    } finally {
      malformedServer.server.close();
    }
  });
});
