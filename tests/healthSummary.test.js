'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getTrayHealthSummary } = require('../src/main/healthSummary');

/**
 * Fake in-memory database used for getTrayHealthSummary tests.
 */
class FakeDatabase {
  /**
   * Creates a FakeDatabase instance.
   */
  constructor() {
    this.data = {};
  }

  /**
   * Returns the latest scan report, if any.
   *
   * @returns {Object|null} Latest scan report.
   */
  getLatestScanReport() {
    return this.data.latestScanReport || null;
  }

  /**
   * Reads a setting with an optional default.
   *
   * @param {string} key - Setting key.
   * @param {*} [defaultValue] - Default value when key is missing.
   * @returns {*} Setting value or default.
   */
  getSetting(key, defaultValue) {
    return this.data.settings?.[key] ?? defaultValue;
  }

  /**
   * Stores the latest scan report.
   *
   * @param {Object} report - Scan report object.
   */
  setLatestScanReport(report) {
    this.data.latestScanReport = report;
  }

  /**
   * Stores a setting value.
   *
   * @param {string} key - Setting key.
   * @param {*} value - Setting value.
   */
  setSetting(key, value) {
    if (!this.data.settings) this.data.settings = {};
    this.data.settings[key] = value;
  }

  /**
   * Returns network history entries.
   *
   * @param {number} _minutes - Ignored in fake.
   * @returns {Array<Object>} Network history entries.
   */
  getNetworkHistory(minutes) {
    return this.data.networkHistory || [];
  }

  /**
   * Stores network history entries.
   *
   * @param {Array<Object>} history - Network history entries.
   */
  setNetworkHistory(history) {
    this.data.networkHistory = history;
  }
}

/**
 * Fake tool registry used for getTrayHealthSummary tests.
 */
class FakeToolRegistry {
  /**
   * Creates a FakeToolRegistry instance.
   *
   * @param {*} result - Result to return from every run() call.
   */
  constructor(result) {
    this.result = result;
  }

  /**
   * Returns the preset result for any tool invocation.
   *
   * @param {string} _tool - Tool name (unused).
   * @param {Object} _params - Tool parameters (unused).
   * @param {Object} _context - Execution context (unused).
   * @returns {Promise<*>} Preset result.
   */
  async run(tool, params, context) {
    return this.result;
  }
}

describe('getTrayHealthSummary', () => {
  let db, toolRegistry;

  beforeEach(() => {
    db = new FakeDatabase();
    toolRegistry = new FakeToolRegistry({
      ok: true,
      data: {
        score: 85,
        breakdown: {
          disk: { reason: 'Good disk health' }
        }
      }
    });
  });

  describe('Basic functionality', () => {
    it('should return health summary with score', async () => {
      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.score, 85);
      assert.strictEqual(summary.detail, 'Good disk health');
    });

    it('should handle tool registry error', async () => {
      toolRegistry.result = {
        ok: false,
        error: 'Tool failed'
      };

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.score, null);
      assert.strictEqual(summary.detail, 'Tool failed');
    });

    it('should handle missing tool result', async () => {
      toolRegistry.result = {
        ok: true,
        data: {}
      };

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.score, undefined);
      assert.strictEqual(summary.detail, 'Protection and resource summary ready.');
    });
  });

  describe('Last scan info', () => {
    it('should include last scan info when available', async () => {
      db.setLatestScanReport({
        timestamp: '2026-07-30T12:00:00Z',
        files_scanned: 1000,
        threats_found: 0
      });

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.lastScan.timestamp, '2026-07-30T12:00:00Z');
      assert.strictEqual(summary.lastScan.filesScanned, 1000);
      assert.strictEqual(summary.lastScan.threatsFound, 0);
    });

    it('should handle missing last scan report', async () => {
      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.lastScan, null);
    });
  });

  describe('Password score', () => {
    it('should handle password score setting', async () => {
      db.setSetting('feature.lastPasswordScore', '80');
      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.score, 85);
    });

    it('should handle null password score', async () => {
      db.setSetting('feature.lastPasswordScore', null);
      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.score, 85);
    });

    it('should handle missing password score setting', async () => {
      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.score, 85);
    });
  });

  describe('RTP status', () => {
    it('should show RTP as disabled when setting is false', async () => {
      db.setSetting('feature.realtimeProtection', false);

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.rtp.enabled, false);
    });

    it('should show RTP as enabled when setting is true', async () => {
      db.setSetting('feature.realtimeProtection', true);

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.rtp.enabled, true);
    });

    it('should handle missing RTP setting', async () => {
      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.rtp.enabled, false);
    });
  });

  describe('Network history', () => {
    it('should include network stats when history is available', async () => {
      const history = [
        { rx_bytes: 1024, tx_bytes: 2048 },
        { rx_bytes: 2048, tx_bytes: 4096 }
      ];
      db.setNetworkHistory(history);

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.network.rxKBs, 2);
      assert.strictEqual(summary.network.txKBs, 4);
      assert.strictEqual(summary.network.history.length, 2);
    });

    it('should handle empty network history', async () => {
      db.setNetworkHistory([]);

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.network.rxKBs, 0);
      assert.strictEqual(summary.network.txKBs, 0);
      assert.strictEqual(summary.network.history.length, 0);
    });

    it('should handle missing network history method', async () => {
      delete db.getNetworkHistory;

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.network.rxKBs, 0);
      assert.strictEqual(summary.network.txKBs, 0);
      assert.strictEqual(summary.network.history.length, 0);
    });

    it('should limit sparkline to last 60 samples', async () => {
      const history = Array.from({ length: 100 }, (_, i) => ({
        rx_bytes: i * 1024,
        tx_bytes: i * 2048
      }));
      db.setNetworkHistory(history);

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.network.rx.length, 60);
      assert.strictEqual(summary.network.tx.length, 60);
      assert.strictEqual(summary.network.history.length, 60);
    });

    it('should handle network history errors gracefully', async () => {
      db.getNetworkHistory = () => {
        throw new Error('Database error');
      };

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.network.rxKBs, 0);
      assert.strictEqual(summary.network.txKBs, 0);
    });
  });

  describe('Integration scenarios', () => {
    it('should provide complete summary with all data', async () => {
      db.setLatestScanReport({
        timestamp: '2026-07-30T12:00:00Z',
        files_scanned: 5000,
        threats_found: 2
      });
      db.setSetting('feature.realtimeProtection', true);
      db.setSetting('feature.lastPasswordScore', '75');

      const history = [
        { rx_bytes: 1024000, tx_bytes: 2048000 },
        { rx_bytes: 2048000, tx_bytes: 4096000 }
      ];
      db.setNetworkHistory(history);

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.score, 85);
      assert.strictEqual(summary.rtp.enabled, true);
      assert.strictEqual(summary.lastScan.filesScanned, 5000);
      assert.strictEqual(summary.lastScan.threatsFound, 2);
      assert.strictEqual(summary.network.rxKBs, 2000);
      assert.strictEqual(summary.network.txKBs, 4000);
    });

    it('should handle all errors gracefully and return partial data', async () => {
      toolRegistry.result = { ok: false, error: 'Tool error' };
      db.setSetting('feature.realtimeProtection', true);

      const summary = await getTrayHealthSummary(db, toolRegistry);
      assert.strictEqual(summary.score, null);
      assert.strictEqual(summary.detail, 'Tool error');
      // When tool fails, it returns early without RTP/firewall/network data
      assert.strictEqual(summary.rtp, undefined);
    });
  });
});
