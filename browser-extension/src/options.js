const DEFAULTS = {
  hibpEnabled: true,
  autoCheck: true,
  showIcon: true,
  notifyDesktop: true
};

/**
 * Browser extension options page.
 *
 * Loads and saves extension settings from `chrome.storage.sync`.
 */

function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, settings => {
    Object.keys(DEFAULTS).forEach(key => {
      const el = document.getElementById(key);
      if (el) el.setAttribute('aria-checked', settings[key]);
    });
  });
}

/**
 * Persists the current toggle settings to chrome.storage.sync.
 */
function saveSettings() {
  const settings = {};
  Object.keys(DEFAULTS).forEach(key => {
    const el = document.getElementById(key);
    if (el) settings[key] = el.getAttribute('aria-checked') === 'true';
  });
  chrome.storage.sync.set(settings, () => {
    const msg = document.getElementById('savedMsg');
    msg.classList.add('show');
    setTimeout(() => msg.classList.remove('show'), 1500);
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings });
  });
}

/**
 * Wires toggle buttons to update settings on click/keyboard interaction.
 */
function setupToggles() {
  document.querySelectorAll('.toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const checked = btn.getAttribute('aria-checked') === 'true';
      btn.setAttribute('aria-checked', !checked);
      saveSettings();
    });
    btn.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        btn.click();
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupToggles();
});