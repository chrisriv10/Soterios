'use strict';

/**
 * Polls outbound network connections and alerts when a remote IP matches
 * the BlocklistService. Debounces repeats; supports ignore + kill hooks.
 */
class NetworkAlertMonitor {
  /**
   * @param {object} options
   * @param {import('./NetworkMonitor')} options.networkMonitor
   * @param {import('./BlocklistService').BlocklistService} options.blocklistService
   * @param {import('./ProcessInspector')} [options.processInspector]
   * @param {import('../core/database')} [options.db]
   * @param {(title: string, body: string, level?: string) => void} [options.notify]
   * @param {number} [options.pollMs]
   * @param {number} [options.cooldownMs]
   */
  constructor(options = {}) {
    this.networkMonitor = options.networkMonitor;
    this.blocklistService = options.blocklistService;
    this.processInspector = options.processInspector || null;
    this.db = options.db || null;
    this.notify = options.notify || (() => {});
    this.pollMs = options.pollMs || 15_000;
    this.cooldownMs = options.cooldownMs || 5 * 60_000;
    this._timer = null;
    this._running = false;
    this._lastAlerted = new Map();
    this._ignored = new Set();
    this._lastHits = [];
  }

  getStatus() {
    return {
      running: this._running,
      ignored: this._ignored.size,
      recentHits: this._lastHits.slice(0, 20)
    };
  }

  start() {
    if (this._running) return this.getStatus();
    this._running = true;
    this._timer = setInterval(() => {
      this.poll().catch(() => {});
    }, this.pollMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
    this.poll().catch(() => {});
    return this.getStatus();
  }

  stop() {
    this._running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    return this.getStatus();
  }

  ignore(key) {
    if (key) this._ignored.add(String(key));
    return { success: true };
  }

  async kill(pid) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 0) return { success: false, error: 'Invalid PID' };
    if (!this.processInspector || typeof this.processInspector.killProcess !== 'function') {
      return { success: false, error: 'Process kill is unavailable.' };
    }
    return this.processInspector.killProcess(n);
  }

  _key(conn) {
    return `${conn.OwningProcess || 0}|${conn.RemoteAddress || ''}|${conn.RemotePort || ''}`;
  }

  async poll() {
    if (!this.networkMonitor || !this.blocklistService) return [];
    let connections = [];
    try {
      connections = await this.networkMonitor.getConnections();
    } catch (_) {
      return [];
    }
    const hits = [];
    const now = Date.now();
    for (const conn of connections) {
      const remote = conn && conn.RemoteAddress;
      if (!remote || remote === '0.0.0.0' || remote === '::' || remote === '127.0.0.1' || remote === '::1') {
        continue;
      }
      if (!this.blocklistService.isListed(remote)) continue;
      const key = this._key(conn);
      if (this._ignored.has(key) || this._ignored.has(String(remote))) continue;
      const last = this._lastAlerted.get(key) || 0;
      if (now - last < this.cooldownMs) continue;
      this._lastAlerted.set(key, now);
      const hit = {
        key,
        pid: conn.OwningProcess || null,
        remoteAddress: remote,
        remotePort: conn.RemotePort || null,
        state: conn.State || null,
        at: new Date().toISOString()
      };
      hits.push(hit);
      const msg = `Suspicious connection to ${remote}` +
        (hit.remotePort ? `:${hit.remotePort}` : '') +
        (hit.pid ? ` (PID ${hit.pid})` : '');
      if (this.db) this.db.addAlert('danger', msg);
      this.notify(
        'Suspicious network connection',
        `${msg}. Open Network Monitor to kill the process or ignore this alert.`,
        'danger'
      );
    }
    if (hits.length) {
      this._lastHits = [...hits, ...this._lastHits].slice(0, 50);
    }
    return hits;
  }
}

module.exports = NetworkAlertMonitor;
