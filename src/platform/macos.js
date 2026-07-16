'use strict';

const base = require('./base');

module.exports = {
  ...base,
  id: 'darwin',
  label: 'macOS',
  supports(feature) {
    return feature === 'startup';
  },
  unavailableMessage(feature) {
    return `${feature} is not yet available on macOS.`;
  }
};
