'use strict';

// Soterios Environment Doctor.
//
// Read-only diagnostic command: `npm run doctor` (node tools/doctor.js).
//
// Inspects the local environment, performs safe Soterios-specific validation,
// prints a concise diagnostic report, and exits 0 when no check failed (1
// otherwise). The doctor never modifies the system: it does not download
// anything, build anything, install packages, touch the registry/firewall/
// services, scan user data, or make network requests. The only writes it ever
// performs are a uniquely-named throwaway file inside the OS temp directory
// (Temp storage check) which is always removed again.
//
// Design: every check is an independent `async function checkX(context)`
// returning `{ id, name, status, summary, remediation, details }` with status
// in pass|warn|fail|skip. All environment access (platform, fs, process
// spawning, env vars, repo root) flows through the injected `context` object
// so tests can supply fakes instead of depending on the developer machine.
//
// Reused validation logic:
// - ClamAV completeness reuses REQUIRED_BINARIES, hasCompleteInstall, and
//   validateInstall from tools/download-clamav.js (lazy require with a safe
//   fallback so the doctor also runs before `npm ci`).
// - ClamAV bootstrap expectations reuse downloadSkipReason, envFlagEnabled,
//   SKIP_ENV_VAR, and FORCE_ENV_VAR from the same module, so a missing
//   installation on a platform where the bootstrap skips itself is reported
//   accurately instead of as a broken install.
// - Native helper layout (build/native/*.exe + checksums.json) mirrors
//   tools/build-process-helper.js; integrity comparison mirrors the check in
//   src/main/nativeProcessClient.js (read-only, the helper is never launched).
// - Extension structural rules mirror a subset of tools/validate-extension.mjs,
//   which is not import-safe (top-level await executes on import), so the
//   small subset needed here is reimplemented read-only. The canonical
//   validator remains authoritative; see validateExtensionManifest below.
// - Native host artifact path mirrors tools/build-native-host.mjs output.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const COMMAND_TIMEOUT_MS = 10000;
const FALLBACK_CLAMAV_BINARIES = ['clamscan.exe', 'freshclam.exe'];
const FALLBACK_SKIP_ENV_VAR = 'SOTERIOS_SKIP_CLAMAV';
const FALLBACK_FORCE_ENV_VAR = 'SOTERIOS_FORCE_CLAMAV';
const PROCESS_HELPER_NAME = 'soterios-process-inspector.exe';
const NATIVE_HOST_NAME = 'SoteriosNativeHost.exe';
const EXTENSION_ALLOWED_PERMISSIONS = new Set(['storage', 'alarms', 'activeTab', 'scripting']);
const CLAMAV_DEFINITION_NAMES = [
  'main.cvd',
  'daily.cvd',
  'bytecode.cvd',
  'main.cld',
  'daily.cld',
  'bytecode.cld',
];
const GENERATED_PATH_PREFIXES = ['dist/', 'build/', 'browser-extension/dist/', '.cache/'];

function makeResult(id, name, status, summary, remediation = null, details = null) {
  return { id, name, status, summary, remediation, details };
}

// ---------------------------------------------------------------------------
// Context / dependency injection
// ---------------------------------------------------------------------------

function defaultRunCommand(file, args, options = {}) {
  const timeoutMs = options.timeoutMs || COMMAND_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024, shell: false },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

function createContext(overrides = {}) {
  return {
    repoRoot: overrides.repoRoot || path.resolve(__dirname, '..'),
    platform: overrides.platform !== undefined ? overrides.platform : process.platform,
    arch: overrides.arch !== undefined ? overrides.arch : process.arch,
    nodeVersion: overrides.nodeVersion !== undefined ? overrides.nodeVersion : process.version,
    env: overrides.env || process.env,
    fs: overrides.fs || fs,
    path: overrides.path || path,
    os: overrides.os || os,
    crypto: overrides.crypto || crypto,
    runCommand: overrides.runCommand || defaultRunCommand,
    // clamav helper override for tests. `undefined` (default) means "lazy-load
    // tools/download-clamav.js with a safe fallback". `null` means "skip the
    // require and use built-in defaults". An object means "use as given".
    clamav: overrides.clamav !== undefined ? overrides.clamav : undefined,
  };
}

// ---------------------------------------------------------------------------
// Privacy: never print usernames, home dirs, AppData paths, or repo roots.
// ---------------------------------------------------------------------------

function sanitizeForOutput(value, context) {
  let out = String(value === null || value === undefined ? '' : value);
  const replacements = [];
  const push = (raw, label) => {
    if (typeof raw === 'string' && raw.length > 1) replacements.push([raw, label]);
  };
  try {
    push(context.os.homedir(), '<home>');
  } catch (_) {
    // homedir() may throw; fall back to pattern redaction below.
  }
  push(context.repoRoot, '<repo>');
  if (context.env) {
    push(context.env.APPDATA, '<app-data>');
    push(context.env.SOTERIOS_USERDATA, '<app-data>');
    push(context.env.USERPROFILE, '<home>');
    push(context.env.HOME, '<home>');
    push(context.env.XDG_CONFIG_HOME, '<config>');
  }
  try {
    push(context.os.tmpdir(), '<temp>');
  } catch (_) {
    // ignore
  }
  replacements.sort((a, b) => b[0].length - a[0].length);
  for (const [raw, label] of replacements) {
    out = out.split(raw).join(label);
  }
  // Catch user-profile paths that were not covered above (e.g. another user's
  // path embedded in an error message).
  out = out.replace(/[A-Za-z]:\\Users\\[^\\/:*?"<>|\s]+/g, 'C:\\Users\\<user>');
  out = out.replace(/\/home\/[^/\s:]+/g, '/home/<user>');
  return out;
}

function sanitizeResult(result, context) {
  return {
    id: result.id,
    name: result.name,
    status: result.status,
    summary: sanitizeForOutput(result.summary, context),
    remediation: result.remediation ? sanitizeForOutput(result.remediation, context) : null,
    details: result.details ? sanitizeForOutput(result.details, context) : null,
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function joinRoot(context, ...parts) {
  return context.path.join(context.repoRoot, ...parts);
}

function existsFile(context, absolutePath) {
  try {
    const stat = context.fs.statSync(absolutePath);
    return Boolean(stat && typeof stat.isFile === 'function' && stat.isFile());
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

function existsPath(context, absolutePath) {
  try {
    return context.fs.existsSync(absolutePath);
  } catch (_) {
    return false;
  }
}

function readTextFile(context, absolutePath) {
  return context.fs.readFileSync(absolutePath, 'utf8');
}

function readJsonFile(context, absolutePath) {
  return JSON.parse(readTextFile(context, absolutePath));
}

function parseMajor(value) {
  const match = String(value === null || value === undefined ? '' : value)
    .trim()
    .match(/^v?(\d+)(?:\.\d+)*/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(major) ? major : null;
}

function parseEnginesMajor(range) {
  // Handles the range shapes used in package.json engines fields, e.g.
  // ">=26", ">=26.0.0", "^26", "26".
  const match = String(range === null || range === undefined ? '' : range)
    .trim()
    .match(/(?:^|[^\d])(\d+)(?:\.\d+)*(?:\s*\|\||\s*$)/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(major) ? major : null;
}

function platformLabel(platform) {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return String(platform);
}

function isMissingExecutableError(err) {
  return Boolean(err) && (err.code === 'ENOENT' || /ENOENT/i.test(String((err && err.message) || '')));
}

function isTimeoutError(err) {
  if (!err) return false;
  if (err.killed) return true;
  if (err.code === 'ETIMEDOUT') return true;
  return /timed out/i.test(String(err.message || ''));
}

// Lazy reuse of the ClamAV completeness logic from tools/download-clamav.js.
// Falls back to built-in defaults when the module (or its axios dependency)
// is unavailable, e.g. before `npm ci` has been run. Test contexts inject a
// `clamav` object with the same shape instead of touching the real module.
function fallbackClamavHelper() {
  return {
    requiredBinaries: FALLBACK_CLAMAV_BINARIES.slice(),
    validateInstall: null,
    hasCompleteInstall: null,
    downloadSkipReason: null,
    envFlagEnabled: null,
    skipEnvVar: FALLBACK_SKIP_ENV_VAR,
    forceEnvVar: FALLBACK_FORCE_ENV_VAR,
  };
}

function getClamavHelper(context) {
  if (context.clamav !== undefined) {
    const override = context.clamav || {};
    return {
      requiredBinaries: override.requiredBinaries || FALLBACK_CLAMAV_BINARIES.slice(),
      validateInstall: override.validateInstall || null,
      hasCompleteInstall: override.hasCompleteInstall || null,
      downloadSkipReason: override.downloadSkipReason || null,
      envFlagEnabled: override.envFlagEnabled || null,
      skipEnvVar: override.skipEnvVar || FALLBACK_SKIP_ENV_VAR,
      forceEnvVar: override.forceEnvVar || FALLBACK_FORCE_ENV_VAR,
    };
  }
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const downloadClamav = require('./download-clamav');
    return {
      requiredBinaries: downloadClamav.REQUIRED_BINARIES || FALLBACK_CLAMAV_BINARIES.slice(),
      validateInstall: downloadClamav.validateInstall || null,
      hasCompleteInstall: downloadClamav.hasCompleteInstall || null,
      downloadSkipReason: downloadClamav.downloadSkipReason || null,
      envFlagEnabled: downloadClamav.envFlagEnabled || null,
      skipEnvVar: downloadClamav.SKIP_ENV_VAR || FALLBACK_SKIP_ENV_VAR,
      forceEnvVar: downloadClamav.FORCE_ENV_VAR || FALLBACK_FORCE_ENV_VAR,
    };
  } catch (_) {
    return fallbackClamavHelper();
  }
}

function clamavBinaryState(context, dir, binary) {
  // Returns 'present' | 'missing'. Throws on unexpected filesystem errors so
  // the caller can report a validation error instead of a wrong verdict.
  const binaryPath = context.path.join(dir, binary);
  let stat = null;
  try {
    stat = context.fs.lstatSync(binaryPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return 'missing';
    throw err;
  }
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return 'missing';
  return 'present';
}

function clamavHasDefinitions(context, dir) {
  const dbDir = context.path.join(dir, 'database');
  for (const name of CLAMAV_DEFINITION_NAMES) {
    try {
      if (existsFile(context, context.path.join(dbDir, name))) return true;
    } catch (_) {
      return false;
    }
  }
  return false;
}

function sha256OfFile(context, absolutePath) {
  const data = context.fs.readFileSync(absolutePath);
  return context.crypto.createHash('sha256').update(data).digest('hex');
}

// Lightweight diagnostic subset of the extension rules enforced by
// tools/validate-extension.mjs (the canonical gate, runnable via
// `npm run extension:validate`).
//
// Intentionally NOT equivalent to the canonical validator: it covers only the
// structural properties that indicate whether a usable build exists
// (manifest shape, permission allow-list, self-only script CSP, declared
// service worker and icon files on disk). It performs no network or
// telemetry-content judgments and must never be treated as a production
// security decision — a PASS here does not certify the extension, and rule
// changes belong in the canonical validator first (mirror them here only to
// keep the diagnostic fail-closed, never to weaken it).
function validateExtensionManifest(manifest) {
  const violations = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest is not a JSON object'];
  }
  if (manifest.manifest_version !== 3) violations.push('manifest_version must be 3');
  if (manifest.content_scripts) violations.push('static content_scripts are forbidden');
  for (const permission of manifest.permissions || []) {
    if (!EXTENSION_ALLOWED_PERMISSIONS.has(permission)) {
      violations.push(`unexpected required permission: ${permission}`);
    }
  }
  const csp =
    manifest.content_security_policy && manifest.content_security_policy.extension_pages;
  if (typeof csp !== 'string' || !csp.includes("script-src 'self'")) {
    violations.push('explicit self-only script CSP is required');
  }
  const expectedWebAccessible = JSON.stringify([
    { resources: ['icons/icon32.png'], matches: ['http://*/*', 'https://*/*'] },
  ]);
  if (JSON.stringify(manifest.web_accessible_resources) !== expectedWebAccessible) {
    violations.push('only the field-button icon may be web-accessible');
  }
  if (
    !manifest.background ||
    typeof manifest.background.service_worker !== 'string' ||
    !manifest.background.service_worker
  ) {
    violations.push('background service worker is not declared');
  }
  return violations;
}

function referencedScriptFiles(scripts) {
  // Extracts `node <relative-file>` targets from npm script commands so the
  // configuration check can verify they exist. Skips flags, globs,
  // interpolations, bare package names, and generated-output paths.
  const found = [];
  for (const [name, command] of Object.entries(scripts || {})) {
    if (typeof command !== 'string') continue;
    const pattern = /\bnode\s+([^\s&|;'"()]+)/g;
    let match = null;
    while ((match = pattern.exec(command)) !== null) {
      const target = match[1];
      if (!target || target.startsWith('-')) continue;
      if (target.includes('*') || target.includes('$') || target.includes('{')) continue;
      if (/^(node_modules|electron|jest)[\\/]/.test(target)) continue;
      const normalized = target.split('\\').join('/');
      if (
        !/\.(c?m?js|ts)$/.test(normalized) &&
        !normalized.startsWith('tools/') &&
        !normalized.startsWith('tests/') &&
        !normalized.startsWith('src/') &&
        !normalized.startsWith('./') &&
        !normalized.startsWith('../')
      ) {
        continue;
      }
      if (GENERATED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) continue;
      found.push({ script: name, target: normalized });
    }
  }
  return found;
}

function resolveAppDataDir(context) {
  const env = context.env || {};
  if (env.SOTERIOS_USERDATA) return env.SOTERIOS_USERDATA;
  let home = null;
  try {
    home = context.os.homedir();
  } catch (_) {
    home = null;
  }
  if (context.platform === 'win32') {
    const base = env.APPDATA || (home ? context.path.join(home, 'AppData', 'Roaming') : null);
    return base ? context.path.join(base, 'Soterios') : null;
  }
  if (context.platform === 'darwin') {
    return home ? context.path.join(home, 'Library', 'Application Support', 'Soterios') : null;
  }
  const base = env.XDG_CONFIG_HOME || (home ? context.path.join(home, '.config') : null);
  return base ? context.path.join(base, 'Soterios') : null;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkNodeVersion(context) {
  const id = 'node-version';
  const name = 'Node.js';
  let pkg = null;
  try {
    pkg = readJsonFile(context, joinRoot(context, 'package.json'));
  } catch (_) {
    pkg = null;
  }
  if (!pkg) {
    return makeResult(id, name, 'fail', 'package.json is missing or unreadable');
  }
  const requiredMajor = parseEnginesMajor(pkg.engines && pkg.engines.node);
  if (requiredMajor === null) {
    return makeResult(
      id,
      name,
      'warn',
      'Node.js requirement is not declared in package.json engines',
      'Declare the supported Node.js range in package.json engines'
    );
  }
  const currentMajor = parseMajor(context.nodeVersion);
  const currentLabel = String(context.nodeVersion || 'unknown');
  if (currentMajor === null) {
    return makeResult(
      id,
      name,
      'fail',
      `unrecognized Node.js version (${currentLabel})`,
      'Install a supported Node.js release (see CONTRIBUTING.md)'
    );
  }
  if (currentMajor < requiredMajor) {
    return makeResult(
      id,
      name,
      'fail',
      `${currentLabel} does not satisfy >=${requiredMajor}`,
      `Install Node.js ${requiredMajor} or newer (see CONTRIBUTING.md)`
    );
  }
  let nvmrcMajor = null;
  let nvmrcRaw = null;
  try {
    nvmrcRaw = readTextFile(context, joinRoot(context, '.nvmrc'));
    nvmrcMajor = parseMajor(nvmrcRaw);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      return makeResult(
        id,
        name,
        'warn',
        `${currentLabel} satisfies >=${requiredMajor}, but .nvmrc could not be read`,
        'Ensure .nvmrc agrees with package.json engines'
      );
    }
  }
  if (nvmrcRaw !== null && nvmrcMajor === null) {
    return makeResult(
      id,
      name,
      'warn',
      `${currentLabel} satisfies >=${requiredMajor}, but .nvmrc is not a recognizable version`,
      'Align .nvmrc with package.json engines'
    );
  }
  if (nvmrcMajor !== null && nvmrcMajor !== requiredMajor) {
    return makeResult(
      id,
      name,
      'warn',
      `${currentLabel} satisfies >=${requiredMajor}, but .nvmrc pins ${nvmrcMajor}`,
      'Align .nvmrc with package.json engines'
    );
  }
  return makeResult(id, name, 'pass', `${currentLabel} satisfies >=${requiredMajor}`);
}

async function checkPlatform(context) {
  if (context.platform === 'win32') {
    return makeResult('platform', 'Platform', 'pass', `Windows ${context.arch}`);
  }
  return makeResult(
    'platform',
    'Platform',
    'warn',
    `${platformLabel(context.platform)} ${context.arch}; Soterios runtime features are Windows-targeted`,
    'Use Windows for full runtime validation; Linux/macOS remain usable for docs and tooling'
  );
}

async function checkArch(context) {
  if (context.arch === 'x64') {
    return makeResult('arch', 'Architecture', 'pass', 'x64');
  }
  if (context.arch === 'arm64') {
    return makeResult(
      'arch',
      'Architecture',
      'warn',
      'arm64; bundled native Windows helpers target x64',
      'Use x64 for packaging and native helper builds'
    );
  }
  return makeResult(
    'arch',
    'Architecture',
    'warn',
    `${context.arch}; bundled native Windows helpers target x64`,
    'Use x64 for packaging and native helper builds'
  );
}

async function checkPowerShell(context) {
  const id = 'powershell';
  const name = 'PowerShell';
  if (context.platform !== 'win32') {
    return makeResult(id, name, 'skip', 'Windows-only prerequisite');
  }
  try {
    const { stdout } = await context.runCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
      { timeoutMs: COMMAND_TIMEOUT_MS }
    );
    const version = String(stdout || '')
      .trim()
      .match(/(\d+\.\d[\d.]*)/);
    if (version) {
      return makeResult(id, name, 'pass', `${version[1]} available`);
    }
    return makeResult(id, name, 'warn', 'PowerShell started but its version could not be determined');
  } catch (err) {
    if (isMissingExecutableError(err)) {
      return makeResult(
        id,
        name,
        'fail',
        'powershell.exe could not be started',
        'Use a Windows machine with Windows PowerShell 5.1 available'
      );
    }
    if (isTimeoutError(err)) {
      return makeResult(id, name, 'fail', 'PowerShell version query timed out');
    }
    return makeResult(id, name, 'fail', 'PowerShell version query failed');
  }
}

function isSkipFlagSet(helper, context) {
  const env = context.env || {};
  if (helper.envFlagEnabled) {
    try {
      return helper.envFlagEnabled(env, helper.skipEnvVar) === true;
    } catch (_) {
      return false;
    }
  }
  return ['1', 'true', 'yes'].includes(String(env[helper.skipEnvVar] || '').trim().toLowerCase());
}

async function checkClamAv(context) {
  const id = 'clamav';
  const name = 'ClamAV';
  const helper = getClamavHelper(context);
  const dir = joinRoot(context, 'assets', 'clamav');
  const reinstallHint = 'Run: npm install, or remove assets/clamav and reinstall';
  // Whether the bootstrap itself would skip the download (non-Windows host
  // without the force flag, or an explicit skip flag). Pure and side effect
  // free; only env var names and the platform name appear in it.
  const skipReason = helper.downloadSkipReason
    ? helper.downloadSkipReason(context.env || {}, context.platform)
    : null;

  // Canonical completeness signal first; per-binary probing distinguishes a
  // missing install from a partial one. Note: the canonical
  // hasCompleteInstall reads the real filesystem, which matches context.fs
  // for the default production context; test contexts inject a matching fake.
  let complete = false;
  try {
    if (helper.hasCompleteInstall) {
      complete = helper.hasCompleteInstall(dir) === true;
    } else {
      complete = helper.requiredBinaries.every(
        (binary) => clamavBinaryState(context, dir, binary) === 'present'
      );
    }
    if (complete && helper.validateInstall) {
      helper.validateInstall(dir);
    }
  } catch (err) {
    if (complete) {
      return makeResult(
        id,
        name,
        'fail',
        'bundled installation failed validation',
        reinstallHint,
        err && err.message ? String(err.message) : null
      );
    }
    return makeResult(id, name, 'fail', 'ClamAV installation could not be validated', reinstallHint);
  }

  if (!complete) {
    let missing = [];
    try {
      missing = helper.requiredBinaries.filter(
        (binary) => clamavBinaryState(context, dir, binary) === 'missing'
      );
    } catch (_) {
      return makeResult(id, name, 'fail', 'ClamAV installation could not be validated', reinstallHint);
    }
    if (missing.length < helper.requiredBinaries.length) {
      return makeResult(
        id,
        name,
        'fail',
        `partial installation detected (missing: ${missing.join(', ')})`,
        reinstallHint
      );
    }
    if (skipReason) {
      if (isSkipFlagSet(helper, context)) {
        return makeResult(
          id,
          name,
          'warn',
          `not installed (${skipReason})`,
          `Unset ${helper.skipEnvVar} and run: npm install to download the bundled ClamAV`
        );
      }
      return makeResult(
        id,
        name,
        'warn',
        `not installed (${skipReason})`,
        `Only required for Windows runtime/packaging; set ${helper.forceEnvVar}=1 before npm install to download anyway`
      );
    }
    return makeResult(
      id,
      name,
      'warn',
      'not installed',
      'Run: npm install (postinstall downloads the bundled ClamAV)'
    );
  }
  const definitions = clamavHasDefinitions(context, dir);
  return makeResult(
    id,
    name,
    'pass',
    'bundled installation complete',
    null,
    definitions ? 'virus definitions present' : 'virus definitions not downloaded yet'
  );
}

async function checkClamAvVersion(context) {
  const id = 'clamav-version';
  const name = 'ClamAV version';
  const clamscanPath = joinRoot(context, 'assets', 'clamav', 'clamscan.exe');
  let present = false;
  try {
    present = existsFile(context, clamscanPath);
  } catch (_) {
    return makeResult(id, name, 'warn', 'ClamAV version could not be queried');
  }
  if (!present) {
    return makeResult(id, name, 'skip', 'ClamAV is not installed');
  }
  try {
    const { stdout } = await context.runCommand(clamscanPath, ['--version'], {
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    const match = String(stdout || '').match(/ClamAV\s+([\d.]+)/i);
    if (match) {
      return makeResult(id, name, 'pass', `ClamAV ${match[1]}`);
    }
    return makeResult(id, name, 'warn', 'installed but version output was unrecognized');
  } catch (_) {
    return makeResult(id, name, 'warn', 'installed but version could not be queried');
  }
}

async function checkProcessHelper(context) {
  const id = 'process-helper';
  const name = 'Process helper';
  if (context.platform !== 'win32') {
    return makeResult(id, name, 'skip', 'Windows-only helper');
  }
  const packaged = joinRoot(context, 'build', 'native', PROCESS_HELPER_NAME);
  const devBuild = joinRoot(
    context,
    'native',
    'process-inspector',
    'target',
    'release',
    PROCESS_HELPER_NAME
  );
  const hasPackaged = existsFile(context, packaged);
  if (!hasPackaged) {
    const hasDev = existsFile(context, devBuild);
    return makeResult(
      id,
      name,
      'warn',
      hasDev ? 'development build only; packaged helper has not been built' : 'helper has not been built',
      'Run: npm run native:process'
    );
  }
  const manifestPath = joinRoot(context, 'build', 'native', 'checksums.json');
  let manifest = null;
  try {
    manifest = readJsonFile(context, manifestPath);
  } catch (_) {
    manifest = null;
  }
  const expected =
    manifest && typeof manifest[PROCESS_HELPER_NAME] === 'string'
      ? manifest[PROCESS_HELPER_NAME].toLowerCase()
      : null;
  if (!expected) {
    return makeResult(
      id,
      name,
      'warn',
      'present but integrity metadata is missing',
      'Run: npm run native:process'
    );
  }
  const actual = sha256OfFile(context, packaged).toLowerCase();
  if (actual !== expected) {
    return makeResult(
      id,
      name,
      'fail',
      'checksum mismatch',
      'Run: npm run native:process'
    );
  }
  return makeResult(id, name, 'pass', 'native helper present and verified');
}

async function checkNativeHost(context) {
  const id = 'native-host';
  const name = 'Native host';
  if (context.platform !== 'win32') {
    return makeResult(id, name, 'skip', 'Windows-only artifact');
  }
  const executable = joinRoot(context, 'build', 'native-host', NATIVE_HOST_NAME);
  if (existsFile(context, executable)) {
    return makeResult(id, name, 'pass', `${NATIVE_HOST_NAME} present`);
  }
  return makeResult(id, name, 'warn', 'not built', 'Run: npm run native-host:build');
}

async function checkExtension(context) {
  const id = 'extension';
  const name = 'Extension';
  const distRoot = joinRoot(context, 'browser-extension', 'dist', 'chromium');
  const manifestPath = context.path.join(distRoot, 'manifest.json');
  let manifest = null;
  try {
    if (!existsFile(context, manifestPath)) {
      return makeResult(id, name, 'warn', 'extension has not been built', 'Run: npm run extension:build');
    }
    manifest = readJsonFile(context, manifestPath);
  } catch (_) {
    return makeResult(
      id,
      name,
      'fail',
      'build exists but manifest.json is unreadable',
      'Run: npm run extension:build'
    );
  }
  const violations = validateExtensionManifest(manifest);
  const serviceWorker =
    manifest && manifest.background ? manifest.background.service_worker : null;
  if (typeof serviceWorker === 'string' && serviceWorker) {
    if (!existsFile(context, context.path.join(distRoot, serviceWorker))) {
      violations.push(`${serviceWorker} referenced by the manifest is missing`);
    }
  }
  const icon128 =
    manifest && manifest.icons && manifest.icons['128'] ? manifest.icons['128'] : 'icons/icon128.png';
  if (!existsFile(context, context.path.join(distRoot, icon128))) {
    violations.push(`${icon128} is missing`);
  }
  if (violations.length > 0) {
    return makeResult(
      id,
      name,
      'fail',
      'build exists but validation failed',
      'Run: npm run extension:build',
      violations.join('; ')
    );
  }
  return makeResult(id, name, 'pass', 'Chromium extension build present and valid');
}

function readPackageJson(context) {
  return readJsonFile(context, joinRoot(context, 'package.json'));
}

async function checkRepository(context) {
  const id = 'repository';
  const name = 'Repository';
  let pkg = null;
  try {
    pkg = readPackageJson(context);
  } catch (_) {
    pkg = null;
  }
  if (!pkg) {
    return makeResult(id, name, 'fail', 'package.json is missing or unreadable');
  }
  const required = [
    pkg.main || 'src/main/main.js',
    'preload.js',
    'src/native-host/host.js',
    'native/process-inspector/Cargo.toml',
    'browser-extension/package.json',
  ];
  const missing = required.filter((rel) => !existsPath(context, joinRoot(context, rel)));
  if (missing.length > 0) {
    return makeResult(
      id,
      name,
      'fail',
      `required source file missing: ${missing[0]}`,
      'Restore the missing file from version control',
      missing.length > 1 ? `also missing: ${missing.slice(1).join(', ')}` : null
    );
  }
  const optionalBuildResources = ['assets/icon.ico', 'build/LICENSE.txt'];
  const missingOptional = optionalBuildResources.filter(
    (rel) => !existsPath(context, joinRoot(context, rel))
  );
  if (missingOptional.length > 0) {
    return makeResult(
      id,
      name,
      'warn',
      `packaging resource missing: ${missingOptional[0]}`,
      'Restore the missing file from version control',
      missingOptional.length > 1 ? `also missing: ${missingOptional.slice(1).join(', ')}` : null
    );
  }
  return makeResult(id, name, 'pass', 'required source files present');
}

async function checkConfig(context) {
  const id = 'config';
  const name = 'Configuration';
  let pkg = null;
  try {
    pkg = readPackageJson(context);
  } catch (_) {
    pkg = null;
  }
  if (!pkg) {
    return makeResult(id, name, 'fail', 'package.json is missing or unreadable');
  }
  const failures = [];
  const warnings = [];
  if (!pkg.main || typeof pkg.main !== 'string') {
    failures.push('package.json main is not set');
  } else if (!existsPath(context, joinRoot(context, pkg.main))) {
    failures.push(`package.json main points to a missing file (${pkg.main})`);
  }
  for (const { script, target } of referencedScriptFiles(pkg.scripts)) {
    if (!existsPath(context, joinRoot(context, target))) {
      failures.push(`npm script "${script}" references a missing file (${target})`);
    }
  }
  const requiredMajor = parseEnginesMajor(pkg.engines && pkg.engines.node);
  if (requiredMajor !== null) {
    try {
      const nvmrcRaw = readTextFile(context, joinRoot(context, '.nvmrc'));
      const nvmrcMajor = parseMajor(nvmrcRaw);
      if (nvmrcMajor !== null && nvmrcMajor !== requiredMajor) {
        warnings.push(`.nvmrc pins ${nvmrcMajor} but package.json engines requires >=${requiredMajor}`);
      }
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        warnings.push('.nvmrc could not be read');
      }
    }
  }
  const builderPaths = [];
  if (pkg.build) {
    if (typeof pkg.build.icon === 'string') builderPaths.push(pkg.build.icon);
    if (pkg.build.directories && typeof pkg.build.directories.buildResources === 'string') {
      builderPaths.push(pkg.build.directories.buildResources);
    }
    if (pkg.build.nsis && typeof pkg.build.nsis.license === 'string') {
      builderPaths.push(pkg.build.nsis.license);
    }
  }
  for (const builderPath of builderPaths) {
    if (builderPath.includes('*') || builderPath.includes('$') || builderPath.includes('{')) continue;
    if (!existsPath(context, joinRoot(context, builderPath))) {
      warnings.push(`electron-builder path is missing: ${builderPath}`);
    }
  }
  if (failures.length > 0) {
    return makeResult(
      id,
      name,
      'fail',
      failures[0],
      'Fix the referenced path or script in package.json',
      failures.length > 1 ? failures.slice(1).join('; ') : null
    );
  }
  if (warnings.length > 0) {
    return makeResult(
      id,
      name,
      'warn',
      warnings[0],
      'Align the configuration values',
      warnings.length > 1 ? warnings.slice(1).join('; ') : null
    );
  }
  return makeResult(id, name, 'pass', 'package and build configuration consistent');
}

async function checkTempStorage(context) {
  const id = 'temp-storage';
  const name = 'Temp storage';
  let probeDir = null;
  let cleanupFailed = false;
  const cleanup = () => {
    if (!probeDir) return;
    try {
      context.fs.rmSync(probeDir, { recursive: true, force: true });
    } catch (_) {
      cleanupFailed = true;
    }
  };
  try {
    const tmpRoot = context.os.tmpdir();
    probeDir = context.fs.mkdtempSync(context.path.join(tmpRoot, 'soterios-doctor-'));
    const probeFile = context.path.join(probeDir, 'write-test.txt');
    context.fs.writeFileSync(probeFile, 'soterios-doctor-write-test', 'utf8');
    const roundTripped = context.fs.readFileSync(probeFile, 'utf8');
    if (roundTripped !== 'soterios-doctor-write-test') {
      throw new Error('temporary file contents did not round-trip');
    }
    cleanup();
    if (cleanupFailed) {
      return makeResult(id, name, 'warn', 'temporary directory is writable, but cleanup was incomplete');
    }
    return makeResult(id, name, 'pass', 'temporary directory is writable');
  } catch (_) {
    cleanup();
    return makeResult(id, name, 'fail', 'unable to create temporary working files');
  }
}

async function checkAppData(context) {
  const id = 'app-data';
  const name = 'App data';
  const dir = resolveAppDataDir(context);
  if (!dir) {
    return makeResult(id, name, 'warn', 'application data location could not be determined');
  }
  const parent = context.path.dirname(dir);
  const writeFlag =
    context.fs.constants && typeof context.fs.constants.W_OK === 'number'
      ? context.fs.constants.W_OK
      : 2;
  try {
    context.fs.accessSync(parent, writeFlag);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return makeResult(id, name, 'warn', 'application data location could not be verified');
    }
    return makeResult(
      id,
      name,
      'warn',
      'application data location is not writable',
      'Ensure the application data folder is writable'
    );
  }
  return makeResult(id, name, 'pass', 'application data location is writable');
}

async function checkDependencies(context) {
  const id = 'dependencies';
  const name = 'Dependencies';
  if (!existsPath(context, joinRoot(context, 'node_modules'))) {
    return makeResult(id, name, 'warn', 'dependencies are not installed', 'Run: npm ci');
  }
  const lockPresent = existsPath(context, joinRoot(context, 'package-lock.json'));
  return makeResult(
    id,
    name,
    'pass',
    'dependencies installed',
    null,
    lockPresent ? 'package-lock.json present' : 'package-lock.json is missing'
  );
}

async function checkRust(context) {
  const id = 'rust';
  const name = 'Rust toolchain';
  if (context.platform !== 'win32') {
    return makeResult(id, name, 'skip', 'Windows-only native build prerequisite');
  }
  const installHint =
    'Run: rustup toolchain install 1.85.1-x86_64-pc-windows-msvc --profile minimal --component clippy,rustfmt';
  let pinned = null;
  try {
    const toolchain = readTextFile(context, joinRoot(context, 'rust-toolchain.toml'));
    const match = String(toolchain).match(/channel\s*=\s*"([^"]+)"/);
    if (match) pinned = match[1].trim();
  } catch (_) {
    pinned = null;
  }
  try {
    const { stdout } = await context.runCommand('cargo', ['--version'], {
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    const match = String(stdout || '').match(/cargo\s+([\d.]+)/i);
    // Never echo raw command output: only a recognized version number is
    // reported, anything else is an unverifiable toolchain.
    if (!match) {
      return makeResult(id, name, 'warn', 'Rust toolchain could not be verified', installHint);
    }
    const version = match[1];
    if (pinned && version !== pinned) {
      return makeResult(
        id,
        name,
        'warn',
        `cargo ${version} does not match the pinned toolchain ${pinned}`,
        installHint
      );
    }
    return makeResult(id, name, 'pass', `cargo ${version} available`);
  } catch (err) {
    if (isMissingExecutableError(err)) {
      return makeResult(id, name, 'warn', 'Rust toolchain is not available', installHint);
    }
    return makeResult(id, name, 'warn', 'Rust toolchain could not be verified', installHint);
  }
}

const CHECKS = [
  { id: 'node-version', name: 'Node.js', run: checkNodeVersion },
  { id: 'platform', name: 'Platform', run: checkPlatform },
  { id: 'arch', name: 'Architecture', run: checkArch },
  { id: 'powershell', name: 'PowerShell', run: checkPowerShell },
  { id: 'clamav', name: 'ClamAV', run: checkClamAv },
  { id: 'clamav-version', name: 'ClamAV version', run: checkClamAvVersion },
  { id: 'native-host', name: 'Native host', run: checkNativeHost },
  { id: 'process-helper', name: 'Process helper', run: checkProcessHelper },
  { id: 'extension', name: 'Extension', run: checkExtension },
  { id: 'repository', name: 'Repository', run: checkRepository },
  { id: 'config', name: 'Configuration', run: checkConfig },
  { id: 'temp-storage', name: 'Temp storage', run: checkTempStorage },
  { id: 'app-data', name: 'App data', run: checkAppData },
  { id: 'dependencies', name: 'Dependencies', run: checkDependencies },
  { id: 'rust', name: 'Rust toolchain', run: checkRust },
];

// ---------------------------------------------------------------------------
// Aggregation / formatting / CLI
// ---------------------------------------------------------------------------

function summarizeResults(results) {
  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const result of results) {
    if (summary[result.status] !== undefined) summary[result.status] += 1;
  }
  return summary;
}

function exitCodeForResults(results) {
  return results.some((result) => result.status === 'fail') ? 1 : 0;
}

async function runDoctor(context) {
  const active = context || createContext();
  const results = [];
  for (const check of CHECKS) {
    let result = null;
    try {
      result = await check.run(active);
    } catch (err) {
      result = makeResult(
        check.id,
        check.name,
        'fail',
        'diagnostic check encountered an unexpected error',
        null,
        err && err.message ? String(err.message) : String(err)
      );
    }
    results.push(sanitizeResult(result, active));
  }
  const summary = summarizeResults(results);
  return { results, summary, exitCode: exitCodeForResults(results) };
}

function formatResults(results, summary) {
  const counts = summary || summarizeResults(results);
  const width = results.reduce((max, result) => Math.max(max, result.name.length), 0);
  const lines = [];
  lines.push('Soterios Environment Doctor');
  lines.push('===========================');
  lines.push('');
  for (const result of results) {
    const status = String(result.status).toUpperCase().padEnd(4);
    lines.push(`${status}  ${result.name.padEnd(width)}  ${result.summary}`);
    if (result.remediation) {
      lines.push(`      \u2192 ${result.remediation}`);
    }
    if (result.details) {
      lines.push(`      (${result.details})`);
    }
  }
  lines.push('');
  lines.push('Summary');
  lines.push('-------');
  lines.push(`${counts.pass} passed`);
  lines.push(`${counts.warn} warnings`);
  lines.push(`${counts.fail} failed`);
  lines.push(`${counts.skip} skipped`);
  lines.push('');
  if (counts.fail > 0) {
    lines.push('Environment requires attention before Soterios can run correctly.');
  } else {
    lines.push('Environment looks usable.');
  }
  return lines.join('\n');
}

async function main() {
  const context = createContext();
  const { results, summary, exitCode } = await runDoctor(context);
  process.stdout.write(`${formatResults(results, summary)}\n`);
  process.exitCode = exitCode;
}

if (require.main === module) {
  main().catch((err) => {
    const context = createContext();
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(
      `Soterios Environment Doctor failed: ${sanitizeForOutput(message, context)}\n`
    );
    process.exitCode = 1;
  });
}

module.exports = {
  CHECKS,
  COMMAND_TIMEOUT_MS,
  checkAppData,
  checkArch,
  checkClamAv,
  checkClamAvVersion,
  checkConfig,
  checkDependencies,
  checkExtension,
  checkNativeHost,
  checkNodeVersion,
  checkPlatform,
  checkPowerShell,
  checkProcessHelper,
  checkRepository,
  checkRust,
  checkTempStorage,
  createContext,
  exitCodeForResults,
  formatResults,
  parseEnginesMajor,
  parseMajor,
  referencedScriptFiles,
  resolveAppDataDir,
  runDoctor,
  sanitizeForOutput,
  summarizeResults,
  validateExtensionManifest,
};
