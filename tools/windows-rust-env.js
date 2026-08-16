'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function latestDirectory(root, predicate = () => true) {
  if (!fs.existsSync(root)) return null;
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && predicate(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((name) => path.join(root, name))[0] || null;
}

function windowsRustEnvironment(base = process.env) {
  const env = { ...base };
  if (process.platform !== 'win32') return env;
  const originalPath = env.Path || env.PATH || '';
  const cargoBin = path.join(env.USERPROFILE || '', '.cargo', 'bin');
  env.Path = [fs.existsSync(cargoBin) ? cargoBin : '', originalPath].filter(Boolean).join(path.delimiter);
  delete env.PATH;
  const linker = spawnSync('where.exe', ['link.exe'], { env, windowsHide: true, encoding: 'utf8' });
  if (linker.status === 0) return env;

  const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const msvcRoot = latestDirectory(path.join(programFilesX86, 'Microsoft Visual Studio', '2022', 'BuildTools', 'VC', 'Tools', 'MSVC'));
  const sdkRoot = path.join(programFilesX86, 'Windows Kits', '10');
  const sdkLib = latestDirectory(path.join(sdkRoot, 'Lib'), (name) => fs.existsSync(path.join(sdkRoot, 'Lib', name, 'um', 'x64', 'kernel32.lib')));
  if (!msvcRoot || !sdkLib) return env;
  const sdkVersion = path.basename(sdkLib);
  env.Path = [
    path.join(msvcRoot, 'bin', 'Hostx64', 'x64'),
    env.Path,
  ].filter(Boolean).join(path.delimiter);
  env.LIB = [
    path.join(msvcRoot, 'lib', 'x64'),
    path.join(sdkRoot, 'Lib', sdkVersion, 'um', 'x64'),
    path.join(sdkRoot, 'Lib', sdkVersion, 'ucrt', 'x64'),
  ].join(path.delimiter);
  env.INCLUDE = [
    path.join(msvcRoot, 'include'),
    path.join(sdkRoot, 'Include', sdkVersion, 'ucrt'),
    path.join(sdkRoot, 'Include', sdkVersion, 'shared'),
    path.join(sdkRoot, 'Include', sdkVersion, 'um'),
  ].join(path.delimiter);
  return env;
}

module.exports = { windowsRustEnvironment };
