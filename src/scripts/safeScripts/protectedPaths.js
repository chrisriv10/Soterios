'use strict';

const path = require('path');

/**
 * Builds the list of protected system root paths for the current platform.
 *
 * @returns {string[]} Lowercase root paths.
 */
function buildProtectedRoots() {
  if (process.platform === 'win32') {
    const windir = process.env.WINDIR || 'C:\\Windows';
    const roots = [path.win32.resolve(windir).toLowerCase()];
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)']) {
      const value = process.env[key];
      if (value) roots.push(path.win32.resolve(value).toLowerCase());
    }
    return roots;
  }

  return [
    '/system',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/var',
    '/library',
    '/applications'
  ];
}

const PROTECTED_ROOTS = buildProtectedRoots();
const PROTECTED_PREFIXES = PROTECTED_ROOTS.map((root) => (
  process.platform === 'win32' ? `${root}\\` : `${root}/`
));

/**
 * Normalizes a path for protected-root comparison.
 *
 * @param {string} targetPath - Path to normalize.
 * @returns {string} Normalized lowercase path.
 */
function normalizeProtectedPath(targetPath) {
  const resolved = path.resolve(targetPath);
  if (process.platform === 'win32') {
    return path.win32.normalize(resolved).toLowerCase().replace(/\//g, '\\');
  }
  return path.normalize(resolved).toLowerCase();
}

/**
 * Determines whether a path targets a protected system location.
 *
 * @param {string} targetPath - Path to test.
 * @returns {boolean} True when the path is protected.
 */
function isProtected(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return true;
  const normalized = normalizeProtectedPath(targetPath);
  const separator = process.platform === 'win32' ? '\\' : '/';
  return PROTECTED_ROOTS.some((root) => (
    normalized === root || normalized.startsWith(`${root}${separator}`)
  ));
}

module.exports = {
  PROTECTED_ROOTS,
  PROTECTED_PREFIXES,
  isProtected
};
