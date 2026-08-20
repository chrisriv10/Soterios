'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runJsonPowerShell } = require('../security/windowsChecks');
const { getHostsPath } = require('../scripts/safeScripts/hostsFileCheck');

const BASELINE_KEY = 'tools.persistenceBaseline.v1';
const PENDING_KEY = 'tools.persistencePending.v1';
const LAST_SCAN_KEY = 'tools.persistenceLastScan.v1';
const LAST_ALERT_KEY = 'tools.persistenceLastAlert.v1';
const DAILY_MS = 24 * 60 * 60 * 1000;

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function hashFile(filePath) {
  try {
    if (!filePath || !fs.statSync(filePath).isFile()) return null;
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      let bytes;
      do {
        bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (bytes) hash.update(buffer.subarray(0, bytes));
      } while (bytes);
    } finally {
      fs.closeSync(fd);
    }
    return hash.digest('hex');
  } catch (_) {
    return null;
  }
}

function canonicalItem(item) {
  const source = String(item.source || 'Unknown');
  const name = String(item.name || item.serviceName || 'Unnamed');
  const location = String(item.location || item.path || '');
  const command = String(item.command || '');
  const filePath = item.path || item.exePath || null;
  const id = hashText(`${source}\n${location}\n${name}`.toLowerCase());
  const normalized = {
    id,
    source,
    name,
    friendlyName: item.friendlyName || name,
    location,
    command,
    path: filePath,
    publisher: item.publisher || null,
    signatureStatus: item.signatureStatus || item.signature || 'Unknown',
    fileHash: Object.prototype.hasOwnProperty.call(item, 'fileHash') ? item.fileHash : hashFile(filePath),
    risk: item.risk || null,
    riskReason: item.riskReason || item.recommendedAction || null,
    metadata: item.metadata || {}
  };
  normalized.fingerprint = hashText(JSON.stringify({
    command: normalized.command,
    path: normalized.path,
    publisher: normalized.publisher,
    signatureStatus: normalized.signatureStatus,
    fileHash: normalized.fileHash,
    metadata: normalized.metadata
  }));
  return normalized;
}

function mapById(items) {
  return Object.fromEntries((items || []).map((item) => [item.id, item]));
}

function compareSnapshots(baselineItems, currentItems) {
  const baseline = mapById(baselineItems);
  const current = mapById(currentItems);
  const added = [];
  const modified = [];
  const removed = [];
  for (const [id, item] of Object.entries(current)) {
    if (!baseline[id]) added.push({ id, type: 'added', after: item });
    else if (baseline[id].fingerprint !== item.fingerprint) modified.push({ id, type: 'modified', before: baseline[id], after: item });
  }
  for (const [id, item] of Object.entries(baseline)) {
    if (!current[id]) removed.push({ id, type: 'removed', before: item });
  }
  return { added, modified, removed, total: added.length + modified.length + removed.length };
}

async function collectExtraPersistence() {
  const items = [];
  const warnings = [];
  if (process.platform === 'win32') {
    const winlogon = await runJsonPowerShell(`
      @(
      $key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'
      $p = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
      foreach ($name in @('Shell','Userinit','Taskman')) {
        $value = [string]$p.$name
        if ($value) { [PSCustomObject]@{ Name=$name; Command=$value; Location=$key } }
      }
      )
    `, [], 15000);
    if (!winlogon.ok) warnings.push(`Winlogon values could not be read: ${winlogon.error}`);
    for (const row of (Array.isArray(winlogon.data) ? winlogon.data : (winlogon.data ? [winlogon.data] : []))) {
      items.push({ source: 'Winlogon', name: row.Name, command: row.Command, location: row.Location, path: null, riskReason: 'A key Winlogon persistence value.' });
    }

    const wmi = await runJsonPowerShell(`
      @(
      $ns = 'root/subscription'
      Get-CimInstance -Namespace $ns -ClassName __EventFilter -ErrorAction SilentlyContinue | ForEach-Object {
        [PSCustomObject]@{ Kind='Filter'; Name=$_.Name; Command=$_.Query; Location=$ns }
      }
      Get-CimInstance -Namespace $ns -ClassName CommandLineEventConsumer -ErrorAction SilentlyContinue | ForEach-Object {
        [PSCustomObject]@{ Kind='CommandLine consumer'; Name=$_.Name; Command=($_.ExecutablePath + ' ' + $_.CommandLineTemplate).Trim(); Location=$ns }
      }
      Get-CimInstance -Namespace $ns -ClassName ActiveScriptEventConsumer -ErrorAction SilentlyContinue | ForEach-Object {
        [PSCustomObject]@{ Kind='Active script consumer'; Name=$_.Name; Command=$_.ScriptText; Location=$ns }
      }
      Get-CimInstance -Namespace $ns -ClassName __FilterToConsumerBinding -ErrorAction SilentlyContinue | ForEach-Object {
        [PSCustomObject]@{ Kind='Binding'; Name=$_.Consumer; Command=$_.Filter; Location=$ns }
      }
      )
    `, [], 30000);
    if (!wmi.ok) warnings.push(`WMI subscriptions could not be read: ${wmi.error}`);
    for (const row of (Array.isArray(wmi.data) ? wmi.data : (wmi.data ? [wmi.data] : []))) {
      items.push({ source: 'WMI Permanent Subscription', name: row.Name || row.Kind, command: row.Command, location: row.Location, path: null, riskReason: `${row.Kind} in WMI permanent subscriptions.` });
    }
  }

  try {
    const hostsPath = getHostsPath();
    const content = fs.readFileSync(hostsPath);
    items.push({
      source: 'Hosts File',
      name: 'Hosts file state',
      command: '',
      location: hostsPath,
      path: hostsPath,
      fileHash: crypto.createHash('sha256').update(content).digest('hex'),
      metadata: { sizeBytes: content.length }
    });
  } catch (error) {
    warnings.push(`Hosts file could not be read: ${error.message}`);
  }
  return { items, warnings };
}

class PersistenceMonitor {
  constructor({ db, toolRegistry, notify, log } = {}) {
    this.db = db;
    this.toolRegistry = toolRegistry;
    this.notify = typeof notify === 'function' ? notify : () => {};
    this.log = typeof log === 'function' ? log : () => {};
    this.startupTimer = null;
    this.dailyTimer = null;
    this.running = null;
  }

  start() {
    this.startupTimer = setTimeout(() => this.scan({ source: 'startup' }).catch((error) => {
      this.log('warn', 'Persistence startup comparison failed', { error: error.message });
    }), 90 * 1000);
    this.startupTimer.unref?.();
    this.dailyTimer = setInterval(() => this.scan({ source: 'daily' }).catch((error) => {
      this.log('warn', 'Persistence daily comparison failed', { error: error.message });
    }), DAILY_MS);
    this.dailyTimer.unref?.();
  }

  stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    this.startupTimer = null;
    this.dailyTimer = null;
  }

  getStatus() {
    const baseline = this.db.getSetting(BASELINE_KEY, null);
    const pending = this.db.getSetting(PENDING_KEY, null);
    return {
      baselineExists: !!baseline,
      baselineApprovedAt: baseline?.approvedAt || null,
      baselineItemCount: baseline?.items?.length || 0,
      lastScan: this.db.getSetting(LAST_SCAN_KEY, null),
      pending,
      running: !!this.running,
      externalLookupsUsed: false,
      externalLookupsEnabled: !!this.db.getSetting('feature.externalLookups', true)
    };
  }

  scan({ source = 'manual', onProgress } = {}) {
    if (this.running) return this.running;
    this.running = this._scan({ source, onProgress }).finally(() => { this.running = null; });
    return this.running;
  }

  async _scan({ source, onProgress }) {
    onProgress?.({ phase: 'collecting', pct: 5, currentActivity: 'Registry, Startup folders, tasks, and services' });
    const registryResult = await this.toolRegistry.run('startup-persistence-scan', { limit: 2000 }, {
      db: this.db,
      toolRegistry: this.toolRegistry,
      sendProgress: onProgress
    });
    if (!registryResult.ok) throw new Error(registryResult.error || 'Persistence collectors failed.');
    onProgress?.({ phase: 'collecting', pct: 55, currentActivity: 'WMI, Winlogon, and hosts state' });
    const extra = await collectExtraPersistence();
    const rawItems = [...(registryResult.data.items || []), ...extra.items];
    const hashes = new Map();
    const all = rawItems.map((item) => {
      if (Object.prototype.hasOwnProperty.call(item, 'fileHash')) return canonicalItem(item);
      const filePath = item.path || item.exePath || null;
      const key = filePath ? path.resolve(filePath).toLowerCase() : null;
      if (key && !hashes.has(key)) hashes.set(key, hashFile(filePath));
      return canonicalItem({ ...item, fileHash: key ? hashes.get(key) : null });
    });
    const deduped = [...new Map(all.map((item) => [item.id, item])).values()]
      .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
    const baseline = this.db.getSetting(BASELINE_KEY, null);
    const changes = baseline ? compareSnapshots(baseline.items || [], deduped) : { added: [], modified: [], removed: [], total: 0 };
    const scannedAt = new Date().toISOString();
    const pending = {
      scannedAt,
      source,
      needsBaselineApproval: !baseline,
      itemCount: deduped.length,
      items: deduped,
      changes,
      warnings: extra.warnings,
      externalLookupsUsed: false
    };
    this.db.setSetting(PENDING_KEY, pending);
    this.db.setSetting(LAST_SCAN_KEY, { scannedAt, source, itemCount: deduped.length, changeCount: changes.total, warnings: extra.warnings });
    if (baseline && (changes.added.length || changes.modified.length)) {
      const count = changes.added.length + changes.modified.length;
      const alertFingerprint = hashText([...changes.added, ...changes.modified]
        .map((change) => `${change.id}:${change.after?.fingerprint || ''}`).sort().join('|'));
      if (this.db.getSetting(LAST_ALERT_KEY, null) !== alertFingerprint) {
        this.db.addAlert('warning', `Persistence Monitor found ${count} new or modified startup mechanism${count === 1 ? '' : 's'}.`);
        this.notify('Persistence changes detected', `${count} new or modified startup mechanism${count === 1 ? '' : 's'} need review.`, 'warning');
        this.db.setSetting(LAST_ALERT_KEY, alertFingerprint);
      }
    } else if (baseline) {
      this.db.setSetting(LAST_ALERT_KEY, null);
    }
    onProgress?.({ phase: 'complete', pct: 100, currentActivity: 'Persistence comparison complete', cancelable: false });
    return pending;
  }

  approve({ ids = null } = {}) {
    const pending = this.db.getSetting(PENDING_KEY, null);
    if (!pending?.items) throw new Error('Run a persistence scan before approving a baseline.');
    const approvedAt = new Date().toISOString();
    if (!Array.isArray(ids) || !ids.length || pending.needsBaselineApproval) {
      const baseline = { version: 1, approvedAt, items: pending.items };
      this.db.setSetting(BASELINE_KEY, baseline);
      this.db.setSetting(PENDING_KEY, { ...pending, needsBaselineApproval: false, changes: { added: [], modified: [], removed: [], total: 0 } });
      return baseline;
    }
    const baseline = this.db.getSetting(BASELINE_KEY, { version: 1, items: [] });
    const map = mapById(baseline.items || []);
    const pendingMap = mapById(pending.items);
    for (const id of ids) {
      if (pendingMap[id]) map[id] = pendingMap[id];
      else delete map[id];
    }
    const next = { version: 1, approvedAt, items: Object.values(map) };
    this.db.setSetting(BASELINE_KEY, next);
    const changes = compareSnapshots(next.items, pending.items);
    this.db.setSetting(PENDING_KEY, { ...pending, needsBaselineApproval: false, changes });
    return next;
  }
}

module.exports = {
  PersistenceMonitor,
  BASELINE_KEY,
  PENDING_KEY,
  canonicalItem,
  compareSnapshots,
  collectExtraPersistence
};
