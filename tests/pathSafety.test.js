'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { hasReparseAncestor } = require('../src/core/pathSafety');

it('does not treat Windows 8.3 aliases as reparse ancestors', () => {
  const originalPlatform = process.platform;
  const originalLstatSync = fs.lstatSync;
  const originalRealpathNative = fs.realpathSync.native;
  const originalRealpath = fs.realpathSync;

  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  fs.lstatSync = () => ({ isSymbolicLink: () => false });
  fs.realpathSync.native = (target) => String(target).replace('RUNNER~1', 'runneradmin');
  fs.realpathSync = (target) => String(target).replace('RUNNER~1', 'runneradmin');

  try {
    const result = hasReparseAncestor('/tmp/RUNNER~1/workspace/folder', '/tmp/RUNNER~1/workspace');
    assert.equal(result, false);
  } finally {
    fs.lstatSync = originalLstatSync;
    fs.realpathSync.native = originalRealpathNative;
    fs.realpathSync = originalRealpath;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

it('still flags realpath mismatches without short-name aliases', () => {
  const originalPlatform = process.platform;
  const originalLstatSync = fs.lstatSync;
  const originalRealpathNative = fs.realpathSync.native;
  const originalRealpath = fs.realpathSync;

  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  fs.lstatSync = () => ({ isSymbolicLink: () => false });
  fs.realpathSync.native = (target) => String(target).replace('/tmp/workspace', '/tmp/linked-target');
  fs.realpathSync = (target) => String(target).replace('/tmp/workspace', '/tmp/linked-target');

  try {
    const result = hasReparseAncestor('/tmp/workspace/folder', '/tmp/workspace');
    assert.equal(result, true);
  } finally {
    fs.lstatSync = originalLstatSync;
    fs.realpathSync.native = originalRealpathNative;
    fs.realpathSync = originalRealpath;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});
