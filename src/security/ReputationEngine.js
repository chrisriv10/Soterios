const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const VALID_VERDICTS = new Set(['safe', 'malicious']);

class ReputationEngine {
  constructor(db) {
    this.db = db;
  }

  static normalizeHash(hash) {
    if (typeof hash !== 'string') return null;
    const normalized = hash.trim().toLowerCase();
    return SHA256_PATTERN.test(normalized) ? normalized : null;
  }

  async checkHash(hash) {
    const normalized = ReputationEngine.normalizeHash(hash);
    if (!normalized) return null;
    return this.db.getReputationHash(normalized);
  }

  async addHash(hash, verdict, note = null, source = 'user') {
    const normalized = ReputationEngine.normalizeHash(hash);
    if (!normalized) {
      return { success: false, error: 'Invalid SHA-256 hash.' };
    }
    if (!VALID_VERDICTS.has(verdict)) {
      return { success: false, error: 'Verdict must be safe or malicious.' };
    }
    this.db.upsertReputationHash({
      hash: normalized,
      verdict,
      source: typeof source === 'string' && source ? source : 'user',
      note: typeof note === 'string' ? note : null
    });
    return { success: true, hash: normalized, verdict };
  }

  async removeHash(hash) {
    const normalized = ReputationEngine.normalizeHash(hash);
    if (!normalized) {
      return { success: false, error: 'Invalid SHA-256 hash.' };
    }
    const removed = this.db.deleteReputationHash(normalized);
    return removed ? { success: true } : { success: false, error: 'Hash not found.' };
  }

  async listHashes(limit = 500) {
    return this.db.listReputationHashes(limit);
  }
}

module.exports = ReputationEngine;
