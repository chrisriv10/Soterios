const si = require('systeminformation');

module.exports = async function diskSpaceReport() {
  const fsSize = await si.fsSize();
  const volumes = fsSize.map((d) => ({
    mount: d.mount,
    fs: d.fs,
    sizeGB: +(d.size / 1e9).toFixed(1),
    usedGB: +(d.used / 1e9).toFixed(1),
    freeGB: +((d.size - d.used) / 1e9).toFixed(1),
    usePercent: +d.use.toFixed(1)
  }));

  const lowSpaceWarnings = volumes
    .filter((v) => v.usePercent > 90)
    .map((v) => `${v.mount} is ${v.usePercent}% full`);

  return { volumes, lowSpaceWarnings };
};
