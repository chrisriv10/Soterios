'use strict';

const SUPPORTED = new Set(['uninstaller', 'defender', 'firewall', 'services', 'startup', 'registry']);

/**
 * Windows platform provider.
 *
 * Supports the broadest feature set including uninstaller, Defender,
 * firewall, services, startup, and registry features.
 */

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
