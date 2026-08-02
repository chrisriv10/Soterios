const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { requestText } = require('../ipc/_shared');
const { validateArgs } = require('./validate');
const { InvalidInputError, AppError } = require('../../utils/errors');
const {
  isPathInScanReportsDir,
} = require('../../security/reportExport');

const VALID_FIREWALL_PROFILES = ['Domain', 'Private', 'Public'];

function isValidFirewallProfile(name) {
  return typeof name === 'string' && VALID_FIREWALL_PROFILES.includes(name);
}

function isValidIp(ip) {
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const v6 = /^[0-9a-fA-F:]+$/;
  return v4.test(ip) || (v6.test(ip) && ip.includes(':'));
}

function register(mainWindow, { db, firewallManager }) {
  ipcMain.handle('firewall:status', async () => {
    return firewallManager.getStatus();
  });

  ipcMain.handle('firewall:rules', async () => {
    return firewallManager.getRules();
  });

  ipcMain.handle('firewall:listRules', async () => {
    return firewallManager.listRules();
  });

  ipcMain.handle('firewall:createRule', async (_event, spec) => {
    validateArgs([
      { name: 'spec', type: 'object', required: true },
    ], [spec]);
    return firewallManager.createRule(spec);
  });

  ipcMain.handle('firewall:deleteRule', async (_event, name) => {
    validateArgs([
      { name: 'name', type: 'string', required: true, max: 256 },
    ], [name]);
    return firewallManager.deleteRule(name);
  });

  ipcMain.handle('firewall:setRuleEnabled', async (_event, { name, enabled }) => {
    return firewallManager.setRuleEnabled(name, enabled);
  });

  ipcMain.handle('firewall:setProfileEnabled', async (_event, { profile, enabled }) => {
    if (!isValidFirewallProfile(profile)) throw new InvalidInputError(`Invalid firewall profile: ${profile}`);
    return firewallManager.setProfileEnabled(profile, !!enabled);
  });

  ipcMain.handle('firewall:exportRules', async () => {
    const data = await firewallManager.exportRules();
    const result = await dialog.showSaveDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
      title: 'Export Soterios firewall rules',
      defaultPath: 'soterios-firewall-rules.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, path: result.filePath, count: data.rules.length };
  });

  ipcMain.handle('firewall:importRules', async (_event, options = {}) => {
    const onConflict = ['skip', 'overwrite', 'rename'].includes(options && options.onConflict)
      ? options.onConflict
      : 'skip';
    const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow(), {
      title: 'Import Soterios firewall rules',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const filePath = result.filePaths[0];
    const stat = await fs.promises.stat(filePath);
    const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
    if (stat.size > MAX_IMPORT_BYTES) {
      throw new InvalidInputError('Import file is too large (limit 2 MB).');
    }
    let payload;
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      payload = JSON.parse(raw);
    } catch (e) {
      throw new InvalidInputError('Could not parse import file as JSON.');
    }
    const summary = await firewallManager.importRules(payload, { onConflict });
    return { ...summary, path: filePath };
  });

  const TRUSTED_IPS_KEY = 'firewall.trustedIps';

  ipcMain.handle('firewall:getTrusted', () => {
    return db.getSetting(TRUSTED_IPS_KEY, []);
  });

  ipcMain.handle('firewall:trustConnection', (_event, ip) => {
    if (!ip || !isValidIp(ip)) throw new InvalidInputError('Invalid address.');
    const current = db.getSetting(TRUSTED_IPS_KEY, []);
    if (!current.includes(ip)) current.push(ip);
    db.setSetting(TRUSTED_IPS_KEY, current);
    return current;
  });

  ipcMain.handle('firewall:untrustConnection', (_event, ip) => {
    const current = (db.getSetting(TRUSTED_IPS_KEY, []) || []).filter((x) => x !== ip);
    db.setSetting(TRUSTED_IPS_KEY, current);
    return current;
  });

  // -- WHOIS lookup (no API key required) --
  ipcMain.handle('network:whois', async (_event, ip) => {
    if (!ip || !isValidIp(ip)) throw new InvalidInputError('Invalid address.');
    const res = await requestText(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (res.statusCode !== 200) throw new AppError(`WHOIS lookup failed (${res.statusCode}).`);
    const data = JSON.parse(res.body || '{}');
    if (data.success === false) return { found: false };
    return {
      found: true,
      ip: data.ip,
      country: data.country,
      region: data.region,
      city: data.city,
      org: (data.connection && data.connection.org) || data.org || null,
      isp: (data.connection && data.connection.isp) || null,
      asn: (data.connection && data.connection.asn) || null,
    };
  });
}

module.exports = { register };
