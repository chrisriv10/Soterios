'use strict';

const PRIVACY_SENSITIVE_FEATURES = Object.freeze([
  'externalLookups',
  'geoLookup',
  'aiAssistant',
  'networkTrafficHistory',
  'scanHistory',
  'autoReports'
]);

function snapshotFeatures(features) {
  const snapshot = {};
  for (const key of PRIVACY_SENSITIVE_FEATURES) {
    if (Object.prototype.hasOwnProperty.call(features, key)) {
      snapshot[key] = Boolean(features[key]);
    }
  }
  return snapshot;
}

function buildDisablePatch() {
  const patch = {};
  for (const key of PRIVACY_SENSITIVE_FEATURES) patch[key] = false;
  return patch;
}

function buildRestorePatch(snapshot) {
  const patch = {};
  if (!snapshot || typeof snapshot !== 'object') return patch;
  for (const key of PRIVACY_SENSITIVE_FEATURES) {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
      patch[key] = Boolean(snapshot[key]);
    }
  }
  return patch;
}

module.exports = {
  PRIVACY_SENSITIVE_FEATURES,
  snapshotFeatures,
  buildDisablePatch,
  buildRestorePatch
};