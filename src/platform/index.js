'use strict';

const windows = require('./windows');
const macos = require('./macos');
const linux = require('./linux');

const PROVIDERS = {
  win32: windows,
  darwin: macos,
  linux
};

function getPlatformId() {
  return process.platform;
}

function getProvider(platform = process.platform) {
  return PROVIDERS[platform] || linux;
}

function isFeatureSupported(feature, platform = process.platform) {
  return getProvider(platform).supports(feature);
}

module.exports = {
  getPlatformId,
  getProvider,
  isFeatureSupported,
  PROVIDERS
};
