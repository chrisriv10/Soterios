const si = require('systeminformation');
const { isUserFacingVolume } = require('../../tools/healthScore');

module.exports = async function diskSpaceReport() {
  const fsSize = await si.fsSize();
  const userFacingVolumes = fsSize.filter(isUserFacingVolume);
  const volumes = userFacingVolumes.map((d) => ({ mount: d.mount, fs: d.fs, sizeGB: +(d.size / 1e9).toFixed(1), usedGB: +(d.used / 1e9).toFixed(1), freeGB: +((d.size - d.used) / 1e9).toFixed(1), usePercent: +d.use.toFixed(1) }));
  return { volumes, lowSpaceWarnings: volumes.filter((v) => v.usePercent > 90).map((v) => `${v.mount} is ${v.usePercent}% full`) };
};
