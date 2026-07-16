'use strict';

const SUPPORTED = new Set(['uninstaller', 'defender', 'firewall', 'services', 'startup', 'registry']);

module.exports = {
  id: 'win32',
  label: 'Windows',
  supports(feature) {
    return SUPPORTED.has(feature);
  },
  unavailableMessage() {
    return null;
  }
};
