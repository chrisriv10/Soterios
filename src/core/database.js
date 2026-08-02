const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * Local SQLite persistence for Soterios.
 *
 * Owns scan history, quarantine records, settings, alerts, audit log,
 * network stats, maintenance runs, user blocklists, and the incremental
 * scan cache.
 */
class DatabaseService {
  /**
   * @param {string} dbPath - Absolute path to the SQLite database file.
   */
  constructor(dbPath) {
    // Ensure the directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.init();
  }

  /**
   * Create tables and apply schema migrations.
   */
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS maintenance_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        ok_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        dry_run INTEGER DEFAULT 0,
        results_json TEXT
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

    // User blocklist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_blocklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        reason TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_blocklist_ip ON user_blocklist(ip)
    `);

    // User domain blocklist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_domain_blocklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL UNIQUE,
        reason TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Audit log
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        action TEXT NOT NULL,
        detail TEXT,
        result TEXT,
        user_initiated INTEGER DEFAULT 0
      )
    `);

    // Scanned files cache for incremental scans
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scanned_files (
        path TEXT PRIMARY KEY,
        last_scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        size INTEGER,
        modified_at TEXT
      )
    `);
  }

  // --- Scan History API ---

  /**
   * Record a scan execution summary.
   * @param {string} scanType - One of 'quick', 'full', 'custom', 'folderwatch'.
   * @param {number} filesScanned - Total files examined.
   * @param {number} threatsFound - Threats detected.
   * @param {number} durationMs - Wall-clock duration in milliseconds.
   * @returns {Database.RunResult} Insert result.
   */
  logScan(scanType, filesScanned, threatsFound, durationMs) {
    const stmt = this.db.prepare('INSERT INTO scan_history (scan_type, files_scanned, threats_found, duration_ms) VALUES (?, ?, ?, ?)');
    return stmt.run(scanType, filesScanned, threatsFound, durationMs);
  }

  /**
   * Retrieve recent scan history entries.
   * @param {number} [limit=10] - Maximum rows to return.
   * @returns {Array<Object>} Scan history rows.
   */
  getScanHistory(limit = 10) {
    return this.db.prepare('SELECT * FROM scan_history ORDER BY timestamp DESC LIMIT ?').all(limit);
  }

  /**
   * Persist a full scan report (JSON + HTML).
   * @param {Object} report - Scan report payload.
   * @param {string} report.scanType - Scan type identifier.
   * @param {string} report.status - Final scan status.
   * @param {string[]} report.targetPaths - Paths that were scanned.
   * @param {number} report.filesScanned - Files examined.
   * @param {number} report.threatsFound - Threats detected.
   * @param {number} report.durationMs - Duration in milliseconds.
   * @param {string} [report.jsonPath] - Optional JSON report path.
   * @param {string} [report.htmlPath] - Optional HTML report path.
   * @param {Object} [report.details] - Arbitrary report metadata.
   * @returns {Database.RunResult} Insert result.
   */
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

  /**
   * Retrieve recent scan reports.
   * @param {number} [limit=25] - Maximum rows to return.
   * @returns {Array<Object>} Scan report rows with parsed JSON fields.
   */
  getScanReports(limit = 25) {
    return this.db.prepare('SELECT * FROM scan_reports ORDER BY timestamp DESC LIMIT ?').all(limit).map((row) => ({
      ...row,
      target_paths: JSON.parse(row.target_paths || '[]'),
      details: JSON.parse(row.details || '{}')
    }));
  }

  /**
   * Get the most recent scan report.
   * @returns {Object|null} Latest scan report row with parsed JSON fields.
   */
  getLatestScanReport() {
    const row = this.db.prepare('SELECT * FROM scan_reports ORDER BY timestamp DESC LIMIT 1').get();
    if (!row) return null;
    return {
      ...row,
      target_paths: JSON.parse(row.target_paths || '[]'),
      details: JSON.parse(row.details || '{}')
    };
  }

  /**
   * Get a single scan report by id.
   * @param {number} id - Scan report primary key.
   * @returns {Object|null} Scan report row with parsed JSON fields.
   */
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

  /**
   * Delete a scan report and return the removed row.
   * @param {number} id - Scan report primary key.
   * @returns {Object|null} The deleted row, or null if not found.
   */
  deleteScanReport(id) {
    const row = this.db.prepare('SELECT * FROM scan_reports WHERE id = ?').get(id);
    if (!row) return null;
    this.db.prepare('DELETE FROM scan_reports WHERE id = ?').run(id);
    return row;
  }

  // --- Quarantine API ---

  /**
   * Insert a quarantine record.
   * @param {Object} record - Quarantine record fields.
   * @param {string} record.original_path - Original file path.
   * @param {string} record.quarantine_path - Encrypted quarantine file path.
   * @param {string} record.hash - File hash.
   * @param {string} record.engine - Detection engine name.
   * @param {string} record.threat_name - Threat identifier.
   * @param {string} [record.reason] - Optional reason string.
   * @returns {Database.RunResult} Insert result.
   */
  addQuarantineRecord(record) {
    const stmt = this.db.prepare(`
      INSERT INTO quarantine (original_path, quarantine_path, hash, engine, threat_name, reason) 
      VALUES (@originalPath, @quarantinePath, @hash, @engine, @threatName, @reason)
    `);
    return stmt.run(record);
  }

  /**
   * List active quarantine entries.
   * @returns {Array<Object>} Quarantine rows with status 'quarantined'.
   */
  getQuarantineList() {
    return this.db.prepare("SELECT * FROM quarantine WHERE status = 'quarantined' ORDER BY date_quarantined DESC").all();
  }

  /**
   * Update the status of a quarantine record.
   * @param {number} id - Quarantine row id.
   * @param {string} status - New status ('quarantined', 'restored', 'deleted').
   * @returns {Database.RunResult} Update result.
   */
  updateQuarantineStatus(id, status) {
    const stmt = this.db.prepare('UPDATE quarantine SET status = ? WHERE id = ?');
    return stmt.run(status, id);
  }

  // --- Alerts API ---

  /**
   * Create an alert entry.
   * @param {string} severity - Alert severity level.
   * @param {string} message - Alert message.
   * @returns {Database.RunResult} Insert result.
   */
  addAlert(severity, message) {
    const stmt = this.db.prepare('INSERT INTO alerts (severity, message) VALUES (?, ?)');
    return stmt.run(severity, message);
  }

  /**
   * Get unread alerts.
   * @returns {Array<Object>} Alert rows where is_read = 0.
   */
  getUnreadAlerts() {
    return this.db.prepare('SELECT * FROM alerts WHERE is_read = 0 ORDER BY timestamp DESC').all();
  }

  /**
   * Mark an alert as read.
   * @param {number} id - Alert primary key.
   * @returns {Database.RunResult} Update result.
   */
  markAlertRead(id) {
    const stmt = this.db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?');
    return stmt.run(id);
  }

  /**
   * Record a maintenance run.
   * @param {Object} options
   * @param {string} [options.startedAt] - ISO timestamp.
   * @param {Array} [options.results] - Script result objects.
   * @param {boolean} [options.dryRunCleanup] - Whether this was a dry run.
   * @returns {Database.RunResult} Insert result.
   */
  addMaintenanceRun({ startedAt, results, dryRunCleanup = false }) {
    const okCount = (results || []).filter((r) => r.ok).length;
    const stmt = this.db.prepare(`
      INSERT INTO maintenance_runs (started_at, ok_count, total_count, dry_run, results_json)
      VALUES (@startedAt, @okCount, @totalCount, @dryRun, @resultsJson)
    `);
    return stmt.run({
      startedAt: startedAt || new Date().toISOString(),
      okCount,
      totalCount: (results || []).length,
      dryRun: dryRunCleanup ? 1 : 0,
      resultsJson: JSON.stringify(results || [])
    });
  }

  /**
   * Get recent maintenance run history.
   * @param {number} [limit=25] - Maximum rows.
   * @returns {Array<Object>} Maintenance run rows with parsed results.
   */
  getMaintenanceHistory(limit = 25) {
    return this.db.prepare(`
      SELECT id, timestamp, started_at, ok_count, total_count, dry_run, results_json
      FROM maintenance_runs ORDER BY timestamp DESC, id DESC LIMIT ?
    `).all(limit).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      started_at: row.started_at,
      ok_count: row.ok_count,
      total_count: row.total_count,
      dry_run: !!row.dry_run,
      results: (() => {
        try { return JSON.parse(row.results_json || '[]'); } catch (_) { return []; }
      })()
    }));
  }

  /**
   * Prune old maintenance runs, keeping the most recent entries.
   * @param {number} [keepCount=100] - Number of recent runs to retain.
   * @returns {Database.RunResult} Delete result.
   */
  pruneMaintenanceRuns(keepCount = 100) {
    const count = this.db.prepare('SELECT COUNT(*) AS total FROM maintenance_runs').get().total;
    if (count <= keepCount) return { changes: 0 };
    const deleteCount = count - keepCount;
    return this.db.prepare(`
      DELETE FROM maintenance_runs
      WHERE id IN (
        SELECT id FROM maintenance_runs ORDER BY timestamp ASC, id ASC LIMIT ?
      )
    `).run(deleteCount);
  }

  /**
   * Mark a warning as ignored.
   * @param {Object} warning - Warning record.
   * @param {string} warning.id - Stable warning identifier.
   * @param {string} warning.title - Warning title.
   * @param {string} warning.detail - Warning detail text.
   * @returns {Database.RunResult} Insert-or-replace result.
   */
  ignoreWarning(warning) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO ignored_warnings (id, title, detail) VALUES (@id, @title, @detail)');
    return stmt.run(warning);
  }

  /**
   * Remove a warning from the ignored list.
   * @param {string} id - Warning identifier.
   * @returns {Database.RunResult} Delete result.
   */
  unignoreWarning(id) {
    return this.db.prepare('DELETE FROM ignored_warnings WHERE id = ?').run(id);
  }

  /**
   * Get all ignored warnings.
   * @returns {Array<Object>} Ignored warning rows.
   */
  getIgnoredWarnings() {
    return this.db.prepare('SELECT * FROM ignored_warnings ORDER BY ignored_at DESC').all();
  }

  /**
   * Check whether a warning id is currently ignored.
   * @param {string} id - Warning identifier.
   * @returns {boolean} True if the warning is ignored.
   */
  isWarningIgnored(id) {
    return !!this.db.prepare('SELECT id FROM ignored_warnings WHERE id = ?').get(id);
  }

  // --- Settings API ---

  /**
   * Read a setting value.
   * @param {string} key - Setting key.
   * @param {*} [defaultValue=null] - Fallback when the key is missing.
   * @returns {*} Parsed setting value, or defaultValue.
   */
  getSetting(key, defaultValue = null) {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key);
    return row ? JSON.parse(row.value) : defaultValue;
  }

  /**
   * Write a setting value.
   * @param {string} key - Setting key.
   * @param {*} value - Setting value (will be JSON-serialized).
   * @returns {Database.RunResult} Upsert result.
   */
  setSetting(key, value) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    return stmt.run(key, JSON.stringify(value));
  }

  // --- Network Blocklist Cache API ---

  /**
   * Get cached blocklist data by source name.
   * @param {string} source - Blocklist source identifier.
   * @returns {Object|null} Cached blocklist row, or null.
   */
  getBlocklistCache(source) {
    return this.db.prepare('SELECT * FROM network_blocklist_cache WHERE source = ?').get(source) || null;
  }

  /**
   * Upsert blocklist cache data.
   * @param {string} source - Blocklist source identifier.
   * @param {string} rawData - Raw blocklist payload.
   * @returns {Database.RunResult} Upsert result.
   */
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

  /**
   * Get cached geo data for an IP.
   * @param {string} ip - IP address.
   * @returns {Object|null} Cached geo row, or null.
   */
  getGeoCache(ip) {
    return this.db.prepare('SELECT * FROM network_geo_cache WHERE ip = ?').get(ip) || null;
  }

  /**
   * Upsert geo cache data.
   * @param {string} ip - IP address.
   * @param {string} rawData - Raw geo payload.
   * @returns {Database.RunResult} Upsert result.
   */
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

  /**
   * Get a reputation hash verdict.
   * @param {string} hash - SHA-256 or similar hash.
   * @returns {Object|null} Verdict object, or null.
   */
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

  /**
   * Upsert a reputation hash record.
   * @param {Object} record - Reputation record.
   * @param {string} record.hash - Hash identifier.
   * @param {string} record.verdict - 'safe' or 'malicious'.
   * @param {string} [record.source] - Source of the verdict.
   * @param {string} [record.note] - Optional note.
   * @returns {Database.RunResult} Upsert result.
   */
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

  /**
   * Remove a reputation hash record.
   * @param {string} hash - Hash identifier.
   * @returns {boolean} True if a row was deleted.
   */
  deleteReputationHash(hash) {
    const result = this.db.prepare('DELETE FROM reputation_hashes WHERE hash = ?').run(hash);
    return result.changes > 0;
  }

  /**
   * List stored reputation hashes.
   * @param {number} [limit=500] - Maximum rows.
   * @returns {Array<Object>} Reputation hash rows.
   */
  listReputationHashes(limit = 500) {
    return this.db.prepare(`
      SELECT hash, verdict, source, note, added_at
      FROM reputation_hashes
      ORDER BY added_at DESC
      LIMIT ?
    `).all(limit);
  }

  // --- Network stats history ---

  /**
   * Record a network throughput sample.
   * @param {string} iface - Network interface name.
   * @param {number} rxSec - Received bytes per second.
   * @param {number} txSec - Transmitted bytes per second.
   * @param {string} [recordedAt] - ISO timestamp; defaults to now.
   * @returns {Database.RunResult} Insert result.
   */
  addNetworkStatsSample(iface, rxSec, txSec, recordedAt = new Date().toISOString()) {
    return this.db.prepare(`
      INSERT INTO network_stats (recorded_at, iface, rx_sec, tx_sec)
      VALUES (?, ?, ?, ?)
    `).run(recordedAt, iface, rxSec, txSec);
  }

  /**
   * Get network stats history.
   * @param {number} [hours=24] - Lookback window in hours.
   * @param {string|null} [iface=null] - Optional interface filter.
   * @returns {Array<Object>} Network stat rows.
   */
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

  /**
   * Delete network stats older than the retention window.
   * @param {number} [retentionDays=7] - Retention window in days.
   * @returns {Database.RunResult} Delete result.
   */
  pruneNetworkStats(retentionDays = 7) {
    const cutoff = new Date(Date.now() - Number(retentionDays) * 86400 * 1000).toISOString();
    return this.db.prepare('DELETE FROM network_stats WHERE recorded_at < ?').run(cutoff);
  }

  // --- Alerts API ---

  /**
   * Get alerts with optional filters.
   * @param {Object} [options={}] - Query options.
   * @param {number} [options.limit=50] - Maximum rows.
   * @param {boolean} [options.unreadOnly=false] - Only unread alerts.
   * @returns {Array<Object>} Alert rows.
   */
  getAlerts(options = {}) {
    const limit = Math.min(500, Number(options.limit) || 50);
    const unreadOnly = !!options.unreadOnly;
    let sql = 'SELECT * FROM alerts';
    if (unreadOnly) sql += ' WHERE is_read = 0';
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    return this.db.prepare(sql).all(limit);
  }

  /**
   * Get alert counts.
   * @returns {{ total: number, unread: number }} Alert counts.
   */
  getAlertCounts() {
    const total = this.db.prepare('SELECT COUNT(*) AS c FROM alerts').get().c;
    const unread = this.db.prepare('SELECT COUNT(*) AS c FROM alerts WHERE is_read = 0').get().c;
    return { total, unread };
  }

  // --- Audit Log API ---

  /**
   * Append an audit log entry.
   * @param {Object} entry
   * @param {string} entry.action - Action identifier.
   * @param {string} [entry.detail] - Optional detail text.
   * @param {string} [entry.result] - Optional result text.
   * @param {boolean} [entry.userInitiated=false] - Whether the user triggered this.
   * @returns {Database.RunResult} Insert result.
   */
  addAuditEntry({ action, detail, result, userInitiated = false }) {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (action, detail, result, user_initiated)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(action, detail, result, userInitiated ? 1 : 0);
  }

  /**
   * Get recent audit log entries.
   * @param {number} [limit=100] - Maximum rows.
   * @returns {Array<Object>} Audit log rows.
   */
  getAuditLog(limit = 100) {
    return this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit);
  }

  // --- User Blocklist API ---

  /**
   * Add an IP blocklist entry.
   * @param {Object} entry
   * @param {string} entry.ip - IP address or CIDR.
   * @param {string} [entry.reason] - Optional reason.
   * @returns {Database.RunResult} Insert result.
   */
  addUserBlocklistEntry(entry) {
    const stmt = this.db.prepare(`
      INSERT INTO user_blocklist (ip, reason) VALUES (@ip, @reason)
    `);
    return stmt.run({ ip: entry.ip, reason: entry.reason || null });
  }

  /**
   * Remove an IP blocklist entry.
   * @param {number} id - Blocklist row id.
   * @returns {Database.RunResult} Delete result.
   */
  removeUserBlocklistEntry(id) {
    return this.db.prepare('DELETE FROM user_blocklist WHERE id = ?').run(id);
  }

  /**
   * Get all IP blocklist entries.
   * @returns {Array<Object>} Blocklist rows.
   */
  getUserBlocklist() {
    return this.db.prepare('SELECT * FROM user_blocklist ORDER BY added_at DESC').all();
  }

  /**
   * Clear all IP blocklist entries.
   * @returns {Database.RunResult} Delete result.
   */
  clearUserBlocklist() {
    return this.db.prepare('DELETE FROM user_blocklist').run();
  }

  // --- User Domain Blocklist API ---

  /**
   * Add a domain blocklist entry.
   * @param {Object} entry
   * @param {string} entry.domain - Domain name.
   * @param {string} [entry.reason] - Optional reason.
   * @returns {Database.RunResult} Insert result.
   */
  addUserDomainBlocklistEntry(entry) {
    const stmt = this.db.prepare(`
      INSERT INTO user_domain_blocklist (domain, reason) VALUES (@domain, @reason)
    `);
    return stmt.run({ domain: entry.domain, reason: entry.reason || null });
  }

  /**
   * Remove a domain blocklist entry.
   * @param {number} id - Blocklist row id.
   * @returns {Database.RunResult} Delete result.
   */
  removeUserDomainBlocklistEntry(id) {
    return this.db.prepare('DELETE FROM user_domain_blocklist WHERE id = ?').run(id);
  }

  /**
   * Get all domain blocklist entries.
   * @returns {Array<Object>} Domain blocklist rows.
   */
  getUserDomainBlocklist() {
    return this.db.prepare('SELECT * FROM user_domain_blocklist ORDER BY added_at DESC').all();
  }

  /**
   * Clear all domain blocklist entries.
   * @returns {Database.RunResult} Delete result.
   */
  clearUserDomainBlocklist() {
    return this.db.prepare('DELETE FROM user_domain_blocklist').run();
  }

  // --- Settings Export ---

  /**
   * Export all settings as a plain object.
   * @returns {Object<string, *>} Settings key/value map.
   */
  exportAllSettings() {
    const settings = {};
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value); }
      catch (_) { settings[row.key] = row.value; }
    }
    return settings;
  }

  /**
   * Export active quarantine state.
   * @returns {Array<Object>} Quarantine rows with status 'quarantined'.
   */
  exportQuarantineState() {
    return this.db.prepare(`
      SELECT id, original_path, quarantine_path, hash, engine,
             threat_name, date_quarantined, reason, status
      FROM quarantine WHERE status = 'quarantined'
    `).all();
  }

  // --- Incremental Scan Cache ---

  /**
   * Record or update a scanned file entry.
   * @param {Object} meta
   * @param {string} meta.path - Absolute file path.
   * @param {number|null} meta.size - File size in bytes.
   * @param {string|null} meta.modifiedAt - ISO mtime string.
   * @returns {Database.RunResult} Upsert result.
   */
  recordScannedFile({ path, size, modifiedAt }) {
    const stmt = this.db.prepare(`
      INSERT INTO scanned_files (path, size, modified_at)
      VALUES (@path, @size, @modifiedAt)
      ON CONFLICT(path) DO UPDATE SET
        size = excluded.size,
        modified_at = excluded.modified_at,
        last_scanned_at = CURRENT_TIMESTAMP
    `);
    return stmt.run({ path, size: size || null, modifiedAt: modifiedAt || null });
  }

  /**
   * Get files that can be skipped because their cached metadata matches.
   * @param {Array<{ path: string, size: number|null, modifiedAt: string|null }>} fileMetadatas - Current file metadata objects.
   * @returns {Set<string>} Paths that can be skipped.
   */
  getFilesToSkip(fileMetadatas) {
    if (!Array.isArray(fileMetadatas) || fileMetadatas.length === 0) return new Set();
    const map = new Map(fileMetadatas.map((m) => [m.path, m]));
    const placeholders = Array.from(map.keys()).map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT path, size, modified_at FROM scanned_files WHERE path IN (${placeholders})
    `).all(...map.keys());
    const skip = new Set();
    for (const row of rows) {
      const meta = map.get(row.path);
      if (meta && meta.size != null && meta.modifiedAt != null && row.size === meta.size && row.modified_at === meta.modifiedAt) {
        skip.add(row.path);
      }
    }
    return skip;
  }

  /**
   * Prune old scanned-file cache entries.
   * @param {number} [olderThanDays=30] - Delete entries older than this many days.
   * @returns {Database.RunResult} Delete result.
   */
  pruneScannedFiles(olderThanDays = 30) {
    const cutoff = new Date(Date.now() - Number(olderThanDays) * 86400 * 1000).toISOString();
    return this.db.prepare('DELETE FROM scanned_files WHERE last_scanned_at < ?').run(cutoff);
  }
}

module.exports = DatabaseService;
