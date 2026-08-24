'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { assessMutation } = require('../../core/pathSafety');

const CHUNK = 1024 * 1024;
const METHODS = {
  simple: { id: 'simple', name: 'One overwrite pass', passes: [{ type: 'random' }] },
  dod: { id: 'dod', name: 'Three overwrite passes', passes: [{ type: 'zeros' }, { type: 'ones' }, { type: 'random' }] },
  schneier: { id: 'schneier', name: 'Seven overwrite passes', passes: [{ type: 'ones' }, { type: 'zeros' }, ...Array.from({ length: 5 }, () => ({ type: 'random' }))] }
};

function storageInfo(target) {
  if (process.platform !== 'win32') return Promise.resolve({ type: 'unknown', name: 'Unknown storage device' });
  const drive = path.parse(path.resolve(target)).root.replace(/[\\:]/g, '');
  return new Promise((resolve) => {
    const script = `
$partition = Get-Partition -DriveLetter '${drive}' -ErrorAction SilentlyContinue
$disk = $partition | Get-Disk -ErrorAction SilentlyContinue
$physical = Get-PhysicalDisk -ErrorAction SilentlyContinue | Where-Object { [string]$_.DeviceId -eq [string]$disk.Number } | Select-Object -First 1
[PSCustomObject]@{ MediaType=[string]$physical.MediaType; FriendlyName=[string]$physical.FriendlyName; BusType=[string]$disk.BusType } | ConvertTo-Json -Compress
`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 }, (_error, stdout) => {
      try {
        const data = JSON.parse(String(stdout || '').trim());
        const media = String(data.MediaType || '').toLowerCase();
        resolve({
          type: media.includes('ssd') ? 'ssd' : (media.includes('hdd') ? 'hdd' : 'unknown'),
          name: data.FriendlyName || 'Storage device',
          busType: data.BusType || ''
        });
      } catch (_) { resolve({ type: 'unknown', name: 'Unknown storage device' }); }
    });
  });
}

function listFilesRecursive(targetPath, out = [], errors = []) {
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) {
    errors.push({ path: targetPath, error: 'Symbolic links and reparse points cannot be shredded.' });
    return out;
  }
  if (stat.isFile()) { out.push(targetPath); return out; }
  if (!stat.isDirectory()) return out;
  for (const name of fs.readdirSync(targetPath)) {
    try { listFilesRecursive(path.join(targetPath, name), out, errors); }
    catch (error) { errors.push({ path: path.join(targetPath, name), error: error.message }); }
  }
  return out;
}

function passBuffer(pass, length) {
  if (pass.type === 'zeros') return Buffer.alloc(length, 0);
  if (pass.type === 'ones') return Buffer.alloc(length, 0xff);
  return crypto.randomBytes(length);
}

async function overwriteFile(filePath, method, report) {
  const stat = await fs.promises.stat(filePath);
  const fd = await fs.promises.open(filePath, 'r+');
  try {
    for (let passIndex = 0; passIndex < method.passes.length; passIndex += 1) {
      let written = 0;
      while (written < stat.size) {
        const length = Math.min(CHUNK, stat.size - written);
        await fd.write(passBuffer(method.passes[passIndex], length), 0, length, written);
        written += length;
        report?.({ pass: passIndex + 1, totalPasses: method.passes.length, bytesWritten: written, fileBytes: stat.size });
      }
      await fd.sync();
    }
  } finally {
    await fd.close();
  }
  await fs.promises.unlink(filePath);
}

async function shredTargets(args = {}, onProgress) {
  const targets = args.targets || args.paths || (args.path ? [args.path] : []);
  const method = METHODS[args.method || 'simple'];
  const preview = args.mode === 'preview' || args.dryRun === true;
  if (!Array.isArray(targets) || !targets.length) return { success: false, error: 'Select at least one file or folder.' };
  if (!method) return { success: false, error: 'Unknown overwrite method.' };
  if (!preview && args.confirmation !== 'SHRED') return { success: false, error: 'Type SHRED to confirm this irreversible action.' };

  const files = [];
  const errors = [];
  const directories = [];
  const devices = new Map();
  for (const target of [...new Set(targets.map((entry) => path.resolve(entry)))]) {
    const safety = assessMutation(target, { allowedRoots: [path.parse(target).root] });
    if (!safety.ok) { errors.push({ path: target, error: safety.reason }); continue; }
    try {
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) directories.push(target);
      listFilesRecursive(target, files, errors);
      const root = path.parse(target).root.toLowerCase();
      if (!devices.has(root)) devices.set(root, await storageInfo(target));
    } catch (error) { errors.push({ path: target, error: error.message }); }
  }
  const uniqueFiles = [...new Set(files)];
  const storageDevices = [...devices.entries()].map(([root, info]) => ({ root, ...info }));
  const hasNonHdd = storageDevices.some((device) => device.type !== 'hdd');
  if (method.passes.length > 1 && hasNonHdd) {
    return {
      success: false,
      error: 'Multi-pass overwrite modes are available only when every selected file is on a detected HDD.',
      storageDevices
    };
  }
  const totalFileBytes = uniqueFiles.reduce((sum, file) => {
    try { return sum + fs.statSync(file).size; } catch (_) { return sum; }
  }, 0);
  const warning = storageDevices.some((device) => device.type === 'ssd')
    ? 'SSD wear-leveling means software overwrites cannot guarantee every physical copy was erased. Use device encryption and manufacturer secure erase for stronger assurance.'
    : 'Overwrite-based deletion is irreversible. Backups and shadow copies are not affected.';
  if (preview) {
    return {
      success: true, mode: 'preview', dryRun: true, method: method.id, methodName: method.name,
      fileCount: uniqueFiles.length, files: uniqueFiles, directories, totalFileBytes,
      estimatedOverwriteBytes: totalFileBytes * method.passes.length,
      storageDevices, multiPassAvailable: !hasNonHdd, warning, errors
    };
  }

  const shredded = [];
  let completedBytes = 0;
  for (const filePath of uniqueFiles) {
    const fileSize = (() => { try { return fs.statSync(filePath).size; } catch (_) { return 0; } })();
    try {
      await overwriteFile(filePath, method, ({ pass, totalPasses, bytesWritten, fileBytes }) => {
        const withinFile = ((pass - 1) * fileBytes + bytesWritten) / totalPasses;
        const pct = totalFileBytes ? Math.round(((completedBytes + withinFile) / totalFileBytes) * 100) : 100;
        onProgress?.({
          phase: 'shredding', label: `Overwriting pass ${pass} of ${totalPasses}`, pct,
          currentActivity: filePath, cancelable: true
        });
      });
      completedBytes += fileSize;
      shredded.push(filePath);
    } catch (error) { errors.push({ path: filePath, error: error.message }); }
  }
  directories.sort((a, b) => b.length - a.length);
  for (const directory of directories) {
    try { if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory); }
    catch (error) { errors.push({ path: directory, error: `Directory retained: ${error.message}` }); }
  }
  return {
    success: errors.length === 0,
    mode: 'shred', dryRun: false, method: method.id, methodName: method.name,
    shredded, fileCount: shredded.length,
    estimatedOverwriteBytes: totalFileBytes * method.passes.length,
    storageDevices, warning, errors
  };
}

module.exports = (args = {}, onProgress) => shredTargets(args, onProgress);
module.exports.METHODS = METHODS;
module.exports.shredTargets = shredTargets;
module.exports.storageInfo = storageInfo;
