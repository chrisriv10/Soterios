'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const logger = require('../utils/logger');

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
// A cold Windows API walk can occasionally stall behind WMI/CIM and security
// software activity. Five seconds caused healthy helpers to be discarded.
const REQUEST_TIMEOUT_MS = 15000;

function defaultCandidates(resourcesPath) {
  const candidates = [];
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'native', 'soterios-process-inspector.exe'));
  candidates.push(path.join(__dirname, '../../native/process-inspector/target/release/soterios-process-inspector.exe'));
  candidates.push(path.join(__dirname, '../../native/process-inspector/target/debug/soterios-process-inspector.exe'));
  return candidates;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function expectedHashFor(binaryPath) {
  const manifestPath = path.join(path.dirname(binaryPath), 'checksums.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return typeof manifest[path.basename(binaryPath)] === 'string'
      ? manifest[path.basename(binaryPath)].toLowerCase()
      : null;
  } catch (_) {
    return null;
  }
}

class NativeProcessClient {
  constructor(options = {}) {
    this.resourcesPath = options.resourcesPath || null;
    this.binaryPath = options.binaryPath || null;
    this.requireIntegrityManifest = !!options.requireIntegrityManifest;
    this.child = null;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.capabilities = null;
    this.protocolVersion = null;
    this._helloPromise = null;
    this._helloResolve = null;
    this._helloReject = null;
  }

  findBinary() {
    if (this.binaryPath) return fs.existsSync(this.binaryPath) ? this.binaryPath : null;
    return defaultCandidates(this.resourcesPath).find((candidate) => fs.existsSync(candidate)) || null;
  }

  verifyBinary(binaryPath) {
    const expected = expectedHashFor(binaryPath);
    if (!expected) {
      if (this.requireIntegrityManifest) throw new Error('Native collector integrity manifest is missing.');
      return { verified: false, reason: 'development build without integrity manifest' };
    }
    const actual = sha256File(binaryPath);
    if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) {
      throw new Error('Native collector failed its integrity check.');
    }
    return { verified: true, sha256: actual };
  }

  async start() {
    if (this.child) return { protocolVersion: this.protocolVersion, capabilities: this.capabilities };
    const binaryPath = this.findBinary();
    if (!binaryPath) throw new Error('Native process collector is not installed.');
    this.verifyBinary(binaryPath);

    this._helloPromise = new Promise((resolve, reject) => {
      this._helloResolve = resolve;
      this._helloReject = reject;
    });
    this.child = spawn(binaryPath, ['--stdio'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    const lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this._handleLine(line));
    this.child.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) logger.debug('Native process collector diagnostic', { message: message.slice(0, 500) });
    });
    this.child.once('error', (error) => this._failAll(error));
    this.child.once('exit', (code, signal) => {
      this._failAll(new Error(`Native process collector exited (${code ?? signal ?? 'unknown'}).`));
      this.child = null;
    });

    const timeout = setTimeout(() => {
      this._helloReject?.(new Error('Native process collector handshake timed out.'));
    }, 3000);
    try {
      const hello = await this._helloPromise;
      if (hello.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(`Unsupported native collector protocol ${hello.protocolVersion}.`);
      }
      this.protocolVersion = hello.protocolVersion;
      this.capabilities = hello.capabilities || {};
      return hello;
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  _handleLine(line) {
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
      this._failAll(new Error('Native collector returned an oversized message.'));
      this.stop().catch(() => {});
      return;
    }
    let message;
    try { message = JSON.parse(line); } catch (_) { return; }
    if (message.type === 'hello') {
      this._helloResolve?.(message);
      this._helloResolve = null;
      this._helloReject = null;
      return;
    }
    const requestId = String(message.requestId || '');
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (message.ok === false) pending.reject(new Error(message.error || 'Native collector request failed.'));
    else pending.resolve(message.data);
  }

  _failAll(error) {
    this._helloReject?.(error);
    this._helloResolve = null;
    this._helloReject = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!this.child || !this.child.stdin.writable) return Promise.reject(new Error('Native collector is not running.'));
    const requestId = String(this.nextRequestId++);
    const message = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, requestId, method, params });
    if (Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES) return Promise.reject(new Error('Native collector request is too large.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Native collector request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child.stdin.write(message + '\n', (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  sample() { return this.request('snapshot'); }
  getDetails(processKey, sections) { return this.request('details', { processKey, sections }, 15000); }
  performAction(payload) { return this.request('action', payload, 30000); }

  async stop() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    this._failAll(new Error('Native collector stopped.'));
    try { child.stdin.end(); } catch (_) {}
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill(); } catch (_) {}
        resolve();
      }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

module.exports = {
  MAX_MESSAGE_BYTES,
  NativeProcessClient,
  PROTOCOL_VERSION,
  defaultCandidates,
};
