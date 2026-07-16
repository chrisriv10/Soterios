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

function setState(patch) {
  Object.assign(state, patch);
  for (const listener of setState._listeners) {
    try { listener({ ...state }); } catch (_) {}
  }
}
setState._listeners = new Set();

function onStatus(channel, handler) {
  if (!autoUpdater) return;
  autoUpdater.on(channel, handler);
}

function initAutoUpdater({ onNotify } = {}) {
  if (initialized) return state;
  if (!autoUpdater || !app.isPackaged) {
    setState({ status: 'unsupported', message: 'Updates are available in packaged builds only.' });
    return state;
  }
  initialized = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  onStatus('checking-for-update', () => {
    setState({ status: 'checking', message: 'Checking for updates...', error: null });
  });
  onStatus('update-not-available', () => {
    setState({ status: 'idle', message: 'You are on the latest version.', error: null });
  });
  onStatus('update-available', (info) => {
    setState({
      status: 'available',
      message: `Update ${info.version} is downloading...`,
      version: info.version,
      error: null
    });
    if (onNotify) onNotify('Update available', `Downloading Soterios ${info.version}...`, 'info');
  });
  onStatus('download-progress', (progress) => {
    setState({
      status: 'downloading',
      message: `Downloading update (${Math.round(progress.percent)}%)...`,
      progress,
      error: null
    });
  });
  onStatus('update-downloaded', (info) => {
    setState({
      status: 'ready',
      message: `Update ${info.version} is ready to install.`,
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

async function checkForUpdates() {
  if (!autoUpdater || !app.isPackaged) {
    return { ...state, status: 'unsupported', message: 'Updates are available in packaged builds only.' };
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState({ status: 'error', message: err.message || String(err), error: err.message || String(err) });
  }
  return { ...state };
}

function quitAndInstall() {
  if (!autoUpdater || state.status !== 'ready') {
    return { success: false, error: 'No downloaded update is ready to install.' };
  }
  autoUpdater.quitAndInstall();
  return { success: true };
}

function getUpdateStatus() {
  return { ...state };
}

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
