'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  parseUninstallCommand,
  validateUninstallLaunch
} = require('../src/scripts/safeScripts/uninstallLaunchUtils');

describe('uninstallLaunchUtils', () => {
  it('parses quoted uninstall commands', () => {
    const parsed = parseUninstallCommand('"C:\\Program Files\\App\\uninstall.exe" /S');
    assert.equal(parsed.exe, 'C:\\Program Files\\App\\uninstall.exe');
    assert.deepEqual(parsed.args, ['/S']);
  });

  it('parses unquoted uninstall commands with spaces in the path', () => {
    const parsed = parseUninstallCommand('C:\\Program Files\\App\\uninstall.exe /S');
    assert.equal(parsed.exe, 'C:\\Program Files\\App\\uninstall.exe');
    assert.deepEqual(parsed.args, ['/S']);
  });

  it('strips embedded newlines from uninstall strings', () => {
    const parsed = parseUninstallCommand('msiexec.exe /x\r\n{GUID}');
    assert.equal(parsed.exe, 'msiexec.exe');
  });

  it('accepts bare msiexec uninstall commands', () => {
    const parsed = parseUninstallCommand('MsiExec.exe /X{12345678-1234-1234-1234-123456789012}');
    const result = validateUninstallLaunch(parsed);
    assert.equal(result.ok, true);
    assert.match(result.parsed.exe.toLowerCase(), /system32\\msiexec\.exe$/);
  });

  it('rejects msiexec install flags', () => {
    const parsed = parseUninstallCommand('C:\\Windows\\System32\\msiexec.exe /i package.msi');
    const result = validateUninstallLaunch(parsed);
    assert.equal(result.ok, false);
  });

  it('rejects shell-based uninstall launchers', () => {
    const parsed = parseUninstallCommand('C:\\Windows\\System32\\cmd.exe /c del /f /q malware.exe');
    const result = validateUninstallLaunch(parsed);
    assert.equal(result.ok, false);
  });

  it('rejects other System32 living-off-the-land hosts', () => {
    const parsed = parseUninstallCommand('C:\\Windows\\System32\\mshta.exe javascript:alert(1)');
    const result = validateUninstallLaunch(parsed);
    assert.equal(result.ok, false);
  });

  it('rejects executables outside trusted install roots', () => {
    const parsed = parseUninstallCommand('C:\\Temp\\evil.exe /uninstall');
    const result = validateUninstallLaunch(parsed);
    assert.equal(result.ok, false);
  });

  it('rejects executables under LocalAppData outside Programs', () => {
    const tempExe = path.win32.join(process.env.LOCALAPPDATA || 'C:\\Users\\Example\\AppData\\Local', 'Temp', 'evil.exe');
    const parsed = parseUninstallCommand(`"${tempExe}" /uninstall`);
    const result = validateUninstallLaunch(parsed);
    assert.equal(result.ok, false);
  });

  it('accepts rundll32 commands with comma-separated entry points', () => {
    const dllPath = path.win32.join(process.env.ProgramFiles || 'C:\\Program Files', 'Example', 'uninstall.dll');
    const parsed = parseUninstallCommand(`C:\\Windows\\System32\\rundll32.exe "${dllPath},LaunchINFSection"`);
    const result = validateUninstallLaunch(parsed);
    assert.equal(result.ok, false);
    assert.match(result.error, /not found|not allowed/);
  });

  it('allows per-user install roots under LocalAppData', () => {
    const localPrograms = path.win32.join(process.env.LOCALAPPDATA || 'C:\\Users\\Example\\AppData\\Local', 'Programs', 'Example', 'uninstall.exe');
    const parsed = parseUninstallCommand(`"${localPrograms}" /currentuser`);
    const result = validateUninstallLaunch(parsed);
    assert.equal(result.ok, false);
    assert.match(result.error, /not found|not allowed/);
  });
});
