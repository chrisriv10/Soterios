const si = require('systeminformation');

module.exports = {
  id: 'system-monitor',
  name: 'System Monitor',
  description: 'Live CPU, memory, disk, and OS stats.',
  category: 'System',
  icon: 'activity',
  run: async () => {
    const [cpu, mem, currentLoad, fsSize, osInfo, time] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.currentLoad(),
      si.fsSize(),
      si.osInfo(),
      si.time()
    ]);

    const disks = fsSize.map((d) => ({
      mount: d.mount,
      fs: d.fs,
      sizeGB: +(d.size / 1e9).toFixed(1),
      usedGB: +(d.used / 1e9).toFixed(1),
      usePercent: +d.use.toFixed(1)
    }));

    return {
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speedGHz: cpu.speed,
        currentLoadPercent: +currentLoad.currentLoad.toFixed(1)
      },
      memory: {
        totalGB: +(mem.total / 1e9).toFixed(1),
        usedGB: +((mem.total - mem.available) / 1e9).toFixed(1),
        usedPercent: +(((mem.total - mem.available) / mem.total) * 100).toFixed(1)
      },
      disks,
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        arch: osInfo.arch,
        hostname: osInfo.hostname
      },
      uptimeSeconds: time.uptime
    };
  }
};
