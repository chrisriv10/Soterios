'use strict';

const path = require('path');
const fs = require('fs');

const BLOCKED_SYSTEM32_HOSTS = new Set([
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'wscript.exe',
  'cscript.exe',
  'mshta.exe',
  'regsvr32.exe',
  'certutil.exe',
  'bitsadmin.exe',
  'ftp.exe'
]);

function isArgToken(token) {
  return token.startsWith('/') || token.startsWith('-');
}

function parseUninstallCommand(uninstallString) {
  const trimmed = String(uninstallString || '').replace(/[\r\n]+/g, ' ').trim();
  if (!trimmed) return null;

  const quoted = trimmed.match(/^"([^"]+)"/);
  if (quoted) {
    const exe = quoted[1];
    const rest = trimmed.slice(quoted[0].length).trim();
    return { exe, args: rest ? rest.split(/\s+/).filter(Boolean) : [] };
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  let end = 1;
  while (end < parts.length && !isArgToken(parts[end])) {
    end += 1;
    const candidate = parts.slice(0, end).join(' ');
    if (/\.(exe|msi|bat|cmd)$/i.test(candidate)) break;
    try {
      if (fs.existsSync(candidate)) break;
    } catch (_) {}
  }

  return {
    exe: parts.slice(0, end).join(' '),
    args: parts.slice(end)
  };
}

function system32Path(fileName) {
  const windir = process.env.WINDIR || 'C:\\Windows';
  return path.win32.resolve(path.win32.join(windir, 'System32', fileName));
}

function isSystem32Binary(exePath, expectedName) {
  const expected = system32Path(expectedName).toLowerCase();
  const resolved = path.win32.resolve(exePath).toLowerCase();
  return resolved === expected;
}

function normalizeExePath(exe) {
  const base = path.win32.basename(exe);
  const bareName = base.toLowerCase();
  if (!/[\\/]/.test(exe) || exe.toLowerCase() === bareName) {
    if (bareName === 'msiexec.exe' || bareName === 'rundll32.exe') {
      return system32Path(base);
    }
  }
  return exe;
}

function trustedInstallRoots() {
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const roots = [
    programFiles,
    process.env['ProgramFiles(x86)'],
    localAppData ? path.win32.join(localAppData, 'Programs') : null
  ].filter(Boolean);
  return roots.map((root) => path.win32.resolve(root).toLowerCase() + '\\');
}

function isUnderSystem32(exePath) {
  const system32Root = path.win32.resolve(
    path.win32.join(process.env.WINDIR || 'C:\\Windows', 'System32')
  ).toLowerCase() + '\\';
  return path.win32.resolve(exePath).toLowerCase().startsWith(system32Root);
}

function isUnderTrustedInstallRoot(targetPath) {
  const resolved = path.win32.resolve(targetPath).toLowerCase() + '\\';
  return trustedInstallRoots().some((root) => resolved.startsWith(root));
}

function normalizeParsedCommand(parsed) {
  if (!parsed) return parsed;
  return {
    exe: normalizeExePath(parsed.exe),
    args: Array.isArray(parsed.args) ? [...parsed.args] : []
  };
}

function validateUninstallLaunch(parsed) {
  if (!parsed || !parsed.exe) {
    return { ok: false, error: 'Missing or invalid uninstall command.' };
  }

  const normalized = normalizeParsedCommand(parsed);
  const exeName = path.win32.basename(normalized.exe).toLowerCase();
  const argsLower = normalized.args.map((arg) => arg.toLowerCase());

  if (BLOCKED_SYSTEM32_HOSTS.has(exeName)) {
    return { ok: false, error: 'Shell-based uninstall launchers are not allowed.' };
  }

  if (exeName === 'msiexec.exe') {
    if (!isSystem32Binary(normalized.exe, 'msiexec.exe')) {
      return { ok: false, error: 'msiexec must be launched from Windows System32.' };
    }
    if (argsLower.includes('/i')) {
      return { ok: false, error: 'msiexec install (/i) is not allowed from uninstall.' };
    }
    const hasUninstallFlag = argsLower.some((arg) => arg === '/x' || arg.startsWith('/x') || arg === '/uninstall');
    if (!hasUninstallFlag) {
      return { ok: false, error: 'msiexec uninstall must include /x or /uninstall.' };
    }
    return { ok: true, parsed: normalized };
  }

  if (exeName === 'rundll32.exe') {
    if (!isSystem32Binary(normalized.exe, 'rundll32.exe')) {
      return { ok: false, error: 'rundll32 must be launched from Windows System32.' };
    }
    if (!normalized.args.length) {
      return { ok: false, error: 'rundll32 uninstall requires a DLL path argument.' };
    }
    const dllArg = normalized.args[0].replace(/^"|"$/g, '');
    const dllPath = dllArg.split(',')[0];
    if (!/\.dll$/i.test(dllPath)) {
      return { ok: false, error: 'rundll32 uninstall DLL path is invalid.' };
    }
    if (!isUnderTrustedInstallRoot(dllPath)) {
      return { ok: false, error: 'rundll32 DLL path is not allowed.' };
    }
    try {
      if (!fs.existsSync(dllPath)) {
        return { ok: false, error: 'rundll32 DLL not found.' };
      }
    } catch (_) {
      return { ok: false, error: 'Unable to verify rundll32 DLL.' };
    }
    return { ok: true, parsed: normalized };
  }

  if (isUnderSystem32(normalized.exe)) {
    return { ok: false, error: 'System32 executables are not allowed for uninstall launch.' };
  }

  if (!isUnderTrustedInstallRoot(normalized.exe)) {
    return { ok: false, error: 'Uninstall executable path is not allowed.' };
  }

  try {
    if (!fs.existsSync(normalized.exe)) {
      return { ok: false, error: 'Uninstall executable not found.' };
    }
  } catch (_) {
    return { ok: false, error: 'Unable to verify uninstall executable.' };
  }

  return { ok: true, parsed: normalized };
}

module.exports = {
  parseUninstallCommand,
  isSystem32Binary,
  isUnderTrustedInstallRoot,
  normalizeParsedCommand,
  validateUninstallLaunch
};
