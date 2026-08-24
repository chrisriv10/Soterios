'use strict';

const si = require('systeminformation');

const FALLBACK_CAPABILITIES = Object.freeze({
  provider: 'javascript-fallback',
  native: false,
  degraded: true,
  intervalFloorMs: 3000,
  processTree: true,
  cpu: true,
  cpuUserKernel: true,
  memory: true,
  io: false,
  diskIo: false,
  networkIo: false,
  gpu: false,
  owner: true,
  integrity: false,
  architecture: false,
  protectionLevel: false,
  handles: false,
  threads: true,
  modules: false,
  connections: true,
  suspendResume: false,
  affinity: true,
  efficiencyMode: false,
  dumps: true,
  waitChain: false,
  etw: false,
});

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isoStartedAt(value) {
  if (!value) return null;
  const parsed = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function mapProcess(item) {
  const cpu = finite(item.cpu);
  const cpuUser = finite(item.cpuu);
  const cpuSystem = finite(item.cpus);
  const memoryPercent = finite(item.mem);
  const workingSetBytes = finite(item.memRss) == null ? null : Math.max(0, finite(item.memRss) * 1024);
  const virtualBytes = finite(item.memVsz) == null ? null : Math.max(0, finite(item.memVsz) * 1024);
  const startedAt = isoStartedAt(item.started);
  return {
    key: { pid: Number(item.pid), startedAt },
    pid: Number(item.pid),
    ppid: finite(item.parentPid),
    startedAt,
    name: item.name || 'unknown',
    path: item.path || null,
    commandLine: item.command || null,
    cmd: item.command || null,
    args: item.params || null,
    user: item.user || null,
    state: item.state || null,
    architecture: null,
    integrityLevel: null,
    protectionLevel: null,
    signature: { status: 'Unknown', publisher: null, checkedAt: null },
    publisher: null,
    cpu,
    cpuUser,
    cpuSystem,
    memory: memoryPercent,
    memoryPercent,
    workingSetBytes,
    privateBytes: null,
    commitBytes: virtualBytes,
    virtualBytes,
    ioReadBytesPerSec: null,
    ioWriteBytesPerSec: null,
    diskReadBytesPerSec: null,
    diskWriteBytesPerSec: null,
    diskIo: null,
    networkReceiveBytesPerSec: null,
    networkSendBytesPerSec: null,
    networkIo: null,
    gpuPercent: null,
    gpuDedicatedBytes: null,
    gpuSharedBytes: null,
    handles: null,
    threads: finite(item.threads),
    priority: finite(item.priority),
    affinityMask: null,
    efficiencyMode: null,
    capabilityErrors: {
      io: 'Native collector unavailable',
      networkIo: 'Native collector unavailable',
      gpu: 'Native collector unavailable',
    },
  };
}

class JavaScriptProcessCollector {
  constructor() {
    this.capabilities = { ...FALLBACK_CAPABILITIES };
    this.protocolVersion = 1;
  }

  async start() {
    return { protocolVersion: this.protocolVersion, capabilities: this.capabilities };
  }

  async stop() {}

  async sample() {
    const collectedAt = new Date().toISOString();
    const [processData, loadData, memoryData] = await Promise.all([
      si.processes(),
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
    ]);
    const processes = (processData && Array.isArray(processData.list) ? processData.list : [])
      .filter((item) => Number.isInteger(Number(item.pid)) && Number(item.pid) >= 0)
      .map(mapProcess);
    const memoryPercent = memoryData && finite(memoryData.total, 0) > 0
      ? ((finite(memoryData.total, 0) - finite(memoryData.available, 0)) / finite(memoryData.total, 1)) * 100
      : null;
    return {
      protocolVersion: this.protocolVersion,
      collectedAt,
      capabilities: this.capabilities,
      totals: {
        cpuPercent: loadData ? finite(loadData.currentLoad) : null,
        memoryPercent: finite(memoryPercent),
        memoryUsedBytes: memoryData ? finite(memoryData.active, finite(memoryData.used)) : null,
        memoryTotalBytes: memoryData ? finite(memoryData.total) : null,
        diskReadBytesPerSec: null,
        diskWriteBytesPerSec: null,
        networkReceiveBytesPerSec: null,
        networkSendBytesPerSec: null,
        gpuPercent: null,
      },
      processes,
    };
  }

  async getDetails(processKey, sections = []) {
    const pid = Number(processKey && processKey.pid);
    const wanted = new Set(Array.isArray(sections) ? sections : []);
    const result = { processKey, sections: {}, capabilityErrors: {} };

    if (wanted.has('network')) {
      try {
        const rows = await si.networkConnections();
        result.sections.network = rows
          .filter((row) => Number(row.pid || row.processId) === pid)
          .map((row) => ({
            protocol: row.protocol || null,
            state: row.state || null,
            localAddress: row.localAddress || null,
            localPort: finite(row.localPort),
            remoteAddress: row.peerAddress || row.remoteAddress || null,
            remotePort: finite(row.peerPort || row.remotePort),
          }));
      } catch (error) {
        result.sections.network = [];
        result.capabilityErrors.network = error.message || String(error);
      }
    }

    for (const section of ['modules', 'threads', 'handles', 'waitChain']) {
      if (wanted.has(section)) {
        result.sections[section] = [];
        result.capabilityErrors[section] = 'Requires the native collector';
      }
    }
    return result;
  }
}

module.exports = {
  FALLBACK_CAPABILITIES,
  JavaScriptProcessCollector,
  mapProcess,
};
