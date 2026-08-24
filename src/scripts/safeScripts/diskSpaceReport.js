const si = require('systeminformation');
const { isUserFacingVolume } = require('../../tools/healthScore');

module.exports = async function diskSpaceReport(_args = {}, onProgress) {
  onProgress?.({ phase: 'collecting', label: 'Reading volume information', pct: 10, cancelable: true });
  const [fsSize, blockDevices] = await Promise.all([si.fsSize(), si.blockDevices().catch(() => [])]);
  const userFacingVolumes = fsSize.filter(isUserFacingVolume);
  const volumes = userFacingVolumes.map((disk) => {
    const device = blockDevices.find((entry) => entry.mount === disk.mount || entry.name === disk.fs || entry.device === disk.fs) || {};
    const usePercent = +disk.use.toFixed(1);
    const status = usePercent >= 95 ? 'critical' : (usePercent >= 85 ? 'warning' : 'healthy');
    return {
      id: disk.mount || disk.fs,
      label: device.label || device.name || `Local Disk (${disk.mount})`,
      mount: disk.mount,
      device: disk.fs,
      filesystem: disk.type || device.fstype || 'Unknown',
      driveType: device.type || device.physical || device.interfaceType || 'Local volume',
      sizeBytes: disk.size,
      usedBytes: disk.used,
      freeBytes: disk.size - disk.used,
      sizeGB: +(disk.size / 1e9).toFixed(1),
      usedGB: +(disk.used / 1e9).toFixed(1),
      freeGB: +((disk.size - disk.used) / 1e9).toFixed(1),
      usePercent,
      status
    };
  });
  onProgress?.({ phase: 'complete', label: 'Disk space report ready', pct: 100, count: volumes.length, total: volumes.length, cancelable: false });
  return {
    volumes,
    thresholds: { warningPercent: 85, criticalPercent: 95 },
    lowSpaceWarnings: volumes.filter((volume) => volume.status !== 'healthy').map((volume) => `${volume.mount} is ${volume.usePercent}% full`)
  };
};
