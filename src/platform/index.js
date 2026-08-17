'use strict';

const base = require('./base');
const windows = require('./windows');
const macos = require('./macos');
const linux = require('./linux');

const PROVIDERS = {
  win32: windows,
  darwin: macos,
  linux
};

/**
 * Return the current platform identifier.
 *
 * @returns {string} One of `win32`, `darwin`, `linux`, or other Node.js platform strings.
 */
function getPlatformId() {
  return process.platform;
}

/**
 * Get the platform provider for the current or specified platform.
 *
 * @param {string} [platform=process.platform]
 * @returns {Object}
 */
function getProvider(platform = process.platform) {
  return PROVIDERS[platform] || base;
}

/**
 * Check whether a feature is supported on a given platform.
 *
 * @param {string} feature
 * @param {string} [platform=process.platform]
 * @returns {boolean}
 */
function isFeatureSupported(feature, platform = process.platform) {
  return getProvider(platform).supports(feature);
}

module.exports = {
  getPlatformId,
  getProvider,
  isFeatureSupported,
  PROVIDERS
};
