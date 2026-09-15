'use strict';

// Tests for tools/doctor.js (Soterios Environment Doctor).
//
// Every test supplies a fully injected context (in-memory filesystem, fake
// command runner, fixed platform/arch/version values), so nothing here depends
// on the machine running the suite.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const doctor = require('../tools/doctor');

const REPO = path.join('mem', 'soterios-repo');
const TMP = path.join('mem', 'tmp');
const HOME = path.join('mem', 'home', 'tester');

function enoent(what) {
  const err = new Error(`ENOENT: no such file or directory, ${what}`);
  err.code = 'ENOENT';
  return err;
}

function validExtensionManifest() {
  return {
    manifest_version: 3,
    name: 'Soterios',
    version: '2.0.0',
    permissions: ['storage', 'alarms', 'activeTab', 'scripting'],
    background: { service_worker: 'background.js', type: 'module' },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
    web_accessible_resources: [
      { resources: ['icons/icon32.png'], matches: ['http://*/*', 'https://*/*'] },
    ],
    icons: { 128: 'icons/icon128.png' },
  };
}

function basePackageJson(overrides = {}) {
  return JSON.stringify({
    name: 'soterios',
    engines: { node: '>=26' },
    main: 'src/main/main.js',
    scripts: {},
    build: {
      icon: 'assets/icon.ico',
      directories: { buildResources: 'build' },
      nsis: { license: 'build/LICENSE.txt' },
    },
    ...overrides,
  });
}

function baseFiles(overrides = {}) {
  const files = {
    [path.join(REPO, 'package.json')]: basePackageJson(),
    [path.join(REPO, '.nvmrc')]: '26\n',
    [path.join(REPO, 'src', 'main', 'main.js')]: '// main',
    [path.join(REPO, 'preload.js')]: '// preload',
    [path.join(REPO, 'src', 'native-host', 'host.js')]: '// host',
    [path.join(REPO, 'native', 'process-inspector', 'Cargo.toml')]: '[package]',
    [path.join(REPO, 'browser-extension', 'package.json')]: '{}',
    [path.join(REPO, 'assets', 'icon.ico')]: 'icon',
    [path.join(REPO, 'build', 'LICENSE.txt')]: 'license',
    [path.join(REPO, 'rust-toolchain.toml')]: '[toolchain]\nchannel = "1.85.1"\n',
    [path.join(REPO, 'package-lock.json')]: '{}',
    [path.join(REPO, 'assets', 'clamav', 'clamscan.exe')]: 'clamscan-binary',
    [path.join(REPO, 'assets', 'clamav', 'freshclam.exe')]: 'freshclam-binary',
    [path.join(REPO, 'build', 'native', 'soterios-process-inspector.exe')]: 'helper-binary',
    [path.join(REPO, 'build', 'native-host', 'SoteriosNativeHost.exe')]: 'native-host',
    [path.join(REPO, 'browser-extension', 'dist', 'chromium', 'manifest.json')]: JSON.stringify(
      validExtensionManifest()
    ),
    [path.join(REPO, 'browser-extension', 'dist', 'chromium', 'background.js')]: '// bg',
    [path.join(REPO, 'browser-extension', 'dist', 'chromium', 'icons', 'icon128.png')]: 'png',
    ...overrides,
  };
  files[path.join(REPO, 'build', 'native', 'checksums.json')] = JSON.stringify({
    'soterios-process-inspector.exe': crypto
      .createHash('sha256')
      .update('helper-binary')
      .digest('hex'),
  });
  return files;
}

function createMemoryFs({ files = {}, dirs = [], fail = {} } = {}) {
  const storedFiles = new Map();
  const storedDirs = new Set();
  const norm = (value) => path.normalize(String(value));
  const addAncestors = (normalized) => {
    let current = path.dirname(normalized);
    let guard = 0;
    while (current && current !== '.' && current !== path.dirname(current) && guard < 50) {
      storedDirs.add(current);
      current = path.dirname(current);
      guard += 1;
    }
  };
  for (const [name, content] of Object.entries(files)) {
    const normalized = norm(name);
    storedFiles.set(normalized, String(content));
    addAncestors(normalized);
  }
  for (const dir of dirs) {
    storedDirs.add(norm(dir));
    addAncestors(norm(dir));
  }
  const maybeFail = (op) => {
    if (fail[op]) throw fail[op];
  };
  const statsFor = (name) => {
    const normalized = norm(name);
    if (storedFiles.has(normalized)) {
      return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    }
    if (storedDirs.has(normalized)) {
      return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
    }
    throw enoent(`stat '${name}'`);
  };
  return {
    constants: { W_OK: 2 },
    existsSync(name) {
      maybeFail('existsSync');
      const normalized = norm(name);
      return storedFiles.has(normalized) || storedDirs.has(normalized);
    },
    statSync(name) {
      maybeFail('statSync');
      return statsFor(name);
    },
    lstatSync(name) {
      maybeFail('lstatSync');
      return statsFor(name);
    },
    readFileSync(name) {
      maybeFail('readFileSync');
      const normalized = norm(name);
      if (!storedFiles.has(normalized)) throw enoent(`open '${name}'`);
      return storedFiles.get(normalized);
    },
    writeFileSync(name, data) {
      maybeFail('writeFileSync');
      const normalized = norm(name);
      storedFiles.set(normalized, String(data));
      addAncestors(normalized);
    },
    mkdtempSync(prefix) {
      maybeFail('mkdtempSync');
      const dir = `${prefix}doctor-probe`;
      storedDirs.add(norm(dir));
      return dir;
    },
    rmSync(name) {
      maybeFail('rmSync');
      const normalized = norm(name);
      storedFiles.delete(normalized);
      storedDirs.delete(normalized);
      const prefix = `${normalized}${path.sep}`;
      for (const key of [...storedFiles.keys()]) {
        if (key.startsWith(prefix)) storedFiles.delete(key);
      }
      for (const key of [...storedDirs.keys()]) {
        if (key.startsWith(prefix)) storedDirs.delete(key);
      }
    },
    accessSync(name) {
      maybeFail('accessSync');
      const normalized = norm(name);
      if (!storedFiles.has(normalized) && !storedDirs.has(normalized)) {
        throw enoent(`access '${name}'`);
      }
    },
  };
}

function defaultFakeRunCommand() {
  return async (file) => {
    if (file === 'powershell.exe') return { stdout: '5.1.22621.1\n', stderr: '' };
    if (String(file).endsWith('clamscan.exe')) {
      return { stdout: 'ClamAV 1.5.2/298 la la\n', stderr: '' };
    }
    if (file === 'cargo') return { stdout: 'cargo 1.85.1 (abc123 2025-01-01)\n', stderr: '' };
    throw new Error(`unexpected command: ${file}`);
  };
}

function makeClamavHelper(memory, options = {}) {
  const helper = {
    requiredBinaries: ['clamscan.exe', 'freshclam.exe'],
    validateInstall(dir) {
      for (const binary of ['clamscan.exe', 'freshclam.exe']) {
        const stat = memory.lstatSync(path.join(dir, binary));
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error(`Missing required ClamAV binary: ${binary}`);
        }
      }
    },
    downloadSkipReason() {
      return options.skipReason === undefined ? null : options.skipReason;
    },
    envFlagEnabled(env, name) {
      return ['1', 'true', 'yes'].includes(String(env[name] || '').trim().toLowerCase());
    },
    skipEnvVar: 'SOTERIOS_SKIP_CLAMAV',
    forceEnvVar: 'SOTERIOS_FORCE_CLAMAV',
  };
  if (options.omitNewHelpers) {
    return { requiredBinaries: helper.requiredBinaries, validateInstall: helper.validateInstall };
  }
  helper.hasCompleteInstall = (dir) => {
    options.hasCompleteInstallCalls = (options.hasCompleteInstallCalls || 0) + 1;
    if (options.completeOverride !== undefined) return options.completeOverride;
    return ['clamscan.exe', 'freshclam.exe'].every((binary) => {
      try {
        const stat = memory.lstatSync(path.join(dir, binary));
        return stat.isFile() && !stat.isSymbolicLink();
      } catch (_) {
        return false;
      }
    });
  };
  return helper;
}

function makeContext(options = {}) {
  const files = options.files !== undefined ? options.files : baseFiles(options.fileOverrides);
  const memory = createMemoryFs({
    files,
    dirs: options.dirs !== undefined ? options.dirs : [path.join(REPO, 'node_modules')],
    fail: options.fail || {},
  });
  return doctor.createContext({
    repoRoot: REPO,
    platform: options.platform !== undefined ? options.platform : 'win32',
    arch: options.arch !== undefined ? options.arch : 'x64',
    nodeVersion: options.nodeVersion !== undefined ? options.nodeVersion : 'v26.3.0',
    env: options.env !== undefined ? options.env : {},
    fs: memory,
    path,
    os: {
      tmpdir: () => TMP,
      homedir: () => HOME,
    },
    runCommand: options.runCommand !== undefined ? options.runCommand : defaultFakeRunCommand(),
    clamav: options.clamav !== undefined ? options.clamav : makeClamavHelper(memory, options.clamavOptions),
  });
}

function withoutFiles(base, ...suffixes) {
  const files = { ...base };
  for (const suffix of suffixes) {
    delete files[path.join(REPO, suffix)];
  }
  return files;
}

async function runAll(options = {}) {
  return doctor.runDoctor(makeContext(options));
}

function resultById(results, id) {
  const found = results.find((entry) => entry.id === id);
  assert.ok(found, `expected a result for check "${id}"`);
  return found;
}

// ---------------------------------------------------------------------------
// Node.js version
// ---------------------------------------------------------------------------

describe('doctor node-version check', () => {
  it('passes for a supported Node.js version', async () => {
    const result = await doctor.checkNodeVersion(makeContext({ nodeVersion: 'v26.3.0' }));
    assert.equal(result.status, 'pass');
    assert.match(result.summary, /satisfies >=26/);
  });

  it('fails for an unsupported older Node.js version', async () => {
    const result = await doctor.checkNodeVersion(makeContext({ nodeVersion: 'v24.11.0' }));
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /does not satisfy/);
    assert.ok(result.remediation);
  });

  it('fails for a malformed version string', async () => {
    const result = await doctor.checkNodeVersion(makeContext({ nodeVersion: 'not-a-version' }));
    assert.equal(result.status, 'fail');
  });

  it('passes when .nvmrc is consistent with package.json engines', async () => {
    const result = await doctor.checkNodeVersion(makeContext({ nodeVersion: 'v26.0.1' }));
    assert.equal(result.status, 'pass');
  });

  it('warns when .nvmrc disagrees with package.json engines', async () => {
    const files = baseFiles({ [path.join(REPO, '.nvmrc')]: '24\n' });
    const result = await doctor.checkNodeVersion(makeContext({ files, nodeVersion: 'v26.3.0' }));
    assert.equal(result.status, 'warn');
    assert.match(result.summary, /\.nvmrc/);
    assert.ok(result.remediation);
  });
});

// ---------------------------------------------------------------------------
// Platform / architecture
// ---------------------------------------------------------------------------

describe('doctor platform and architecture checks', () => {
  it('passes on Windows x64', async () => {
    const context = makeContext({ platform: 'win32', arch: 'x64' });
    assert.equal((await doctor.checkPlatform(context)).status, 'pass');
    assert.equal((await doctor.checkArch(context)).status, 'pass');
  });

  it('warns on Windows arm64 for architecture but passes platform', async () => {
    const context = makeContext({ platform: 'win32', arch: 'arm64' });
    assert.equal((await doctor.checkPlatform(context)).status, 'pass');
    const arch = await doctor.checkArch(context);
    assert.equal(arch.status, 'warn');
    assert.match(arch.summary, /arm64/);
  });

  it('warns on Linux without failing', async () => {
    const result = await doctor.checkPlatform(makeContext({ platform: 'linux', arch: 'x64' }));
    assert.equal(result.status, 'warn');
    assert.match(result.summary, /Windows-targeted/);
  });

  it('warns on macOS without failing', async () => {
    const result = await doctor.checkPlatform(makeContext({ platform: 'darwin', arch: 'arm64' }));
    assert.equal(result.status, 'warn');
    assert.match(result.summary, /macOS/);
  });
});

// ---------------------------------------------------------------------------
// PowerShell
// ---------------------------------------------------------------------------

describe('doctor powershell check', () => {
  it('passes when PowerShell reports a version', async () => {
    const result = await doctor.checkPowerShell(makeContext());
    assert.equal(result.status, 'pass');
    assert.match(result.summary, /5\.1/);
  });

  it('fails when powershell.exe is missing', async () => {
    const missing = new Error("spawn powershell.exe ENOENT");
    missing.code = 'ENOENT';
    const result = await doctor.checkPowerShell(
      makeContext({
        runCommand: async () => {
          throw missing;
        },
      })
    );
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /could not be started/);
  });

  it('fails when the version query times out', async () => {
    const timeout = new Error('Timed out');
    timeout.killed = true;
    const result = await doctor.checkPowerShell(
      makeContext({
        runCommand: async () => {
          throw timeout;
        },
      })
    );
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /timed out/);
  });

  it('skips on non-Windows without spawning anything', async () => {
    let called = false;
    const result = await doctor.checkPowerShell(
      makeContext({
        platform: 'linux',
        runCommand: async () => {
          called = true;
          throw new Error('must not spawn on Linux');
        },
      })
    );
    assert.equal(result.status, 'skip');
    assert.equal(called, false);
  });
});

// ---------------------------------------------------------------------------
// ClamAV completeness (partial installs must never read as healthy)
// ---------------------------------------------------------------------------

describe('doctor clamav check', () => {
  it('passes for a complete required installation', async () => {
    const result = await doctor.checkClamAv(makeContext());
    assert.equal(result.status, 'pass');
    assert.match(result.summary, /complete/);
  });

  it('warns when ClamAV is completely missing', async () => {
    const files = withoutFiles(
      baseFiles(),
      path.join('assets', 'clamav', 'clamscan.exe'),
      path.join('assets', 'clamav', 'freshclam.exe')
    );
    const result = await doctor.checkClamAv(makeContext({ files }));
    assert.equal(result.status, 'warn');
    assert.match(result.summary, /not installed/);
    assert.match(result.remediation || '', /npm install/);
  });

  it('warns with the bootstrap skip reason when ClamAV is missing on Linux', async () => {
    const files = withoutFiles(
      baseFiles(),
      path.join('assets', 'clamav', 'clamscan.exe'),
      path.join('assets', 'clamav', 'freshclam.exe')
    );
    const skipReason =
      'the pinned ClamAV archive only contains Windows binaries (platform: linux; set SOTERIOS_FORCE_CLAMAV=1 to download anyway)';
    const result = await doctor.checkClamAv(
      makeContext({ files, platform: 'linux', clamavOptions: { skipReason } })
    );
    assert.equal(result.status, 'warn');
    assert.match(result.summary, /Windows binaries/);
    assert.match(result.remediation || '', /SOTERIOS_FORCE_CLAMAV=1/);
    assert.ok(!(result.remediation || '').includes('postinstall downloads'));
  });

  it('warns that the skip flag is set when ClamAV is missing on Windows', async () => {
    const files = withoutFiles(
      baseFiles(),
      path.join('assets', 'clamav', 'clamscan.exe'),
      path.join('assets', 'clamav', 'freshclam.exe')
    );
    const result = await doctor.checkClamAv(
      makeContext({
        files,
        env: { SOTERIOS_SKIP_CLAMAV: '1' },
        clamavOptions: { skipReason: 'SOTERIOS_SKIP_CLAMAV is set' },
      })
    );
    assert.equal(result.status, 'warn');
    assert.match(result.summary, /SOTERIOS_SKIP_CLAMAV is set/);
    assert.match(result.remediation || '', /Unset SOTERIOS_SKIP_CLAMAV/);
  });

  it('consults the canonical hasCompleteInstall helper', async () => {
    const clamavOptions = {};
    const context = makeContext({ clamavOptions });
    const result = await doctor.checkClamAv(context);
    assert.equal(result.status, 'pass');
    assert.ok((clamavOptions.hasCompleteInstallCalls || 0) > 0);
  });

  it('still classifies installs when the helper only exposes the legacy shape', async () => {
    const complete = await doctor.checkClamAv(makeContext({ clamavOptions: { omitNewHelpers: true } }));
    assert.equal(complete.status, 'pass');
    const files = withoutFiles(baseFiles(), path.join('assets', 'clamav', 'freshclam.exe'));
    const partial = await doctor.checkClamAv(
      makeContext({ files, clamavOptions: { omitNewHelpers: true } })
    );
    assert.equal(partial.status, 'fail');
    assert.match(partial.summary, /partial/);
  });

  it('fails when only clamscan.exe is present', async () => {
    const files = withoutFiles(baseFiles(), path.join('assets', 'clamav', 'freshclam.exe'));
    const result = await doctor.checkClamAv(makeContext({ files }));
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /partial/);
    assert.match(result.summary, /freshclam\.exe/);
  });

  it('fails when only freshclam.exe is present', async () => {
    const files = withoutFiles(baseFiles(), path.join('assets', 'clamav', 'clamscan.exe'));
    const result = await doctor.checkClamAv(makeContext({ files }));
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /partial/);
    assert.match(result.summary, /clamscan\.exe/);
  });

  it('fails when the reused validation helper reports an error', async () => {
    const context = makeContext();
    context.clamav = {
      requiredBinaries: ['clamscan.exe', 'freshclam.exe'],
      validateInstall() {
        throw new Error('Missing required ClamAV binary: freshclam.exe');
      },
    };
    const result = await doctor.checkClamAv(context);
    assert.equal(result.status, 'fail');
  });

  it('fails when the filesystem cannot be inspected', async () => {
    const result = await doctor.checkClamAv(
      makeContext({ fail: { lstatSync: new Error('disk unavailable') } })
    );
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /could not be validated/);
  });

  it('consumes the current download-clamav export shape', (t) => {
    // Contract test: if the canonical module renames an export the doctor
    // relies on, this fails loudly instead of letting the doctor silently
    // fall back to built-in defaults.
    let downloadClamav = null;
    try {
      downloadClamav = require('../tools/download-clamav');
    } catch (_) {
      t.skip('download-clamav dependencies are not installed');
      return;
    }
    assert.ok(
      Array.isArray(downloadClamav.REQUIRED_BINARIES) && downloadClamav.REQUIRED_BINARIES.length > 0
    );
    for (const key of [
      'validateInstall',
      'hasCompleteInstall',
      'downloadSkipReason',
      'envFlagEnabled',
    ]) {
      assert.equal(typeof downloadClamav[key], 'function', `expected export ${key}`);
    }
    assert.equal(typeof downloadClamav.SKIP_ENV_VAR, 'string');
    assert.equal(typeof downloadClamav.FORCE_ENV_VAR, 'string');
  });

  it('classifies a real on-disk install through the real helper', async () => {
    const realFs = require('fs');
    const realOs = require('os');
    const root = realFs.mkdtempSync(path.join(realOs.tmpdir(), 'soterios-doctor-clamav-'));
    try {
      const dir = path.join(root, 'assets', 'clamav');
      realFs.mkdirSync(dir, { recursive: true });
      // clamav: undefined selects the lazy real-module path.
      const context = doctor.createContext({ repoRoot: root, platform: 'win32', clamav: undefined });
      realFs.writeFileSync(path.join(dir, 'clamscan.exe'), 'x');
      realFs.writeFileSync(path.join(dir, 'freshclam.exe'), 'x');
      assert.equal((await doctor.checkClamAv(context)).status, 'pass');
      realFs.rmSync(path.join(dir, 'freshclam.exe'));
      const partial = await doctor.checkClamAv(context);
      assert.equal(partial.status, 'fail');
      assert.match(partial.summary, /partial/);
    } finally {
      realFs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('doctor clamav-version check', () => {
  it('reports the version when clamscan answers', async () => {
    const result = await doctor.checkClamAvVersion(makeContext());
    assert.equal(result.status, 'pass');
    assert.match(result.summary, /1\.5\.2/);
  });

  it('skips when ClamAV is not installed', async () => {
    const files = withoutFiles(
      baseFiles(),
      path.join('assets', 'clamav', 'clamscan.exe'),
      path.join('assets', 'clamav', 'freshclam.exe')
    );
    const result = await doctor.checkClamAvVersion(makeContext({ files }));
    assert.equal(result.status, 'skip');
  });

  it('warns instead of failing when the version cannot be queried', async () => {
    const result = await doctor.checkClamAvVersion(
      makeContext({
        runCommand: async () => {
          throw new Error('crashed');
        },
      })
    );
    assert.equal(result.status, 'warn');
  });
});

// ---------------------------------------------------------------------------
// Native process helper
// ---------------------------------------------------------------------------

describe('doctor process-helper check', () => {
  it('passes when the helper and checksum metadata verify', async () => {
    const result = await doctor.checkProcessHelper(makeContext());
    assert.equal(result.status, 'pass');
    assert.match(result.summary, /verified/);
  });

  it('warns when the helper has not been built', async () => {
    const files = withoutFiles(
      baseFiles(),
      path.join('build', 'native', 'soterios-process-inspector.exe')
    );
    const result = await doctor.checkProcessHelper(makeContext({ files }));
    assert.equal(result.status, 'warn');
    assert.match(result.summary, /has not been built/);
    assert.match(result.remediation || '', /native:process/);
  });

  it('fails on a checksum mismatch', async () => {
    const files = baseFiles();
    files[path.join(REPO, 'build', 'native', 'checksums.json')] = JSON.stringify({
      'soterios-process-inspector.exe': '0'.repeat(64),
    });
    const result = await doctor.checkProcessHelper(makeContext({ files }));
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /checksum mismatch/);
  });

  it('fails when the integrity check cannot run', async () => {
    const context = makeContext({ fail: { statSync: new Error('disk unavailable') } });
    const { results } = await doctor.runDoctor(context);
    assert.equal(resultById(results, 'process-helper').status, 'fail');
  });

  it('skips on non-Windows', async () => {
    const result = await doctor.checkProcessHelper(makeContext({ platform: 'linux' }));
    assert.equal(result.status, 'skip');
  });
});

// ---------------------------------------------------------------------------
// Native host
// ---------------------------------------------------------------------------

describe('doctor native-host check', () => {
  it('passes when the host executable is present', async () => {
    const result = await doctor.checkNativeHost(makeContext());
    assert.equal(result.status, 'pass');
    assert.match(result.summary, /SoteriosNativeHost\.exe/);
  });

  it('warns when the host has not been built', async () => {
    const files = withoutFiles(
      baseFiles(),
      path.join('build', 'native-host', 'SoteriosNativeHost.exe')
    );
    const result = await doctor.checkNativeHost(makeContext({ files }));
    assert.equal(result.status, 'warn');
    assert.match(result.remediation || '', /native-host:build/);
  });

  it('skips on non-Windows', async () => {
    const result = await doctor.checkNativeHost(makeContext({ platform: 'darwin' }));
    assert.equal(result.status, 'skip');
  });
});

// ---------------------------------------------------------------------------
// Browser extension
// ---------------------------------------------------------------------------

describe('doctor extension check', () => {
  it('passes for a valid build', async () => {
    const result = await doctor.checkExtension(makeContext());
    assert.equal(result.status, 'pass');
    assert.match(result.summary, /present and valid/);
  });

  it('warns when the extension has not been built', async () => {
    const files = withoutFiles(
      baseFiles(),
      path.join('browser-extension', 'dist', 'chromium', 'manifest.json')
    );
    const result = await doctor.checkExtension(makeContext({ files }));
    assert.equal(result.status, 'warn');
    assert.match(result.remediation || '', /extension:build/);
  });

  it('fails for a malformed manifest', async () => {
    const files = baseFiles({
      [path.join(REPO, 'browser-extension', 'dist', 'chromium', 'manifest.json')]: '{oops',
    });
    const result = await doctor.checkExtension(makeContext({ files }));
    assert.equal(result.status, 'fail');
  });

  it('fails for an incomplete build that violates structural rules', async () => {
    const manifest = { ...validExtensionManifest(), manifest_version: 2 };
    const files = baseFiles({
      [path.join(REPO, 'browser-extension', 'dist', 'chromium', 'manifest.json')]:
        JSON.stringify(manifest),
    });
    const result = await doctor.checkExtension(makeContext({ files }));
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /validation failed/);
    assert.match(result.details || '', /manifest_version/);
  });

  it('fails when validation itself errors', async () => {
    const result = await doctor.checkExtension(
      makeContext({ fail: { readFileSync: new Error('disk unavailable') } })
    );
    // existsSync uses existsSync (not readFileSync), so the manifest appears
    // present and the read blows up inside validation.
    assert.equal(result.status, 'fail');
  });
});

// ---------------------------------------------------------------------------
// Repository files and configuration consistency
// ---------------------------------------------------------------------------

describe('doctor repository and configuration checks', () => {
  it('passes when required source files are present', async () => {
    const result = await doctor.checkRepository(makeContext());
    assert.equal(result.status, 'pass');
  });

  it('fails when a required source file is missing', async () => {
    const files = withoutFiles(baseFiles(), path.join('src', 'main', 'main.js'));
    const result = await doctor.checkRepository(makeContext({ files }));
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /src\/main\/main\.js/);
  });

  it('passes configuration when package.json main is valid', async () => {
    const result = await doctor.checkConfig(makeContext());
    assert.equal(result.status, 'pass');
  });

  it('fails configuration when package.json main is invalid', async () => {
    const files = baseFiles({
      [path.join(REPO, 'package.json')]: basePackageJson({ main: 'src/main/does-not-exist.js' }),
    });
    const result = await doctor.checkConfig(makeContext({ files }));
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /main/);
  });

  it('fails configuration when an npm script references a missing source file', async () => {
    const files = baseFiles({
      [path.join(REPO, 'package.json')]: basePackageJson({
        scripts: { 'native:process': 'node tools/build-process-helper.js', broken: 'node tools/nope.js' },
      }),
      [path.join(REPO, 'tools', 'build-process-helper.js')]: '// build helper',
    });
    const result = await doctor.checkConfig(makeContext({ files }));
    assert.equal(result.status, 'fail');
    assert.match(result.summary, /broken/);
  });

  it('treats missing generated artifacts as warnings rather than source failures', async () => {
    const files = baseFiles({
      [path.join(REPO, 'package.json')]: basePackageJson({
        build: {
          icon: 'assets/icon.ico',
          directories: { buildResources: 'build' },
          nsis: { license: 'build/missing-license.txt' },
        },
      }),
    });
    const result = await doctor.checkConfig(makeContext({ files }));
    assert.equal(result.status, 'warn');
    assert.match(result.summary, /electron-builder/);
  });
});

// ---------------------------------------------------------------------------
// Temp storage / app data / dependencies / rust
// ---------------------------------------------------------------------------

describe('doctor environment checks', () => {
  it('passes when temporary storage is writable', async () => {
    const result = await doctor.checkTempStorage(makeContext());
    assert.equal(result.status, 'pass');
  });

  it('fails when the probe directory cannot be created', async () => {
    const result = await doctor.checkTempStorage(
      makeContext({ fail: { mkdtempSync: new Error('denied') } })
    );
    assert.equal(result.status, 'fail');
  });

  it('fails when the probe file cannot be written', async () => {
    const result = await doctor.checkTempStorage(
      makeContext({ fail: { writeFileSync: new Error('denied') } })
    );
    assert.equal(result.status, 'fail');
  });

  it('does not crash when cleanup fails', async () => {
    const result = await doctor.checkTempStorage(
      makeContext({ fail: { rmSync: new Error('locked') } })
    );
    assert.ok(['pass', 'warn'].includes(result.status));
  });

  it('passes when the app-data parent is writable', async () => {
    const appData = path.join('mem', 'appdata');
    const context = makeContext({
      env: { APPDATA: appData },
      dirs: [path.join(REPO, 'node_modules'), appData],
    });
    const result = await doctor.checkAppData(context);
    assert.equal(result.status, 'pass');
  });

  it('warns when the app-data location is not writable', async () => {
    const denied = new Error('access denied');
    denied.code = 'EACCES';
    const result = await doctor.checkAppData(
      makeContext({ env: { APPDATA: path.join('mem', 'appdata') }, fail: { accessSync: denied } })
    );
    assert.equal(result.status, 'warn');
  });

  it('warns when node_modules is missing', async () => {
    const result = await doctor.checkDependencies(makeContext({ dirs: [] }));
    assert.equal(result.status, 'warn');
    assert.match(result.remediation || '', /npm ci/);
  });

  it('passes when dependencies are installed', async () => {
    const result = await doctor.checkDependencies(makeContext());
    assert.equal(result.status, 'pass');
  });

  it('passes when the pinned Rust toolchain is available', async () => {
    const result = await doctor.checkRust(makeContext());
    assert.equal(result.status, 'pass');
    assert.match(result.summary, /1\.85\.1/);
  });

  it('warns when cargo is missing', async () => {
    const missing = new Error('spawn cargo ENOENT');
    missing.code = 'ENOENT';
    const result = await doctor.checkRust(
      makeContext({
        runCommand: async () => {
          throw missing;
        },
      })
    );
    assert.equal(result.status, 'warn');
  });

  it('skips the Rust check on non-Windows', async () => {
    const result = await doctor.checkRust(makeContext({ platform: 'linux' }));
    assert.equal(result.status, 'skip');
  });
});

// ---------------------------------------------------------------------------
// Aggregation, exit codes, and robustness
// ---------------------------------------------------------------------------

describe('doctor aggregation and exit codes', () => {
  it('exits 0 when everything passes', async () => {
    const { summary, exitCode } = await runAll();
    assert.equal(exitCode, 0);
    assert.equal(summary.fail, 0);
    assert.ok(summary.pass > 0);
  });

  it('exits 0 with warnings only', async () => {
    const files = withoutFiles(
      baseFiles(),
      path.join('build', 'native-host', 'SoteriosNativeHost.exe')
    );
    const { summary, exitCode } = await runAll({ files });
    assert.equal(exitCode, 0);
    assert.ok(summary.warn > 0);
    assert.equal(summary.fail, 0);
  });

  it('exits 1 when a single check fails', async () => {
    const { summary, exitCode } = await runAll({ nodeVersion: 'v24.9.0' });
    assert.equal(exitCode, 1);
    assert.equal(summary.fail, 1);
  });

  it('exits 1 with several failures', async () => {
    const files = withoutFiles(baseFiles(), path.join('src', 'main', 'main.js'));
    const { summary, exitCode } = await runAll({ files, nodeVersion: 'v24.9.0' });
    assert.equal(exitCode, 1);
    assert.ok(summary.fail >= 2);
  });

  it('exits 0 when checks are skipped', async () => {
    assert.equal(doctor.exitCodeForResults([{ status: 'skip' }, { status: 'pass' }]), 0);
    assert.equal(doctor.exitCodeForResults([{ status: 'warn' }]), 0);
    assert.equal(doctor.exitCodeForResults([{ status: 'fail' }]), 1);
  });

  it('counts skipped checks in the summary', async () => {
    const { summary, exitCode } = await runAll({ platform: 'linux', arch: 'x64' });
    assert.ok(summary.skip >= 4);
    assert.equal(exitCode, 0);
  });

  it('keeps running remaining checks when one check throws unexpectedly', async () => {
    const explodingFs = createMemoryFs({ files: baseFiles() });
    explodingFs.statSync = () => {
      throw new Error('catastrophic stat failure');
    };
    explodingFs.lstatSync = () => {
      throw new Error('catastrophic lstat failure');
    };
    const context = makeContext({});
    context.fs = explodingFs;
    const { results, exitCode } = await doctor.runDoctor(context);
    assert.equal(results.length, doctor.CHECKS.length);
    assert.equal(exitCode, 1);
    const helper = resultById(results, 'process-helper');
    assert.equal(helper.status, 'fail');
    assert.match(helper.summary, /unexpected error/);
    // Later checks still ran and passed.
    assert.equal(resultById(results, 'temp-storage').status, 'pass');
  });

  it('renders the human-readable report with a summary', async () => {
    const { results, summary } = await runAll();
    const text = doctor.formatResults(results, summary);
    assert.match(text, /Soterios Environment Doctor/);
    assert.match(text, /Summary/);
    assert.match(text, /passed/);
    assert.match(text, /Environment looks usable\./);
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe('doctor privacy', () => {
  function sensitiveContext() {
    const repoRoot = 'C:\\Users\\ExampleUser\\Desktop\\Soterios';
    const memory = createMemoryFs({ files: {}, dirs: [] });
    return doctor.createContext({
      repoRoot,
      platform: 'win32',
      arch: 'x64',
      nodeVersion: 'v26.3.0',
      env: {
        APPDATA: 'C:\\Users\\ExampleUser\\AppData\\Roaming',
        USERPROFILE: 'C:\\Users\\ExampleUser',
        SOTERIOS_USERDATA: 'C:\\Users\\ExampleUser\\AppData\\Roaming\\Soterios',
      },
      fs: memory,
      path,
      os: {
        tmpdir: () => 'C:\\Users\\ExampleUser\\AppData\\Local\\Temp',
        homedir: () => 'C:\\Users\\ExampleUser',
      },
      runCommand: async () => {
        const err = new Error("spawn failed at C:\\Users\\ExampleUser\\secret\\tool.exe");
        err.code = 'ENOENT';
        throw err;
      },
      clamav: { requiredBinaries: ['clamscan.exe', 'freshclam.exe'], validateInstall: null },
    });
  }

  it('never renders usernames or full sensitive paths', async () => {
    const { results, summary } = await doctor.runDoctor(sensitiveContext());
    const text = doctor.formatResults(results, summary);
    assert.ok(!text.includes('ExampleUser'), 'output leaked the username');
    assert.ok(!text.includes('C:\\Users\\ExampleUser'), 'output leaked a user path');
    assert.ok(!text.includes('/home/exampleuser'), 'output leaked a posix home path');
  });

  it('redacts posix-style home directories', () => {
    const context = sensitiveContext();
    context.os = { tmpdir: () => '/tmp', homedir: () => '/home/exampleuser' };
    const redacted = doctor.sanitizeForOutput('failed for /home/exampleuser/data/file', context);
    assert.ok(!redacted.includes('exampleuser'));
  });

  it('sanitizes error details that embed sensitive paths', async () => {
    const { results } = await doctor.runDoctor(sensitiveContext());
    const powershell = resultById(results, 'powershell');
    assert.equal(powershell.status, 'fail');
    for (const field of [powershell.summary, powershell.details, powershell.remediation]) {
      if (field) assert.ok(!field.includes('ExampleUser'));
    }
  });
});
