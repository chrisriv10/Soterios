'use strict';

const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

// These are Windows' own built-in power scheme GUIDs -- stable identifiers
// shipped with every Windows install, not anything we invent or generate.
// Switching between them via powercfg.exe /setactive is exactly what the
// stock "Power Options" control panel does; we're just surfacing it with
// clearer, task-oriented labels and a one-click UI.
const MODES = {
  balanced: {
    id: 'balanced',
    guid: '381b4222-f694-41f0-9685-ff5bb260df2e', // Windows "Balanced"
    nameKey: 'settings.performanceMode.balanced.name',
    descKey: 'settings.performanceMode.balanced.desc'
  },
  gaming: {
    id: 'gaming',
    guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', // Windows "High performance"
    nameKey: 'settings.performanceMode.gaming.name',
    descKey: 'settings.performanceMode.gaming.desc'
  },
  quiet: {
    id: 'quiet',
    guid: 'a1841308-3541-4fab-bc81-f71556f20b4a', // Windows "Power saver"
    nameKey: 'settings.performanceMode.quiet.name',
    descKey: 'settings.performanceMode.quiet.desc'
  }
};

// Display order for the settings-page card grid.
const MODE_LIST = [MODES.balanced, MODES.gaming, MODES.quiet];

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function guidToModeId(guid) {
  const normalized = String(guid || '').trim().toLowerCase();
  const match = MODE_LIST.find((m) => m.guid === normalized);
  return match ? match.id : null;
}

// Asks Windows which power plan is actually active right now, rather than
// trusting a locally-stored value -- the plan can be changed outside the
// app (Control Panel, another tool, a laptop OEM utility), so this stays
// the source of truth instead of drifting from reality.
async function getActiveMode(execImpl = execFilePromise) {
  try {
    const { stdout } = await execImpl('powercfg.exe', ['/getactivescheme']);
    const match = GUID_RE.exec(stdout || '');
    const guid = match ? match[0].toLowerCase() : null;
    return { ok: true, modeId: guid ? guidToModeId(guid) : null, guid };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function setMode(modeId, execImpl = execFilePromise) {
  const mode = MODES[modeId];
  if (!mode) return { ok: false, error: 'Unknown optimization mode.' };
  try {
    await execImpl('powercfg.exe', ['/setactive', mode.guid]);
    return { ok: true, modeId: mode.id };
  } catch (err) {
    return { ok: false, error: err.message || 'Failed to switch power plan. This feature requires Windows.' };
  }
}

module.exports = { MODES, MODE_LIST, getActiveMode, setMode, guidToModeId };