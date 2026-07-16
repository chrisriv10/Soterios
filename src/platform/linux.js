'use strict';

const base = require('./base');

module.exports = {
  ...base,
  id: 'linux',
  label: 'Linux',
  supports(feature) {
    return feature === 'startup';
  },
  unavailableMessage(feature) {
    return `${feature} is not yet available on Linux.`;
  }
};
