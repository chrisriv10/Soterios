const crypto = require('crypto');
const os = require('os');

const PROTOCOL_VERSION = 2;
const MAX_FRAME_BYTES = 64 * 1024;
const ALLOWED_TYPES = new Set(['HELLO', 'PING', 'GET_THEME', 'REPORT_FINDING', 'OPEN_APP']);
const CATEGORIES = new Set(['credential_breach', 'credential_reuse', 'phishing', 'malware', 'site_advisory']);
const SEVERITIES = new Set(['info', 'warning', 'danger']);

function getPipeName(environment = process.env, username = os.userInfo().username) {
  const identity = `${String(username).toLowerCase()}\0${String(environment.LOCALAPPDATA || environment.USERPROFILE || '').toLowerCase()}`;
  const suffix = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20);
  return `\\\\.\\pipe\\soterios-browser-v2-${suffix}`;
}

function byteLength(value) {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch (_) { return Infinity; }
}

function isDomain(value) {
  return typeof value === 'string' && value.length <= 253 && (value === '' || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value));
}

function normalizeEnvelope(value) {
  if (!value || typeof value !== 'object' || byteLength(value) > MAX_FRAME_BYTES) return { ok: false, error: 'INVALID_MESSAGE' };
  if (value.protocol === PROTOCOL_VERSION && typeof value.requestId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value.requestId) && ALLOWED_TYPES.has(value.type)) {
    const envelope = { protocol: PROTOCOL_VERSION, requestId: value.requestId, type: value.type, payload: value.payload && typeof value.payload === 'object' ? value.payload : {} };
    if (envelope.type === 'REPORT_FINDING') {
      const payload = envelope.payload;
      if (!CATEGORIES.has(payload.category) || !SEVERITIES.has(payload.severity) || !isDomain(payload.domain)) return { ok: false, error: 'INVALID_FINDING' };
      if (payload.prevalenceCount !== undefined && (!Number.isSafeInteger(payload.prevalenceCount) || payload.prevalenceCount < 1 || payload.prevalenceCount > 1_000_000_000)) return { ok: false, error: 'INVALID_FINDING' };
      envelope.payload = { category: payload.category, severity: payload.severity, domain: payload.domain, ...(payload.prevalenceCount ? { prevalenceCount: payload.prevalenceCount } : {}) };
    }
    return { ok: true, envelope };
  }
  // One-release compatibility bridge. Plaintext password fields are never accepted.
  if (value.password !== undefined) return { ok: false, error: 'PLAINTEXT_CREDENTIAL_REJECTED' };
  if (value.type === 'CREDENTIAL_LEAK' && isDomain(value.domain)) {
    return { ok: true, legacy: true, envelope: { protocol: 2, requestId: `legacy_${crypto.randomUUID().replace(/-/g, '')}`, type: 'REPORT_FINDING', payload: { category: 'credential_breach', severity: 'danger', domain: value.domain || '', ...(Number.isSafeInteger(value.count) && value.count > 0 ? { prevalenceCount: Math.min(value.count, 1_000_000_000) } : {}) } } };
  }
  if (value.type === 'THREAT_DETECTED' && isDomain(value.domain)) {
    const category = String(value.threatType || '').toLowerCase().includes('malware') ? 'malware' : 'phishing';
    return { ok: true, legacy: true, envelope: { protocol: 2, requestId: `legacy_${crypto.randomUUID().replace(/-/g, '')}`, type: 'REPORT_FINDING', payload: { category, severity: 'danger', domain: value.domain || '' } } };
  }
  return { ok: false, error: 'INVALID_MESSAGE' };
}

function encodeFrame(value) {
  const json = Buffer.from(JSON.stringify(value), 'utf8');
  if (json.length > MAX_FRAME_BYTES) throw new Error('Frame exceeds the 64 KiB limit');
  const frame = Buffer.allocUnsafe(json.length + 4);
  frame.writeUInt32LE(json.length, 0); json.copy(frame, 4); return frame;
}

function createFrameDecoder(onMessage, onError) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length < 2 || length > MAX_FRAME_BYTES) { buffer = Buffer.alloc(0); onError(new Error('Invalid frame length')); return; }
      if (buffer.length < length + 4) return;
      const body = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
      try { onMessage(JSON.parse(body.toString('utf8'))); } catch (error) { onError(error); }
    }
  };
}

module.exports = { PROTOCOL_VERSION, MAX_FRAME_BYTES, ALLOWED_TYPES, CATEGORIES, SEVERITIES, getPipeName, normalizeEnvelope, encodeFrame, createFrameDecoder };
