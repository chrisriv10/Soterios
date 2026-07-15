const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseService {
  constructor(dbPath) {
    // Ensure the directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    this.db.pragma('journal_mode = WAL'); // Better performance

    // Scan History Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        scan_type TEXT,
        files_scanned INTEGER,
        threats_found INTEGER,
        duration_ms INTEGER
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scan_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        scan_type TEXT,
        status TEXT,
        target_paths TEXT,
        files_scanned INTEGER,
        threats_found INTEGER,
        duration_ms INTEGER,
        json_path TEXT,
        html_path TEXT,
        details TEXT
      )
    `);

    // Quarantine Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_path TEXT,
        quarantine_path TEXT,
        hash TEXT,
        engine TEXT,
        threat_name TEXT,
        date_quarantined DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT,
        status TEXT DEFAULT 'quarantined'
      )
    `);

    // Migration: add quarantine_path column if it doesn't exist (for existing databases)
    const quarantineColumns = this.db.prepare("PRAGMA table_info(quarantine)").all();
    const hasQuarantinePath = quarantineColumns.some((col) => col.name === 'quarantine_path');
    if (!hasQuarantinePath) {
      this.db.exec('ALTER TABLE quarantine ADD COLUMN quarantine_path TEXT');
    }

    // Alerts Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        severity TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_read INTEGER DEFAULT 0
      )
    `);

    // Settings Table (Key-Value)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ignored_warnings (
        id TEXT PRIMARY KEY,
        title TEXT,
        detail TEXT,
        ignored_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Reputation Cache (VirusTotal)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reputation_cache (
        hash TEXT PRIMARY KEY,
        malicious INTEGER,
        suspicious INTEGER,
        undetected INTEGER,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Network Blocklist Cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS network_blocklist_cache (
        source TEXT PRIMARY KEY,
        raw_data TEXT,
        fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Network Geo Cache
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS network_geo_cache (
        ip TEXT PRIMARY KEY,
        raw_data TEXT,
        fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reputation_hashes (
        hash TEXT PRIMARY KEY,
        verdict TEXT NOT NULL CHECK(verdict IN ('safe', 'malicious')),
        source TEXT,
        note TEXT,
        added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Network bandwidth history (Issue #35)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS network_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at TEXT NOT NULL,
        iface TEXT NOT NULL,
        rx_sec REAL,
        tx_sec REAL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_network_stats_recorded_at
      ON network_stats(recorded_at)
    `);
  }

  // --- Scan History API ---
  logScan(scanType, filesScanned, threatsFound, durationMs) {
    const stmt = this.db.prepare('INSERT INTO scan_history (scan_type, files_scanned, threats_found, duration_ms) VALUES (?, ?, ?, ?)');
    return stmt.run(scanType, filesScanned, threatsFound, durationMs);
  }

  getScanHistory(limit = 10) {
    return this.db.prepare('SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?').all(limit);
  }

  addScanReport(report) {
    const stmt = this.db.prepare(`
      INSERT INTO scan_reports (
        scan_type, status, target_paths, files_scanned, threats_found,
        duration_ms, json_path, html_path, details
      ) VALUES (
        @scanType, @status, @targetPaths, @filesScanned, @threatsFound,
        @durationMs, @jsonPath, @htmlPath, @details
      )
    `);
    return stmt.run({
      scanType: report.scanType,
      status: report.status,
      targetPaths: JSON.stringify(report.targetPaths || []),
      filesScanned: report.filesScanned || 0,
      threatsFound: report.threatsFound || 0,
      durationMs: report.durationMs || 0,
      jsonPath: report.jsonPath || null,
      htmlPath: report.htmlPath || null,
      details: JSON.stringify(report.details || {})
    });
  }

  getScanReports(limit = 25) {
    return this.db.prepare('SELECT * FROM scan_reports ORDER BY timestamp DESC LIMIT ?').all(limit).map((row) => ({
      ...row,
      target_paths: JSON.parse(row.target_paths || '[]'),
      details: JSON.parse(row.details || '{}')
    }));
  }

  getLatestScanReport() {
    const row = this.db.prepare('SELECT * FROM scan_reports ORDER BY timestamp DESC LIMIT 1').get();
    if (!row) return null;
    return {
      ...row,
      target_paths: JSON.parse(row.target_paths || '[]'),
      details: JSON.parse(row.details || '{}')
    };
  }

  getScanReport(id) {
    const row = this.db.prepare('SELECT * FROM scan_reports WHERE id = ?').get(id);
    if (!row) return null;
    let target_paths = [];
    let details = {};
    try {
      target_paths = JSON.parse(row.target_paths || '[]');
    } catch (_) {
      target_paths = [];
    }
    try {
      details = JSON.parse(row.details || '{}');
    } catch (_) {
      details = {};
    }
    return {
      ...row,
      target_paths,
      details
    };
  }

  deleteScanReport(id) {
    const row = this.db.prepare('SELECT * FROM scan_reports WHERE id = ?').get(id);
    if (!row) return null;
    this.db.prepare('DELETE FROM scan_reports WHERE id = ?').run(id);
    return row;
  }

  // --- Quarantine API ---
  addQuarantineRecord(record) {
    const stmt = this.db.prepare(`
      INSERT INTO quarantine (original_path, quarantine_path, hash, engine, threat_name, reason) 
      VALUES (@originalPath, @quarantinePath, @hash, @engine, @threatName, @reason)
    `);
    return stmt.run(record);
  }

  getQuarantineList() {
    return this.db.prepare("SELECT * FROM quarantine WHERE status = 'quarantined' ORDER BY date_quarantined DESC").all();
  }

  updateQuarantineStatus(id, status) {
    const stmt = this.db.prepare('UPDATE quarantine SET status = ? WHERE id = ?');
    return stmt.run(status, id);
  }

  // --- Alerts API ---
  addAlert(severity, message) {
    const stmt = this.db.prepare('INSERT INTO alerts (severity, message) VALUES (?, ?)');
    return stmt.run(severity, message);
  }

  getUnreadAlerts() {
    return this.db.prepare('SELECT * FROM alerts WHERE is_read = 0 ORDER BY timestamp DESC').all();
  }

  markAlertRead(id) {
    const stmt = this.db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?');
    return stmt.run(id);
  }

  ignoreWarning(warning) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO ignored_warnings (id, title, detail) VALUES (@id, @title, @detail)');
    return stmt.run(warning);
  }

  unignoreWarning(id) {
    return this.db.prepare('DELETE FROM ignored_warnings WHERE id = ?').run(id);
  }

  getIgnoredWarnings() {
    return this.db.prepare('SELECT * FROM ignored_warnings ORDER BY ignored_at DESC').all();
  }

  isWarningIgnored(id) {
    return !!this.db.prepare('SELECT id FROM ignored_warnings WHERE id = ?').get(id);
  }

  // --- Settings API ---
  getSetting(key, defaultValue = null) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key);
    return row ? JSON.parse(row.value) : defaultValue;
  }

  setSetting(key, value) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    return stmt.run(key, JSON.stringify(value));
  }

  // --- Network Blocklist Cache API ---
  getBlocklistCache(source) {
    return this.db.prepare('SELECT * FROM network_blocklist_cache WHERE source = ?').get(source) || null;
  }

  setBlocklistCache(source, rawData) {
    const stmt = this.db.prepare(`
      INSERT INTO network_blocklist_cache (source, raw_data, fetched_at)
      VALUES (@source, @rawData, CURRENT_TIMESTAMP)
      ON CONFLICT(source) DO UPDATE SET
        raw_data = excluded.raw_data,
        fetched_at = CURRENT_TIMESTAMP
    `);
    return stmt.run({ source, rawData });
  }

  // --- Network Geo Cache API ---
  getGeoCache(ip) {
    return this.db.prepare('SELECT * FROM network_geo_cache WHERE ip = ?').get(ip) || null;
  }

  setGeoCache(ip, rawData) {
    const stmt = this.db.prepare(`
      INSERT INTO network_geo_cache (ip, raw_data, fetched_at)
      VALUES (@ip, @rawData, CURRENT_TIMESTAMP)
      ON CONFLICT(ip) DO UPDATE SET
        raw_data = excluded.raw_data,
        fetched_at = CURRENT_TIMESTAMP
    `);
    return stmt.run({ ip, rawData });
  }

  getReputationHash(hash) {
    const row = this.db.prepare(`
      SELECT hash, verdict, source, note, added_at
      FROM reputation_hashes
      WHERE hash = ?
    `).get(hash);
    if (!row) return null;
    return {
      verdict: row.verdict,
      source: row.source,
      note: row.note,
      addedAt: row.added_at
    };
  }

  upsertReputationHash(record) {
    const stmt = this.db.prepare(`
      INSERT INTO reputation_hashes (hash, verdict, source, note, added_at)
      VALUES (@hash, @verdict, @source, @note, CURRENT_TIMESTAMP)
      ON CONFLICT(hash) DO UPDATE SET
        verdict = excluded.verdict,
        source = excluded.source,
        note = excluded.note,
        added_at = CURRENT_TIMESTAMP
    `);
    return stmt.run(record);
  }

  deleteReputationHash(hash) {
    const result = this.db.prepare('DELETE FROM reputation_hashes WHERE hash = ?').run(hash);
    return result.changes > 0;
  }

  listReputationHashes(limit = 500) {
    return this.db.prepare(`
      SELECT hash, verdict, source, note, added_at
      FROM reputation_hashes
      ORDER BY added_at DESC
      LIMIT ?
    `).all(limit);
  }

  // --- Network stats history ---
  addNetworkStatsSample(iface, rxSec, txSec, recordedAt = new Date().toISOString()) {
    return this.db.prepare(`
      INSERT INTO network_stats (recorded_at, iface, rx_sec, tx_sec)
      VALUES (?, ?, ?, ?)
    `).run(recordedAt, iface, rxSec, txSec);
  }

  getNetworkStatsHistory(hours = 24, iface = null) {
    const since = new Date(Date.now() - Number(hours) * 3600 * 1000).toISOString();
    if (iface) {
      return this.db.prepare(`
        SELECT recorded_at, iface, rx_sec, tx_sec
        FROM network_stats
        WHERE recorded_at >= ? AND iface = ?
        ORDER BY recorded_at ASC
      `).all(since, iface);
    }
    return this.db.prepare(`
      SELECT recorded_at, iface, rx_sec, tx_sec
      FROM network_stats
      WHERE recorded_at >= ?
      ORDER BY recorded_at ASC
    `).all(since);
  }

  pruneNetworkStats(retentionDays = 7) {
    const cutoff = new Date(Date.now() - Number(retentionDays) * 86400 * 1000).toISOString();
    return this.db.prepare('DELETE FROM network_stats WHERE recorded_at < ?').run(cutoff);
  }
}

module.exports = DatabaseService;
