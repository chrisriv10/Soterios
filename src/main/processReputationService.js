'use strict';

const { hashFileStreaming } = require('../security/hashUtils');

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 15_000;
const API_KEY_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;

class ProcessReputationService {
  constructor(options = {}) {
    this.db = options.db;
    this.processService = options.processService;
    this.safeStorage = options.safeStorage;
    this.fetch = options.fetch || global.fetch;
    this.lastRequestAt = 0;
  }

  _privacyMode() { return !!this.db?.getSetting('feature.privacyMode', false); }
  _enabled() { return !!this.db?.getSetting('process.reputationEnabled', false); }

  status() {
    return {
      enabled: this._enabled(),
      privacyMode: this._privacyMode(),
      keyConfigured: !!this.db?.getSetting('process.reputationApiKeyEncrypted', ''),
      provider: 'VirusTotal v3 hash lookup',
      sends: ['SHA-256'],
      uploadsFiles: false,
      automatic: false,
    };
  }

  configure(apiKey, consent) {
    if (consent !== true) throw new Error('Explicit reputation lookup consent is required.');
    if (typeof apiKey !== 'string' || !API_KEY_PATTERN.test(apiKey.trim())) throw new Error('Invalid VirusTotal API key.');
    if (!this.safeStorage?.isEncryptionAvailable?.()) throw new Error('Windows secure storage is unavailable.');
    const encrypted = this.safeStorage.encryptString(apiKey.trim()).toString('base64');
    this.db.setSetting('process.reputationApiKeyEncrypted', encrypted);
    this.db.setSetting('process.reputationEnabled', true);
    return this.status();
  }

  clear() {
    this.db.setSetting('process.reputationApiKeyEncrypted', '');
    this.db.setSetting('process.reputationEnabled', false);
    return this.status();
  }

  _getKey() {
    const encoded = this.db?.getSetting('process.reputationApiKeyEncrypted', '');
    if (!encoded || !this.safeStorage?.isEncryptionAvailable?.()) return null;
    try { return this.safeStorage.decryptString(Buffer.from(encoded, 'base64')); } catch (_) { return null; }
  }

  _cached(hash) {
    const row = this.db?.getProcessReputationCache?.(hash);
    if (!row) return null;
    const checkedAt = Date.parse(row.last_checked);
    if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > CACHE_TTL_MS) return null;
    return this._normalizeCounts(row, 'VirusTotal cache', row.last_checked);
  }

  _normalizeCounts(counts, source, checkedAt = new Date().toISOString()) {
    const malicious = Number(counts?.malicious) || 0;
    const suspicious = Number(counts?.suspicious) || 0;
    const undetected = Number(counts?.undetected) || 0;
    return {
      source,
      checkedAt,
      malicious,
      suspicious,
      undetected,
      verdict: malicious >= 3 || suspicious >= 5 ? 'malicious' : 'unknown',
    };
  }

  async check(processKey) {
    if (this._privacyMode()) throw new Error('Online reputation is disabled while Privacy Mode is on.');
    if (!this._enabled()) return { success: false, requiresConsent: true, ...this.status() };
    const apiKey = this._getKey();
    if (!apiKey) return { success: false, requiresApiKey: true, ...this.status() };
    const proc = await this.processService.getProcessByKey(processKey);
    if (!proc) throw new Error('Process not found or its PID has been reused.');
    if (!proc.path) throw new Error('Executable path is unavailable.');
    const hash = proc.hash || await hashFileStreaming(proc.path);
    if (!hash) throw new Error('Unable to calculate the executable SHA-256 hash.');
    proc.hash = hash;
    this.processService.rememberHash(proc.path, hash);
    const cached = this._cached(hash);
    if (cached) {
      this.processService.applyReputation(processKey, cached);
      return { success: true, cached: true, reputation: cached };
    }
    const sinceLast = Date.now() - this.lastRequestAt;
    if (sinceLast < MIN_REQUEST_INTERVAL_MS) {
      throw new Error(`Please wait ${Math.ceil((MIN_REQUEST_INTERVAL_MS - sinceLast) / 1000)} seconds before another lookup.`);
    }
    this.lastRequestAt = Date.now();
    const response = await this.fetch(`https://www.virustotal.com/api/v3/files/${encodeURIComponent(hash)}`, {
      method: 'GET',
      headers: { 'x-apikey': apiKey, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      const unknown = this._normalizeCounts({}, 'VirusTotal', new Date().toISOString());
      this.db?.setProcessReputationCache?.(hash, unknown);
      this.processService.applyReputation(processKey, unknown);
      return { success: true, cached: false, reputation: unknown };
    }
    if (!response.ok) throw new Error(`VirusTotal lookup failed (${response.status}).`);
    const body = await response.json();
    const counts = body?.data?.attributes?.last_analysis_stats || {};
    const reputation = this._normalizeCounts(counts, 'VirusTotal', new Date().toISOString());
    this.db?.setProcessReputationCache?.(hash, reputation);
    this.processService.applyReputation(processKey, reputation);
    return { success: true, cached: false, reputation };
  }
}

module.exports = {
  API_KEY_PATTERN,
  CACHE_TTL_MS,
  MIN_REQUEST_INTERVAL_MS,
  ProcessReputationService,
};
