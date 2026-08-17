'use strict';

const base = require('./base');

/**
 * Linux platform provider.
 *
 * Currently only `startup` is marked as supported.
 */

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
