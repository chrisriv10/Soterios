'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function canonical(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInside(candidate, root) {
  if (!candidate || !root) return false;
  const child = canonical(candidate);
  const parent = canonical(root);
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function existing(values) {
  return values.filter(Boolean).map((value) => path.resolve(value));
}

function protectedRoots({ applicationDataPath } = {}) {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return existing([
    process.env.WINDIR || 'C:\\Windows',
    process.env.ProgramFiles || 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    process.env.ProgramData || 'C:\\ProgramData',
    applicationDataPath,
    path.join(appData, 'Soterios'),
    path.join(localAppData, 'Soterios'),
    path.join(home, '.ssh'),
    path.join(home, '.gnupg'),
    path.join(home, '.aws'),
    path.join(home, '.azure'),
    path.join(home, '.kube'),
    path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Protect'),
    path.join(home, 'AppData', 'Local', 'Microsoft', 'Credentials'),
    path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Credentials')
  ]);
}

function defaultMutationRoots() {
  const home = os.homedir();
  return existing([
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    path.join(home, 'Pictures'),
    path.join(home, 'Videos'),
    path.join(home, 'Music'),
    os.tmpdir(),
    process.env.TEMP,
    process.env.TMP
  ]);
}

function hasReparseAncestor(candidate, stopAt = null) {
  let current = path.resolve(candidate);
  const stop = stopAt ? path.resolve(stopAt) : path.parse(current).root;
  while (isInside(current, stop)) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return true;
      const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
      if (canonical(real) !== canonical(current)) return true;
    } catch (err) {
      if (err.code !== 'ENOENT') return true;
    }
    if (canonical(current) === canonical(stop)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

function assessMutation(candidate, options = {}) {
  if (!candidate || typeof candidate !== 'string') return { ok: false, reason: 'A path is required.' };
  const resolved = path.resolve(candidate);
  const protectedList = protectedRoots(options);
  const protectedRoot = protectedList.find((root) => isInside(resolved, root));
  if (protectedRoot) return { ok: false, reason: 'Protected application, credential, or system path.', path: resolved };

  const allowedRoots = existing(options.allowedRoots || defaultMutationRoots());
  const allowedRoot = allowedRoots.find((root) => isInside(resolved, root));
  if (!allowedRoot) return { ok: false, reason: 'Path is outside approved user maintenance folders.', path: resolved };
  if (hasReparseAncestor(resolved, allowedRoot)) return { ok: false, reason: 'Reparse points and symbolic links are not modified.', path: resolved };

  if (options.mustExist !== false && !fs.existsSync(resolved)) {
    return { ok: false, reason: 'Path no longer exists.', path: resolved };
  }
  return { ok: true, path: resolved, allowedRoot };
}

function captureSnapshot(candidate) {
  const stat = fs.lstatSync(candidate);
  return {
    path: path.resolve(candidate),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    isDirectory: stat.isDirectory()
  };
}

function verifySnapshot(snapshot) {
  if (!snapshot || !snapshot.path) return { ok: false, reason: 'Missing preview snapshot.' };
  try {
    const current = captureSnapshot(snapshot.path);
    const unchanged = current.size === snapshot.size
      && Math.trunc(current.mtimeMs) === Math.trunc(snapshot.mtimeMs)
      && current.isDirectory === snapshot.isDirectory;
    return unchanged ? { ok: true, current } : { ok: false, reason: 'Path changed after preview.', current };
  } catch (err) {
    return { ok: false, reason: err.code === 'ENOENT' ? 'Path no longer exists.' : err.message };
  }
}

function isProtectedPath(candidate, options = {}) {
  return protectedRoots(options).some((root) => isInside(candidate, root));
}

module.exports = {
  canonical,
  isInside,
  protectedRoots,
  defaultMutationRoots,
  hasReparseAncestor,
  isProtectedPath,
  assessMutation,
  captureSnapshot,
  verifySnapshot
};

