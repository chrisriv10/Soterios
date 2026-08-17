'use strict';

/**
 * Base platform provider for unsupported platforms.
 *
 * All feature checks return `false` and an "unsupported" message.
 */

module.exports = {
  id: 'base',
  label: 'Unknown',
  supports() {
    return false;
  },
  unavailableMessage(feature) {
    return `${feature} is not supported on this platform.`;
  }
};
