'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TRACE_FORMAT = 'soterios-process-trace';
const TRACE_VERSION = 1;
const MAX_TRACE_BYTES = 128 * 1024 * 1024;

function redactText(value, mode) {
  if (value == null) return value;
  if (mode === 'none') return value;
  const text = String(value);
  return text
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/gi, '%USERPROFILE%')
    .replace(/\\\\[^\\\s]+\\[^\s"']+/g, '<network-path>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip-address>');
}

function redactProcess(proc, mode = 'standard') {
  if (!proc || typeof proc !== 'object') return proc;
  const copy = { ...proc };
  if (mode !== 'none') {
    copy.user = copy.user ? '<user>' : copy.user;
    copy.path = redactText(copy.path, mode);
    copy.commandLine = mode === 'strict' ? (copy.name || '<redacted>') : redactText(copy.commandLine, mode);
    copy.cmd = copy.commandLine;
    copy.args = mode === 'strict' ? null : redactText(copy.args, mode);
    if (Array.isArray(copy.connections)) {
      copy.connections = copy.connections.map((connection) => ({
        ...connection,
        remoteAddress: mode === 'strict' ? '<redacted>' : redactText(connection.remoteAddress, mode),
        localAddress: mode === 'strict' ? '<redacted>' : redactText(connection.localAddress, mode),
      }));
    }
  }
  return copy;
}

function buildTracePayload(snapshot, histories, options = {}) {
  const redaction = ['none', 'standard', 'strict'].includes(options.redaction) ? options.redaction : 'standard';
  const processes = (snapshot.processes || []).map((proc) => redactProcess(proc, redaction));
  const history = {};
  for (const [key, samples] of histories || []) {
    history[key] = Array.isArray(samples) ? samples.slice() : [];
  }
  return {
    format: TRACE_FORMAT,
    version: TRACE_VERSION,
    createdAt: new Date().toISOString(),
    redaction,
    source: {
      app: 'Soterios',
      collector: snapshot.capabilities && snapshot.capabilities.provider,
      protocolVersion: snapshot.protocolVersion || 1,
    },
    snapshot: { ...snapshot, processes },
    history,
  };
}

async function deriveArgon2id(passphrase, salt) {
  let argon2;
  try { argon2 = require('argon2'); } catch (_) {
    throw new Error('Argon2id support is unavailable in this build.');
  }
  return argon2.hash(String(passphrase), {
    type: argon2.argon2id,
    raw: true,
    salt,
    hashLength: 32,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 1,
  });
}

async function encryptTrace(payload, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 10 || passphrase.length > 256) {
    throw new Error('Trace passphrase must be between 10 and 256 characters.');
  }
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plaintext.length > MAX_TRACE_BYTES) throw new Error('Trace is too large to export safely.');
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = await deriveArgon2id(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  return Buffer.from(JSON.stringify({
    format: `${TRACE_FORMAT}-encrypted`,
    version: TRACE_VERSION,
    cipher: 'AES-256-GCM',
    kdf: { name: 'Argon2id', timeCost: 3, memoryCostKiB: 65536, parallelism: 1 },
    salt: salt.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }), 'utf8');
}

function writeAtomic(filePath, contents) {
  const resolved = path.resolve(filePath);
  const tempPath = `${resolved}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  try {
    fs.writeFileSync(tempPath, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tempPath, resolved);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    throw error;
  }
  return resolved;
}

async function saveEncryptedTrace(filePath, snapshot, histories, options = {}) {
  const payload = buildTracePayload(snapshot, histories, options);
  const encrypted = await encryptTrace(payload, options.passphrase);
  return writeAtomic(filePath, encrypted);
}

function savePortableTrace(filePath, snapshot, histories, options = {}) {
  const redaction = options.redaction === 'none' ? 'none' : (options.redaction || 'strict');
  const payload = buildTracePayload(snapshot, histories, { redaction });
  const encoded = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  if (encoded.length > MAX_TRACE_BYTES) throw new Error('Trace is too large to export safely.');
  return writeAtomic(filePath, encoded);
}

module.exports = {
  MAX_TRACE_BYTES,
  TRACE_FORMAT,
  TRACE_VERSION,
  buildTracePayload,
  encryptTrace,
  redactProcess,
  saveEncryptedTrace,
  savePortableTrace,
  writeAtomic,
};
