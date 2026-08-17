'use strict';

const base = require('./base');

/**
 * macOS platform provider.
 *
 * Currently only `startup` is marked as supported.
 */

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
