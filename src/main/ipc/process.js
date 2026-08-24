'use strict';

const { ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { validateProcessKey } = require('../processService');

const MAX_QUERY_LENGTH = 200;
const MAX_SECTIONS = 9;

function asObject(value, label = 'request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function validQuery(value) {
  if (typeof value !== 'string') throw new Error('Invalid search query.');
  const query = value.trim();
  if (!query || query.length > MAX_QUERY_LENGTH || /[\r\n\0]/.test(query)) throw new Error('Invalid search query.');
  return query;
}

function register(mainWindow, { processService, processInspector, processReputation }) {
  const service = processService || processInspector;
  if (!service) throw new Error('ProcessService is required.');

  // Compatibility endpoints for network/firewall consumers during migration.
  ipcMain.handle('process:list', () => service.getProcesses());
  ipcMain.handle('process:kill', (_event, pidOrKey) => service.killProcess(pidOrKey));

  ipcMain.handle('process:subscription:start', async (event, options) => {
    const request = options == null ? {} : asObject(options, 'subscription request');
    return service.startSubscription(event.sender, { intervalMs: request.intervalMs });
  });

  ipcMain.handle('process:subscription:stop', (event) => service.stopSubscription(event.sender));
  ipcMain.handle('process:snapshot', () => service.getSnapshot());
  ipcMain.handle('process:status', () => service.getStatus());

  ipcMain.handle('process:details', (_event, processKey, sections) => {
    const key = validateProcessKey(processKey);
    const safeSections = Array.isArray(sections)
      ? sections.filter((item) => typeof item === 'string' && item.length <= 32).slice(0, MAX_SECTIONS)
      : [];
    return service.getDetails(key, safeSections);
  });

  ipcMain.handle('process:action', (_event, payload) => {
    const request = asObject(payload, 'process action');
    validateProcessKey(request.processKey || request.key);
    if (typeof request.action !== 'string' || request.action.length > 32) throw new Error('Invalid process action.');
    if (request.options != null) asObject(request.options, 'action options');
    return service.performAction(request);
  });

  ipcMain.handle('process:runTask', (_event, taskSpec) => service.runTask(asObject(taskSpec, 'task request')));
  ipcMain.handle('process:showProperties', (_event, filePath) => service.showProperties(filePath));

  ipcMain.handle('process:reputation:status', () => processReputation?.status() || { enabled: false, unavailable: true });
  ipcMain.handle('process:reputation:configure', (_event, apiKey, consent) => {
    if (!processReputation) throw new Error('Process reputation is unavailable.');
    return processReputation.configure(apiKey, consent);
  });
  ipcMain.handle('process:reputation:clear', () => processReputation?.clear() || { enabled: false });
  ipcMain.handle('process:reputation:check', (_event, processKey) => {
    if (!processReputation) throw new Error('Process reputation is unavailable.');
    return processReputation.check(validateProcessKey(processKey));
  });

  ipcMain.handle('process:searchOnline', async (_event, value) => {
    const query = validQuery(value);
    await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    return { success: true };
  });

  ipcMain.handle('process:trace:save', async (_event, options) => {
    const request = asObject(options, 'trace request');
    const portable = request.mode === 'portable';
    const extension = portable ? 'json' : 'soterios-trace';
    const save = await dialog.showSaveDialog(mainWindow, {
      title: portable ? 'Export redacted process trace' : 'Save encrypted process trace',
      defaultPath: `Soterios-process-trace.${extension}`,
      filters: portable
        ? [{ name: 'JSON trace', extensions: ['json'] }]
        : [{ name: 'Encrypted Soterios trace', extensions: ['soterios-trace'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (save.canceled || !save.filePath) return { success: false, canceled: true };
    return service.saveTrace({
      mode: portable ? 'portable' : 'encrypted',
      redaction: ['none', 'standard', 'strict'].includes(request.redaction) ? request.redaction : (portable ? 'strict' : 'standard'),
      passphrase: request.passphrase,
      filePath: save.filePath,
    });
  });

  ipcMain.handle('process:diagnostics:save', async () => {
    const save = await dialog.showSaveDialog(mainWindow, {
      title: 'Export sanitized Process Inspector diagnostics',
      defaultPath: 'Soterios-process-diagnostics.json',
      filters: [{ name: 'JSON diagnostics', extensions: ['json'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (save.canceled || !save.filePath) return { success: false, canceled: true };
    return service.saveDiagnosticBundle(save.filePath);
  });
}

module.exports = { register };
