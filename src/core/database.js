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

    // Trusted (false-positive whitelist) hashes — restored by the user and
    // skipped by future scans so they are not re-quarantined.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trusted_hashes (
        hash TEXT PRIMARY KEY,
        original_path TEXT,
        threat_name TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
      CREATE TABLE IF NOT EXISTS audit_warnings (
        id TEXT PRIMARY KEY,
        title TEXT,
        detail TEXT,
        level TEXT,
        scanned_at TEXT
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
        source TEXT DEFAULT 'scheduled',
        results_json TEXT
      )
    `);

    // Migration: add source column to maintenance_runs if missing
    try {
      const maintenanceColumns = this.db.prepare("PRAGMA table_info(maintenance_runs)").all();
      const hasSource = maintenanceColumns.some((col) => col.name === 'source');
      if (!hasSource) {
        this.db.exec("ALTER TABLE maintenance_runs ADD COLUMN source TEXT DEFAULT 'scheduled'");
      }
    } catch (e) {
      console.error(e);
    }

    // Unified history for interactive and scheduled maintenance tools.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_runs (
        run_id TEXT PRIMARY KEY,
        tool_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        summary_json TEXT,
        warnings_json TEXT,
        errors_json TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tool_runs_started_at
      ON tool_runs(started_at DESC)
    `);

    // Seven-day reversible storage used by user-selected maintenance actions.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS maintenance_vault (
        id TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        vault_path TEXT NOT NULL,
        item_type TEXT NOT NULL,
        operation TEXT NOT NULL,
        size_bytes INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_maintenance_vault_expiry
      ON maintenance_vault(status, expires_at)
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

  getQuarantineHistory(status = null) {
    if (status) {
      return this.db.prepare('SELECT * FROM quarantine WHERE status = ? ORDER BY date_quarantined DESC').all(status);
    }
    return this.db.prepare('SELECT * FROM quarantine ORDER BY date_quarantined DESC').all();
  }

  updateQuarantineStatus(id, status) {
    const stmt = this.db.prepare('UPDATE quarantine SET status = ? WHERE id = ?');
    return stmt.run(status, id);
  }

  getQuarantineRecord(id) {
    return this.db.prepare('SELECT * FROM quarantine WHERE id = ?').get(id);
  }

  // --- Trusted hash (false-positive whitelist) API ---
  addTrustedHash(hash, originalPath, threatName) {
    if (!hash) return { changes: 0 };
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO trusted_hashes (hash, original_path, threat_name, added_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    return stmt.run(hash, originalPath || null, threatName || null);
  }

  removeTrustedHash(hash) {
    if (!hash) return { changes: 0 };
    return this.db.prepare('DELETE FROM trusted_hashes WHERE hash = ?').run(hash);
  }

  isHashTrusted(hash) {
    if (!hash) return false;
    return !!this.db.prepare('SELECT hash FROM trusted_hashes WHERE hash = ?').get(hash);
  }

  getTrustedHashes() {
    return this.db.prepare('SELECT * FROM trusted_hashes ORDER BY added_at DESC').all();
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

  addMaintenanceRun({ startedAt, results, dryRunCleanup = false, source = 'scheduled' }) {
    const okCount = (results || []).filter((r) => r.ok).length;
    const stmt = this.db.prepare(`
      INSERT INTO maintenance_runs (started_at, ok_count, total_count, dry_run, source, results_json)
      VALUES (@startedAt, @okCount, @totalCount, @dryRun, @source, @resultsJson)
    `);
    return stmt.run({
      startedAt: startedAt || new Date().toISOString(),
      okCount,
      totalCount: (results || []).length,
      dryRun: dryRunCleanup ? 1 : 0,
      source: source || 'scheduled',
      resultsJson: JSON.stringify(results || [])
    });
  }

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

  deleteMaintenanceRun(id) {
    return this.db.prepare('DELETE FROM maintenance_runs WHERE id = ?').run(id);
  }

  getScheduledMaintenanceHistory(limit = 25) {
    const bounded = Math.max(1, Math.min(Number(limit) || 25, 250));
    return this.db.prepare(`
      SELECT id, timestamp, started_at, ok_count, total_count, dry_run, source, results_json
      FROM maintenance_runs
      WHERE source IN ('scheduled', 'manual-scheduled')
      ORDER BY timestamp DESC, id DESC LIMIT ?
    `).all(bounded).map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      started_at: row.started_at,
      ok_count: row.ok_count,
      total_count: row.total_count,
      dry_run: !!row.dry_run,
      source: row.source || 'scheduled',
      results: (() => {
        try { return JSON.parse(row.results_json || '[]'); } catch (_) { return []; }
      })()
    }));
  }

  deleteToolRun(runId) {
    return this.db.prepare('DELETE FROM tool_runs WHERE run_id = ?').run(runId);
  }

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

  // --- Unified tool run history ---
  startToolRun({ runId, toolId, source = 'manual', startedAt }) {
    return this.db.prepare(`
      INSERT INTO tool_runs (run_id, tool_id, source, status, started_at)
      VALUES (@runId, @toolId, @source, 'running', @startedAt)
    `).run({ runId, toolId, source, startedAt });
  }

  finishToolRun({ runId, status, completedAt, durationMs, summary, warnings, errors }) {
    return this.db.prepare(`
      UPDATE tool_runs SET
        status = @status,
        completed_at = @completedAt,
        duration_ms = @durationMs,
        summary_json = @summaryJson,
        warnings_json = @warningsJson,
        errors_json = @errorsJson
      WHERE run_id = @runId
    `).run({
      runId,
      status,
      completedAt,
      durationMs,
      summaryJson: JSON.stringify(summary || {}),
      warningsJson: JSON.stringify(warnings || []),
      errorsJson: JSON.stringify(errors || [])
    });
  }

  getToolHistory(limit = 50, toolId = null) {
    const bounded = Math.max(1, Math.min(Number(limit) || 50, 250));
    const rows = toolId
      ? this.db.prepare('SELECT * FROM tool_runs WHERE tool_id = ? ORDER BY started_at DESC LIMIT ?').all(toolId, bounded)
      : this.db.prepare('SELECT * FROM tool_runs ORDER BY started_at DESC LIMIT ?').all(bounded);
    return rows.map((row) => ({
      runId: row.run_id,
      toolId: row.tool_id,
      source: row.source,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      summary: this._parseJson(row.summary_json, {}),
      warnings: this._parseJson(row.warnings_json, []),
      errors: this._parseJson(row.errors_json, [])
    }));
  }

  addVaultItem(item) {
    return this.db.prepare(`
      INSERT INTO maintenance_vault (
        id, original_path, vault_path, item_type, operation, size_bytes,
        created_at, expires_at, status, metadata_json
      ) VALUES (
        @id, @originalPath, @vaultPath, @itemType, @operation, @sizeBytes,
        @createdAt, @expiresAt, @status, @metadataJson
      )
    `).run({
      ...item,
      metadataJson: JSON.stringify(item.metadata || {})
    });
  }

  updateVaultItem(id, status, metadata = null) {
    if (metadata === null) {
      return this.db.prepare('UPDATE maintenance_vault SET status = ? WHERE id = ?').run(status, id);
    }
    return this.db.prepare('UPDATE maintenance_vault SET status = ?, metadata_json = ? WHERE id = ?')
      .run(status, JSON.stringify(metadata), id);
  }

  getVaultItem(id) {
    const row = this.db.prepare('SELECT * FROM maintenance_vault WHERE id = ?').get(id);
    return row ? this._mapVaultRow(row) : null;
  }

  getVaultItems({ status = null, expiredBefore = null } = {}) {
    let rows;
    if (status && expiredBefore) {
      rows = this.db.prepare('SELECT * FROM maintenance_vault WHERE status = ? AND expires_at <= ? ORDER BY created_at DESC').all(status, expiredBefore);
    } else if (status) {
      rows = this.db.prepare('SELECT * FROM maintenance_vault WHERE status = ? ORDER BY created_at DESC').all(status);
    } else {
      rows = this.db.prepare('SELECT * FROM maintenance_vault ORDER BY created_at DESC').all();
    }
    return rows.map((row) => this._mapVaultRow(row));
  }

  _mapVaultRow(row) {
    return {
      id: row.id,
      originalPath: row.original_path,
      vaultPath: row.vault_path,
      itemType: row.item_type,
      operation: row.operation,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.status,
      metadata: this._parseJson(row.metadata_json, {})
    };
  }

  _parseJson(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
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

  replaceAuditWarnings(rows) {
    this.db.prepare('DELETE FROM audit_warnings').run();
    const stmt = this.db.prepare('INSERT INTO audit_warnings (id, title, detail, level, scanned_at) VALUES (@id, @title, @detail, @level, @scannedAt)');
    for (const row of rows) stmt.run(row);
    return rows.length;
  }

  getAuditWarnings() {
    return this.db.prepare('SELECT * FROM audit_warnings ORDER BY scanned_at DESC').all();
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

  getProcessReputationCache(hash) {
    if (!hash) return null;
    return this.db.prepare(`
      SELECT hash, malicious, suspicious, undetected, last_checked
      FROM reputation_cache
      WHERE hash = ?
    `).get(hash) || null;
  }

  setProcessReputationCache(hash, counts) {
    if (!hash) return { changes: 0 };
    return this.db.prepare(`
      INSERT INTO reputation_cache (hash, malicious, suspicious, undetected, last_checked)
      VALUES (@hash, @malicious, @suspicious, @undetected, CURRENT_TIMESTAMP)
      ON CONFLICT(hash) DO UPDATE SET
        malicious = excluded.malicious,
        suspicious = excluded.suspicious,
        undetected = excluded.undetected,
        last_checked = CURRENT_TIMESTAMP
    `).run({
      hash,
      malicious: Number(counts?.malicious) || 0,
      suspicious: Number(counts?.suspicious) || 0,
      undetected: Number(counts?.undetected) || 0,
    });
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
