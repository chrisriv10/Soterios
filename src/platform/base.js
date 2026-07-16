'use strict';

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
