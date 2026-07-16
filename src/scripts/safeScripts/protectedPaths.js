'use strict';

const path = require('path');

function buildProtectedPrefixes() {
  if (process.platform === 'win32') {
    const windir = process.env.WINDIR || 'C:\\Windows';
    const prefixes = [
      path.win32.resolve(windir).toLowerCase() + '\\'
    ];
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)']) {
      const value = process.env[key];
      if (value) {
        prefixes.push(path.win32.resolve(value).toLowerCase() + '\\');
      }
    }
    return prefixes;
  }

  return [
    '/system/',
    '/usr/',
    '/bin/',
    '/sbin/',
    '/etc/',
    '/var/',
    '/library/',
    '/applications/'
  ];
}

const PROTECTED_PREFIXES = buildProtectedPrefixes();

function isProtected(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return true;
  const resolved = path.resolve(targetPath).toLowerCase();
  if (process.platform === 'win32') {
    const normalized = resolved.replace(/\//g, '\\');
    return PROTECTED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }
  return PROTECTED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

module.exports = {
  PROTECTED_PREFIXES,
  isProtected
};
