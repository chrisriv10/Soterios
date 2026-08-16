'use strict';

const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
const { EventEmitter } = require('events');
const { JavaScriptProcessCollector } = require('./processCollector');
const { NativeProcessClient } = require('./nativeProcessClient');
const { assessProcess } = require('../security/processRisk');
const { getSignatureInfo } = require('../security/windowsChecks');
const { hashFileStreaming } = require('../security/hashUtils');
const { saveEncryptedTrace, savePortableTrace, writeAtomic } = require('./processTrace');
const logger = require('../utils/logger');

const execFileAsync = util.promisify(execFile);
const HISTORY_WINDOW_MS = 15 * 60 * 1000;
const MAX_HISTORY_SAMPLES = 900;
const MAX_SUBSCRIBERS = 4;
const MIN_INTERVAL_MS = 500;
const MAX_INTERVAL_MS = 10_000;
const PROTECTED_PIDS = new Set([0, 4]);
const PROTECTED_NAMES = new Set([
  'system', 'system idle process', 'registry', 'secure system', 'smss.exe',
  'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe',
  'fontdrvhost.exe', 'dwm.exe',
]);
const PRIORITY_CLASSES = new Set(['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High']);
const ACTIONS = new Set([
  'terminate', 'restart', 'suspend', 'resume', 'setPriority', 'setAffinity',
  'setEfficiencyMode', 'createDump',
]);

function clampInterval(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1000;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(number)));
}

function processKeyString(value) {
  const pid = Number(value && value.pid);
  const startedAt = value && value.startedAt != null ? String(value.startedAt) : '';
  return `${pid}@${startedAt}`;
}

function validateProcessKey(value) {
  if (!value || typeof value !== 'object') throw new Error('Process identity is required.');
  const pid = Number(value.pid);
  if (!Number.isInteger(pid) || pid < 0 || pid > 0xFFFFFFFF) throw new Error('Invalid process ID.');
  if (value.startedAt != null && (typeof value.startedAt !== 'string' || value.startedAt.length > 80)) {
    throw new Error('Invalid process start time.');
  }
  return { pid, startedAt: value.startedAt == null ? null : String(value.startedAt) };
}

function safeError(error) {
  return error && error.message ? error.message : String(error || 'Unknown error');
}

function sanitizedDiagnosticError(error) {
  return safeError(error)
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/gi, '%USERPROFILE%')
    .replace(/\\\\[^\\\s]+\\[^\s"']+/g, '<network-path>')
    .replace(/[\r\n\0]+/g, ' ')
    .slice(0, 500);
}

function recommendationForRisk(risk) {
  if (!risk || risk.severity === 'no-concerns') return '';
  if (risk.severity === 'high-concern') return 'Review this process immediately and verify its source before allowing it to continue.';
  if (risk.severity === 'review-recommended') return 'Inspect the publisher, executable path, lineage, and network activity.';
  return 'No known threat was identified, but this process has not been fully verified.';
}

function fingerprint(proc) {
  return JSON.stringify([
    proc.name, proc.ppid, proc.path, proc.commandLine, proc.cpu, proc.cpuUser,
    proc.cpuSystem, proc.memoryPercent, proc.workingSetBytes, proc.privateBytes,
    proc.commitBytes, proc.ioReadBytesPerSec, proc.ioWriteBytesPerSec,
    proc.diskReadBytesPerSec, proc.diskWriteBytesPerSec,
    proc.networkReceiveBytesPerSec, proc.networkSendBytesPerSec,
    proc.gpuPercent, proc.handles, proc.threads, proc.priority,
    proc.efficiencyMode, proc.risk && proc.risk.score, proc.trusted,
  ]);
}

function powershellEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

class ProcessService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.db = options.db || null;
    this.resourcesPath = options.resourcesPath || null;
    this.userDataPath = options.userDataPath || process.cwd();
    this.nativeClientFactory = options.nativeClientFactory || (() => new NativeProcessClient({
      resourcesPath: this.resourcesPath,
      requireIntegrityManifest: !!options.requireIntegrityManifest,
    }));
    this.fallbackCollectorFactory = options.fallbackCollectorFactory || (() => new JavaScriptProcessCollector());
    this.collector = options.collector || null;
    this.collectorKind = options.collector ? 'injected' : null;
    this.snapshot = null;
    this.histories = new Map();
    this.subscribers = new Map();
    this._samplePromise = null;
    this._timer = null;
    this._lastByKey = new Map();
    this._lastTickAt = 0;
    this._trustedHashCache = new Map();
    this._knownHashesByPath = new Map();
    this._signatureCache = new Map();
    this._detailsCollector = options.detailsCollector || new JavaScriptProcessCollector();
    this._started = false;
    this._diagnostics = { helperRestarts: 0, lastError: null, samples: [] };
  }

  async start() {
    if (this._started) return this.getStatus();
    if (!this.collector) {
      const native = this.nativeClientFactory();
      try {
        await native.start();
        this.collector = native;
        this.collectorKind = 'native';
      } catch (error) {
        logger.warn('Native process collector unavailable; using degraded fallback', { error: safeError(error) });
        try { await native.stop(); } catch (_) {}
        this.collector = this.fallbackCollectorFactory();
        await this.collector.start();
        this.collectorKind = 'javascript-fallback';
      }
    } else if (typeof this.collector.start === 'function') {
      await this.collector.start();
    }
    this._started = true;
    return this.getStatus();
  }

  async stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.subscribers.clear();
    const collector = this.collector;
    this.collector = null;
    this._started = false;
    if (collector && typeof collector.stop === 'function') await collector.stop();
  }

  getStatus() {
    return {
      started: this._started,
      provider: this.collectorKind,
      capabilities: this.snapshot ? this.snapshot.capabilities : (this.collector && this.collector.capabilities) || {},
      processCount: this.snapshot && this.snapshot.processes ? this.snapshot.processes.length : 0,
      subscribers: this.subscribers.size,
      historyWindowMs: HISTORY_WINDOW_MS,
    };
  }

  async _trustedState(proc) {
    if (!this.db || !proc.path || !fs.existsSync(proc.path)) return { trusted: false, hash: proc.hash || null };
    const knownHash = proc.hash || this._knownHashesByPath.get(proc.path) || null;
    if (knownHash) return { trusted: !!this.db.isHashTrusted?.(knownHash), hash: knownHash };
    let hasTrustedHashes = false;
    try { hasTrustedHashes = (this.db.getTrustedHashes?.() || []).length > 0; } catch (_) {}
    if (!hasTrustedHashes) return { trusted: false, hash: null };
    if (!this._trustedHashCache.has(proc.path)) {
      this._trustedHashCache.set(proc.path, hashFileStreaming(proc.path).catch(() => null));
    }
    const hash = await this._trustedHashCache.get(proc.path);
    return { trusted: !!(hash && this.db.isHashTrusted?.(hash)), hash };
  }

  async _normalizeSnapshot(raw) {
    let collectedAt = raw.collectedAt || new Date().toISOString();
    if (!Number.isFinite(Date.parse(collectedAt)) && Number.isFinite(Number(collectedAt))) {
      collectedAt = new Date(Number(collectedAt)).toISOString();
    }
    const rawProcesses = Array.isArray(raw.processes) ? raw.processes : [];
    const namesByPid = new Map(rawProcesses.map((proc) => [Number(proc.pid), proc.name || 'unknown']));
    const processes = [];
    for (const rawProcess of rawProcesses) {
      const pid = Number(rawProcess.pid);
      if (!Number.isInteger(pid) || pid < 0) continue;
      let startedAt = rawProcess.startedAt || rawProcess.key?.startedAt || null;
      if (Number.isFinite(Number(startedAt)) && String(startedAt).length <= 14) {
        startedAt = new Date(Number(startedAt)).toISOString();
      }
      const identityStartedAt = rawProcess.key?.startedAt || startedAt;
      const proc = {
        ...rawProcess,
        pid,
        ppid: rawProcess.ppid == null ? null : Number(rawProcess.ppid),
        startedAt,
        key: { pid, startedAt: identityStartedAt },
        commandLine: rawProcess.commandLine || rawProcess.cmd || null,
        cmd: rawProcess.commandLine || rawProcess.cmd || null,
      };
      const trust = await this._trustedState(proc);
      proc.hash = trust.hash;
      proc.trusted = trust.trusted;
      if (proc.hash && this.db && typeof this.db.getReputationHash === 'function') {
        proc.reputation = this.db.getReputationHash(proc.hash);
        if (!proc.reputation && typeof this.db.getProcessReputationCache === 'function') {
          const cached = this.db.getProcessReputationCache(proc.hash);
          if (cached) proc.reputation = {
            source: 'VirusTotal cache',
            checkedAt: cached.last_checked,
            malicious: Number(cached.malicious) || 0,
            suspicious: Number(cached.suspicious) || 0,
            undetected: Number(cached.undetected) || 0,
            verdict: Number(cached.malicious) >= 3 || Number(cached.suspicious) >= 5 ? 'malicious' : 'unknown',
          };
        }
      }
      proc.parentName = namesByPid.get(proc.ppid) || null;
      proc.risk = assessProcess(proc, { parentName: proc.parentName, trusted: proc.trusted });
      proc.suspiciousReasons = proc.risk.evidence.map((item) => item.detail);
      proc.locationReasons = proc.risk.evidence.filter((item) => item.category === 'location').map((item) => item.detail);
      proc.suspicious = proc.risk.severity === 'review-recommended' || proc.risk.severity === 'high-concern';
      proc.recommendedAction = recommendationForRisk(proc.risk);
      proc.memory = proc.memoryPercent ?? proc.memory ?? null;
      proc.diskIo = proc.diskIo ?? (proc.diskReadBytesPerSec == null || proc.diskWriteBytesPerSec == null
        ? null : proc.diskReadBytesPerSec + proc.diskWriteBytesPerSec);
      proc.networkIo = proc.networkIo ?? (proc.networkReceiveBytesPerSec == null || proc.networkSendBytesPerSec == null
        ? null : proc.networkReceiveBytesPerSec + proc.networkSendBytesPerSec);
      processes.push(proc);
    }

    processes.sort((a, b) => {
      const risk = (b.risk?.score || 0) - (a.risk?.score || 0);
      if (risk) return risk;
      return (b.cpu || 0) - (a.cpu || 0);
    });
    const totals = raw.totals || {};
    return {
      protocolVersion: Number(raw.protocolVersion || 1),
      collectedAt,
      provider: raw.capabilities?.provider || this.collectorKind,
      capabilities: { ...(raw.capabilities || this.collector?.capabilities || {}), provider: raw.capabilities?.provider || this.collectorKind },
      totals,
      totalCpu: totals.cpuPercent ?? null,
      totalMemory: totals.memoryPercent ?? null,
      totalDiskIO: totals.diskReadBytesPerSec == null || totals.diskWriteBytesPerSec == null
        ? null : totals.diskReadBytesPerSec + totals.diskWriteBytesPerSec,
      totalNetworkIO: totals.networkReceiveBytesPerSec == null || totals.networkSendBytesPerSec == null
        ? null : totals.networkReceiveBytesPerSec + totals.networkSendBytesPerSec,
      processes,
    };
  }

  _recordHistory(snapshot) {
    const now = Date.parse(snapshot.collectedAt) || Date.now();
    const active = new Set();
    for (const proc of snapshot.processes) {
      const key = processKeyString(proc.key);
      active.add(key);
      const samples = this.histories.get(key) || [];
      samples.push({
        at: snapshot.collectedAt,
        cpu: proc.cpu ?? null,
        memoryPercent: proc.memoryPercent ?? proc.memory ?? null,
        workingSetBytes: proc.workingSetBytes ?? null,
        diskReadBytesPerSec: proc.diskReadBytesPerSec ?? null,
        diskWriteBytesPerSec: proc.diskWriteBytesPerSec ?? null,
        networkReceiveBytesPerSec: proc.networkReceiveBytesPerSec ?? null,
        networkSendBytesPerSec: proc.networkSendBytesPerSec ?? null,
        gpuPercent: proc.gpuPercent ?? null,
        riskScore: proc.risk?.score ?? 0,
      });
      while (samples.length > MAX_HISTORY_SAMPLES || (samples[0] && now - Date.parse(samples[0].at) > HISTORY_WINDOW_MS)) samples.shift();
      this.histories.set(key, samples);
    }
    for (const [key, samples] of this.histories) {
      const last = samples[samples.length - 1];
      if (!last || now - Date.parse(last.at) > HISTORY_WINDOW_MS) this.histories.delete(key);
    }
  }

  _buildDelta(previous, next) {
    if (!previous) return { full: next };
    const previousMap = new Map(previous.processes.map((proc) => [processKeyString(proc.key), proc]));
    const nextMap = new Map(next.processes.map((proc) => [processKeyString(proc.key), proc]));
    const upserts = [];
    const started = [];
    const exited = [];
    for (const [key, proc] of nextMap) {
      const prior = previousMap.get(key);
      if (!prior) started.push(proc);
      if (!prior || fingerprint(prior) !== fingerprint(proc)) upserts.push(proc);
    }
    for (const [key, proc] of previousMap) {
      if (!nextMap.has(key)) exited.push({ key: proc.key, pid: proc.pid, name: proc.name, exitedAt: next.collectedAt });
    }
    return {
      protocolVersion: next.protocolVersion,
      collectedAt: next.collectedAt,
      provider: next.provider,
      capabilities: next.capabilities,
      totals: next.totals,
      totalCpu: next.totalCpu,
      totalMemory: next.totalMemory,
      totalDiskIO: next.totalDiskIO,
      totalNetworkIO: next.totalNetworkIO,
      upserts,
      removed: exited.map((item) => item.key),
      started,
      exited,
    };
  }

  async sample(options = {}) {
    await this.start();
    if (this._samplePromise) return this._samplePromise;
    this._samplePromise = (async () => {
      const sampleStartedAt = Date.now();
      try {
        const raw = await this.collector.sample(options);
        const next = await this._normalizeSnapshot(raw);
        const previous = this.snapshot;
        this.snapshot = next;
        this._recordHistory(next);
        const delta = this._buildDelta(previous, next);
        this.emit('snapshot', next);
        this.emit('delta', delta);
        this._recordDiagnosticSample(sampleStartedAt, next.processes.length, true);
        return next;
      } catch (error) {
        this._diagnostics.lastError = sanitizedDiagnosticError(error);
        if (this.collectorKind === 'native') {
          logger.warn('Native process collector failed; switching to degraded fallback', { error: safeError(error) });
          try { await this.collector.stop(); } catch (_) {}
          this.collector = this.fallbackCollectorFactory();
          await this.collector.start();
          this.collectorKind = 'javascript-fallback';
          this._diagnostics.helperRestarts += 1;
          this.emit('capabilitiesChanged', this.collector.capabilities || {});
          for (const subscriber of this.subscribers.values()) {
            if (!subscriber.sender.isDestroyed?.()) {
              subscriber.sender.send('process:capabilitiesChanged', this.collector.capabilities || {});
            }
          }
          const raw = await this.collector.sample(options);
          const next = await this._normalizeSnapshot(raw);
          const previous = this.snapshot;
          this.snapshot = next;
          this._recordHistory(next);
          this.emit('delta', this._buildDelta(previous, next));
          this._recordDiagnosticSample(sampleStartedAt, next.processes.length, true);
          return next;
        }
        this._recordDiagnosticSample(sampleStartedAt, 0, false);
        throw error;
      } finally {
        this._samplePromise = null;
      }
    })();
    return this._samplePromise;
  }

  _recordDiagnosticSample(startedAt, processCount, success) {
    this._diagnostics.samples.push({
      at: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      processCount: Number(processCount) || 0,
      success: !!success,
    });
    if (this._diagnostics.samples.length > 60) this._diagnostics.samples.shift();
  }

  async getProcesses() {
    const snapshot = await this.sample();
    return snapshot.processes;
  }

  async getSnapshot() {
    return this.sample();
  }

  _ensureTimer() {
    if (this._timer || !this.subscribers.size) return;
    this._timer = setInterval(() => this._tick().catch((error) => {
      logger.warn('Process subscription sample failed', { error: safeError(error) });
    }), MIN_INTERVAL_MS);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  async _tick() {
    if (!this.subscribers.size) return;
    const now = Date.now();
    const floor = Number(this.collector?.capabilities?.intervalFloorMs || MIN_INTERVAL_MS);
    const wanted = Math.max(floor, Math.min(...[...this.subscribers.values()].map((item) => item.intervalMs)));
    if (now - this._lastTickAt < wanted) return;
    this._lastTickAt = now;
    const previous = this.snapshot;
    const next = await this.sample();
    const delta = this._buildDelta(previous, next);
    for (const [id, subscriber] of this.subscribers) {
      if (subscriber.sender.isDestroyed?.()) {
        this.subscribers.delete(id);
        continue;
      }
      if (now - subscriber.lastSentAt < subscriber.intervalMs) continue;
      subscriber.lastSentAt = now;
      subscriber.sender.send('process:delta', delta);
      for (const started of delta.started || []) subscriber.sender.send('process:started', started);
      for (const exited of delta.exited || []) subscriber.sender.send('process:exited', exited);
    }
    if (!this.subscribers.size) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async startSubscription(sender, options = {}) {
    if (!sender || typeof sender.send !== 'function') throw new Error('Invalid subscriber.');
    const id = Number(sender.id);
    if (!this.subscribers.has(id) && this.subscribers.size >= MAX_SUBSCRIBERS) throw new Error('Too many process subscribers.');
    const requestedInterval = clampInterval(options.intervalMs);
    await this.start();
    const floor = Number(this.collector?.capabilities?.intervalFloorMs || MIN_INTERVAL_MS);
    this.subscribers.set(id, { sender, intervalMs: Math.max(floor, requestedInterval), lastSentAt: Date.now() });
    sender.once?.('destroyed', () => this.stopSubscription(sender));
    const snapshot = await this.sample();
    sender.send('process:fullSnapshot', snapshot);
    this._ensureTimer();
    return { success: true, intervalMs: Math.max(floor, requestedInterval), capabilities: snapshot.capabilities };
  }

  stopSubscription(sender) {
    const id = Number(sender && sender.id);
    this.subscribers.delete(id);
    if (!this.subscribers.size && this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return { success: true };
  }

  _findCurrent(processKey) {
    const key = processKeyString(processKey);
    return this.snapshot?.processes?.find((proc) => processKeyString(proc.key) === key) || null;
  }

  async getProcessByKey(processKey) {
    const key = validateProcessKey(processKey);
    if (!this.snapshot) await this.sample();
    return this._findCurrent(key);
  }

  applyReputation(processKey, reputation) {
    const current = this._findCurrent(processKey);
    if (!current) return null;
    current.reputation = reputation;
    current.risk = assessProcess(current, { parentName: current.parentName, trusted: current.trusted });
    current.suspiciousReasons = current.risk.evidence.map((item) => item.detail);
    current.suspicious = current.risk.severity === 'review-recommended' || current.risk.severity === 'high-concern';
    current.recommendedAction = recommendationForRisk(current.risk);
    return current;
  }

  rememberHash(filePath, hash) {
    if (filePath && hash) this._knownHashesByPath.set(filePath, hash);
  }

  async getDetails(processKey, sections = []) {
    const key = validateProcessKey(processKey);
    if (!this.snapshot) await this.sample();
    const current = this._findCurrent(key);
    if (!current) throw new Error('Process not found or its PID has been reused.');
    const allowed = ['overview', 'performance', 'security', 'network', 'timeline', 'modules', 'threads', 'handles', 'waitChain'];
    const wanted = [...new Set((Array.isArray(sections) ? sections : []).filter((section) => allowed.includes(section)))].slice(0, 9);
    const nativeDetails = typeof this.collector.getDetails === 'function'
      ? await this.collector.getDetails(key, wanted)
      : { sections: {}, capabilityErrors: {} };
    if (wanted.includes('network') && (!nativeDetails.sections?.network?.length)) {
      const networkDetails = await this._detailsCollector.getDetails(key, ['network']);
      nativeDetails.sections = { ...(nativeDetails.sections || {}), network: networkDetails.sections?.network || [] };
      nativeDetails.capabilityErrors = { ...(nativeDetails.capabilityErrors || {}) };
      if (networkDetails.capabilityErrors?.network) nativeDetails.capabilityErrors.network = networkDetails.capabilityErrors.network;
      else delete nativeDetails.capabilityErrors.network;
    }
    if (wanted.includes('security') && current.path && fs.existsSync(current.path)) {
      let statKey = current.path;
      try {
        const stat = fs.statSync(current.path);
        statKey = `${current.path}|${stat.size}|${stat.mtimeMs}`;
      } catch (_) {}
      if (!this._signatureCache.has(statKey)) {
        this._signatureCache.set(statKey, getSignatureInfo(current.path).catch(() => ({ status: 'Unknown', publisher: null })));
      }
      current.signature = await this._signatureCache.get(statKey);
      current.signature.checkedAt = new Date().toISOString();
      current.publisher = current.signature.publisher || null;
      current.risk = assessProcess(current, { parentName: current.parentName, trusted: current.trusted });
      current.suspiciousReasons = current.risk.evidence.map((item) => item.detail);
      nativeDetails.sections = { ...(nativeDetails.sections || {}), security: { signature: current.signature } };
    }
    return {
      process: current,
      history: this.histories.get(processKeyString(key)) || [],
      sections: nativeDetails.sections || {},
      capabilityErrors: nativeDetails.capabilityErrors || {},
    };
  }

  _assertActionAllowed(current, action) {
    if (!ACTIONS.has(action)) throw new Error('Unsupported process action.');
    const lower = String(current.name || '').toLowerCase();
    if (PROTECTED_PIDS.has(current.pid) || PROTECTED_NAMES.has(lower)) {
      throw new Error(`${current.name || 'This process'} is protected and cannot be modified.`);
    }
    if (current.pid === process.pid) throw new Error('Soterios cannot modify its own process.');
    if (lower === 'explorer.exe' && action !== 'restart') throw new Error('Windows Explorer can only be restarted from Soterios.');
  }

  async _revalidate(processKey) {
    const key = validateProcessKey(processKey);
    await this.sample({ force: true });
    const current = this._findCurrent(key);
    if (!current) throw new Error('Process not found or its PID has been reused.');
    return current;
  }

  async _terminate(pid) {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/F'], { timeout: 10000, windowsHide: true });
      return { success: true };
    } catch (error) {
      throw new Error(String(error.stderr || error.message || 'Unable to end process.').trim());
    }
  }

  async _setPriority(pid, priority) {
    if (!PRIORITY_CLASSES.has(priority)) throw new Error('Invalid priority class.');
    const script = `$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.PriorityClass = '${priority}'`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(script)], {
      timeout: 10000,
      windowsHide: true,
    });
    return { success: true };
  }

  async _setAffinity(pid, affinityMask) {
    const mask = Number(affinityMask);
    if (!Number.isSafeInteger(mask) || mask <= 0) throw new Error('Invalid processor affinity mask.');
    const script = `$p = Get-Process -Id ${pid} -ErrorAction Stop; $p.ProcessorAffinity = [intptr]${mask}`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(script)], {
      timeout: 10000,
      windowsHide: true,
    });
    return { success: true };
  }

  async _createDump(pid, requestedPath) {
    const dumpDir = path.join(this.userDataPath, 'ProcessDumps');
    fs.mkdirSync(dumpDir, { recursive: true });
    const defaultName = `process-${pid}-${new Date().toISOString().replace(/[:.]/g, '-')}.dmp`;
    const dumpPath = requestedPath ? path.resolve(requestedPath) : path.join(dumpDir, defaultName);
    if (path.extname(dumpPath).toLowerCase() !== '.dmp') throw new Error('Process dumps must use the .dmp extension.');
    await execFileAsync('rundll32.exe', ['C:\\Windows\\System32\\comsvcs.dll, MiniDump', String(pid), dumpPath, 'full'], {
      timeout: 120000,
      windowsHide: true,
    });
    return { success: true, path: dumpPath };
  }

  async performAction(payload = {}) {
    const action = String(payload.action || '');
    const processKey = validateProcessKey(payload.processKey || payload.key);
    const current = await this._revalidate(processKey);
    this._assertActionAllowed(current, action);
    const startedAt = Date.now();
    try {
      let result;
      if (this.collectorKind === 'native' && typeof this.collector.performAction === 'function' &&
          ['suspend', 'resume', 'setEfficiencyMode'].includes(action)) {
        result = await this.collector.performAction({ processKey, action, options: payload.options || {} });
      } else if (action === 'terminate') {
        result = await this._terminate(current.pid);
      } else if (action === 'restart') {
        if (!current.path || !path.isAbsolute(current.path) || !fs.existsSync(current.path)) throw new Error('Executable path is unavailable; restart is not safe.');
        await this._terminate(current.pid);
        const child = spawn(current.path, [], { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
        child.unref();
        result = { success: true };
      } else if (action === 'setPriority') {
        result = await this._setPriority(current.pid, payload.options?.priority);
      } else if (action === 'setAffinity') {
        result = await this._setAffinity(current.pid, payload.options?.affinityMask);
      } else if (action === 'createDump') {
        result = await this._createDump(current.pid, payload.options?.filePath);
      } else {
        throw new Error(`${action} requires the native collector.`);
      }
      logger.info('Process action completed', { action, pid: current.pid, durationMs: Date.now() - startedAt });
      return { success: true, ...result };
    } catch (error) {
      logger.warn('Process action failed', { action, pid: current.pid, durationMs: Date.now() - startedAt, error: safeError(error) });
      return { success: false, error: safeError(error) };
    }
  }

  async killProcess(pidOrKey) {
    if (!this.snapshot) await this.sample();
    const pid = typeof pidOrKey === 'object' ? Number(pidOrKey.pid) : Number(pidOrKey);
    const current = this.snapshot.processes.find((proc) => proc.pid === pid);
    if (!current) return { success: false, error: 'Process not found. It may have already exited.' };
    return this.performAction({ processKey: current.key, action: 'terminate' });
  }

  async runTask(spec = {}) {
    if (typeof spec === 'string') throw new Error('Run Task now requires a structured executable request.');
    const executable = typeof spec.executable === 'string' ? spec.executable.trim() : '';
    if (!executable || executable.length > 2048 || !path.isAbsolute(executable) || !fs.existsSync(executable)) {
      throw new Error('Choose an existing executable using an absolute path.');
    }
    const args = Array.isArray(spec.args) ? spec.args : [];
    if (args.length > 64 || args.some((arg) => typeof arg !== 'string' || arg.length > 4096 || /[\r\n\0]/.test(arg))) {
      throw new Error('Invalid task arguments.');
    }
    if (spec.elevate) throw new Error('On-demand elevation is not available in this build.');
    const cwd = spec.cwd == null || spec.cwd === '' ? path.dirname(executable) : path.resolve(String(spec.cwd));
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('Working directory does not exist.');
    const child = spawn(executable, args, { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    child.unref();
    return { success: true };
  }

  async showProperties(filePath) {
    if (typeof filePath !== 'string' || filePath.length < 3 || filePath.length > 32767 || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) {
      throw new Error('Invalid executable path.');
    }
    const script = [
      "$folderPath = Split-Path -LiteralPath $env:SOTERIOS_TARGET_PATH",
      "$leaf = Split-Path -Leaf -Path $env:SOTERIOS_TARGET_PATH",
      "$shell = New-Object -ComObject Shell.Application",
      "$folder = $shell.Namespace($folderPath)",
      "if (-not $folder) { throw 'Folder unavailable' }",
      "$item = $folder.ParseName($leaf)",
      "if (-not $item) { throw 'File unavailable' }",
      "$item.InvokeVerb('properties')",
    ].join('; ');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', powershellEncoded(script)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, SOTERIOS_TARGET_PATH: filePath },
    });
    child.unref();
    return { success: true };
  }

  async saveTrace(options = {}) {
    if (!this.snapshot) await this.sample();
    if (typeof options.filePath !== 'string' || !path.isAbsolute(options.filePath)) throw new Error('A valid trace path is required.');
    const mode = options.mode === 'portable' ? 'portable' : 'encrypted';
    const savedPath = mode === 'portable'
      ? savePortableTrace(options.filePath, this.snapshot, this.histories, options)
      : await saveEncryptedTrace(options.filePath, this.snapshot, this.histories, options);
    logger.info('Process trace saved', { mode, redaction: options.redaction || 'standard' });
    return { success: true, path: savedPath, encrypted: mode === 'encrypted' };
  }

  getDiagnosticBundle() {
    const samples = this._diagnostics.samples.slice();
    const durations = samples.filter((item) => item.success).map((item) => item.durationMs);
    return {
      format: 'soterios-process-diagnostics',
      version: 1,
      createdAt: new Date().toISOString(),
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        node: process.versions.node,
        electron: process.versions.electron || null,
      },
      collector: {
        provider: this.collectorKind,
        protocolVersion: this.snapshot?.protocolVersion || null,
        capabilities: this.snapshot?.capabilities || this.collector?.capabilities || {},
        processCount: this.snapshot?.processes?.length || 0,
        helperRestarts: this._diagnostics.helperRestarts,
      },
      performance: {
        sampleCount: samples.length,
        successfulSamples: durations.length,
        averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
        maximumDurationMs: durations.length ? Math.max(...durations) : null,
        samples,
      },
      lastSanitizedError: this._diagnostics.lastError,
      privacy: {
        includesProcesses: false,
        includesPaths: false,
        includesCommandLines: false,
        includesUsers: false,
        transmittedAutomatically: false,
      },
    };
  }

  saveDiagnosticBundle(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') {
      throw new Error('A valid JSON diagnostic path is required.');
    }
    const savedPath = writeAtomic(filePath, Buffer.from(JSON.stringify(this.getDiagnosticBundle(), null, 2), 'utf8'));
    return { success: true, path: savedPath };
  }
}

module.exports = {
  ACTIONS,
  HISTORY_WINDOW_MS,
  MAX_HISTORY_SAMPLES,
  PRIORITY_CLASSES,
  ProcessService,
  processKeyString,
  validateProcessKey,
};
