const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const VALID_VERDICTS = new Set(['safe', 'malicious']);

/**
 * Local reputation store for file hashes.
 *
 * Stores safe/malicious verdicts in the database for fast lookup
 * without relying on external APIs.
 */
class ReputationEngine {
  /**
   * @param {object} db - DatabaseService with reputation helpers.
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Normalize a SHA-256 hash string.
   * @param {string} hash
   * @returns {string|null}
   */
  static normalizeHash(hash) {
    if (typeof hash !== 'string') return null;
    const normalized = hash.trim().toLowerCase();
    return SHA256_PATTERN.test(normalized) ? normalized : null;
  }

  /**
   * Look up a hash verdict from the local store.
   * @param {string} hash
   * @returns {Promise<Object|null>}
   */
  async checkHash(hash) {
    const normalized = ReputationEngine.normalizeHash(hash);
    if (!normalized) return null;
    return this.db.getReputationHash(normalized);
  }

  /**
   * Add or update a hash verdict in the local store.
   * @param {string} hash
   * @param {'safe'|'malicious'} verdict
   * @param {string} [note]
   * @param {string} [source]
   * @returns {Promise<{success:boolean, hash?:string, verdict?:string, error?:string}>}
   */
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

  /**
   * Remove a hash verdict from the local store.
   * @param {string} hash
   * @returns {Promise<{success:boolean, error?:string}>}
   */
  async removeHash(hash) {
    const normalized = ReputationEngine.normalizeHash(hash);
    if (!normalized) {
      return { success: false, error: 'Invalid SHA-256 hash.' };
    }
    const removed = this.db.deleteReputationHash(normalized);
    return removed ? { success: true } : { success: false, error: 'Hash not found.' };
  }

  /**
   * List stored hash verdicts.
   * @param {number} [limit]
   * @returns {Promise<Array>}
   */
  async listHashes(limit = 500) {
    return this.db.listReputationHashes(limit);
  }
}

module.exports = ReputationEngine;
