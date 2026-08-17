/**
 * Electron auto-updater wrapper.
 *
 * Manages update state, forwards status to listeners, and exposes
 * simple init/check/install helpers.
 */
'use strict';

const { app } = require('electron');
const logger = require('../utils/logger');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (_) {
  autoUpdater = null;
}

let initialized = false;

const state = {
  status: 'idle',
  message: '',
  progress: null,
  version: null,
  error: null
};

/**
 * Merge a patch into the shared update state and notify listeners.
 * @param {Object} patch
 */
function setState(patch) {
  Object.assign(state, patch);
  for (const listener of setState._listeners) {
    try { listener({ ...state }); } catch (err) {
      logger.debug('Updater listener threw', { error: err.message });
    }
  }
}
setState._listeners = new Set();

/**
 * Subscribes to an auto-updater status event channel.
 *
 * @param {string} channel - Event channel name.
 * @param {Function} handler - Event handler.
 */
function onStatus(channel, handler) {
  if (!autoUpdater) return;
  autoUpdater.on(channel, handler);
}

/**
 * Initialize the Electron auto-updater integration.
 *
 * Wires `electron-updater` status events to the shared update state and
 * optionally sends desktop notifications on state changes. Only operates
 * in packaged builds; in development it returns an `unsupported` state.
 *
 * @param {Object} [options]
 * @param {Function} [options.onNotify] - Optional notification callback `(title, body, level)`.
 * @returns {Object} Current update state after initialization.
 */
function initAutoUpdater({ onNotify } = {}) {
  if (initialized) return state;
  if (!autoUpdater || !app.isPackaged) {
    setState({ status: 'unsupported', message: 'Updates are available in packaged builds only.', messageKey: 'settings.updates.onlyPackaged' });
    return state;
  }
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  onStatus('checking-for-update', () => {
    setState({ status: 'checking', message: 'Checking for updates...', messageKey: 'settings.updates.checking', error: null });
  });
  onStatus('update-not-available', () => {
    setState({ status: 'idle', message: 'You are on the latest version.', messageKey: 'settings.updates.upToDate', error: null });
  });
  onStatus('update-available', (info) => {
    setState({
      status: 'available',
      message: `Update ${info.version} is downloading...`,
      messageKey: 'settings.updates.downloading',
      version: info.version,
      error: null
    });
    if (onNotify) onNotify('Update available', `Downloading Soterios ${info.version}...`, 'info');
  });
  onStatus('download-progress', (progress) => {
    setState({
      status: 'downloading',
      message: `Downloading update (${Math.round(progress.percent)}%)...`,
      messageKey: 'settings.updates.downloadingProgress',
      progress,
      error: null
    });
  });
  onStatus('update-downloaded', (info) => {
    setState({
      status: 'ready',
      message: `Update ${info.version} is ready to install.`,
      messageKey: 'settings.updates.ready',
      version: info.version,
      error: null
    });
    if (onNotify) onNotify('Update ready', 'Restart Soterios to install the update.', 'success');
  });
  onStatus('error', (err) => {
    logger.warn('Auto-updater error', { error: err.message || String(err) });
    setState({ status: 'error', message: err.message || String(err), error: err.message || String(err) });
  });

  return state;
}

/**
 * Trigger an immediate update check.
 *
 * Only operates in packaged builds. Returns the current state, which will
 * reflect any error encountered during the check.
 *
 * @returns {Promise<Object>} Current update state after the check attempt.
 */
async function checkForUpdates() {
  if (!autoUpdater || !app.isPackaged) {
    return { ...state, status: 'unsupported', message: 'Updates are available in packaged builds only.', messageKey: 'settings.updates.onlyPackaged' };
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({ status: 'error', message: err.message || String(err), error: err.message || String(err) });
  }
  return { ...state };
}

/**
 * Quit and install the downloaded update.
 * @returns {Promise<{success:boolean, error?:string}>}
 */
function quitAndInstall() {
  if (!autoUpdater || state.status !== 'ready') {
    return { success: false, error: 'No downloaded update is ready to install.' };
  }
  autoUpdater.quitAndInstall();
  return { success: true };
}

/**
 * Get the current update status.
 * @returns {Object}
 */
function getUpdateStatus() {
  return { ...state };
}

  /**
   * Subscribe to updater status changes.
   * @param {Function} listener
   * @returns {Function} Unsubscribe function.
   */
  function subscribe(listener) {
    setState._listeners.add(listener);
    return () => setState._listeners.delete(listener);
  }

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  quitAndInstall,
  getUpdateStatus,
  subscribe
};
