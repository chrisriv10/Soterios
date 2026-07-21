const { exec } = require('child_process');
const util = require('util');
const si = require('systeminformation');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');
const i18n = require('../i18n');

class SystemAudit {
  constructor() {
    this.locale = 'en';
  }

  setLocale(locale) {
    this.locale = locale || 'en';
  }

  t(key, vars = {}) {
    return i18n.t(key, this.locale, vars);
  }

  async runPowerShell(script, timeoutMs = 15000) {
    try {
      const { stdout, stderr } = await execPromise(
        `powershell.exe -NoProfile -NonInteractive -Command "${script}"`,
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10 }
      );
      return { ok: true, stdout, stderr };
    } catch (e) {
      const timedOut = e.killed && e.signal === 'SIGTERM';
      return {
        ok: false,
        error: timedOut
          ? `Query timed out after ${timeoutMs}ms (Windows Update search can be slow — try again or check manually in Settings).`
          : (e.stderr && e.stderr.trim()) || e.message
      };
    }
  }

  async checkDefender() {
    const def = await this.runPowerShell(`Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AMEngineVersion, AntivirusSignatureVersion, AntivirusSignatureAge | ConvertTo-Json`);
    const out = [];
    if (def.ok) {
      try {
        const s = JSON.parse(def.stdout);
        if (s.AntivirusEnabled) {
          out.push({ name: 'Windows Defender Antivirus', status: 'pass', message: 'Defender antivirus is enabled and running.', detail: `Engine: ${s.AMEngineVersion || 'N/A'} | Signatures: ${s.AntivirusSignatureVersion || 'N/A'} (${s.AntivirusSignatureAge || 0} days old)`, recommendation: 'Keep Windows Update enabled for automatic definition updates.' });
        } else {
          out.push({ name: 'Windows Defender Antivirus', status: 'fail', message: 'Defender antivirus is disabled!', detail: 'Antivirus protection is turned off.', recommendation: 'Open Windows Security > Virus & threat protection and turn on real-time protection.' });
        }
        out.push({ name: 'Real-Time Protection', status: s.RealTimeProtectionEnabled ? 'pass' : 'fail', message: s.RealTimeProtectionEnabled ? 'Real-time protection is active.' : 'Real-time protection is off!', detail: s.RealTimeProtectionEnabled ? 'Threats are blocked as they appear.' : 'Your system is vulnerable to active threats.', recommendation: s.RealTimeProtectionEnabled ? '' : 'Enable real-time protection in Windows Security settings.' });
      } catch (e) {
        out.push({ name: 'Windows Defender', status: 'error', message: 'Could not parse Defender status.', detail: e.message });
      }
    } else {
      out.push({ name: 'Windows Defender', status: 'error', message: 'Failed to query Defender status.', detail: 'The Get-MpComputerStatus cmdlet may not be available on this system.' });
    }
    return out;
  }

  async checkUac() {
    const uac = await this.runPowerShell(`(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System').EnableLUA`);
    if (uac.ok) {
      const enabled = uac.stdout.trim() === '1';
      return [{
        name: 'User Account Control (UAC)', status: enabled ? 'pass' : 'fail',
        message: enabled ? 'UAC is enabled.' : 'UAC is disabled! This is a severe security risk.',
        detail: enabled ? 'UAC prompts before making system-level changes.' : 'All programs run with full administrator privileges.',
        recommendation: enabled ? '' : 'Enable UAC via Control Panel > User Accounts > Change User Account Control settings.'
      }];
    }
    return [{ name: 'User Account Control', status: 'error', message: 'Could not check UAC status.' }];
  }

  async checkWindowsUpdate() {
    // Primary: COM query (comprehensive but may include driver/optional updates)
    const up = await this.runPowerShell(`$session = New-Object -ComObject Microsoft.Update.Session -ErrorAction Stop; $searcher = $session.CreateUpdateSearcher(); $pending = $searcher.Search('IsInstalled=0 and IsHidden=0 and Type=\'Software\''); $pending.Updates.Count`, 90000);
    if (up.ok) {
      const raw = up.stdout.trim();
      const count = /^[0-9]+$/.test(raw) ? Number(raw) : null;
      if (count === null) {
        return [{ name: 'Windows Updates', status: 'warn', message: 'Could not parse update status.', detail: raw || 'Unexpected response from Windows Update query.', recommendation: 'Check Windows Update in Settings manually.' }];
      } else if (count === 0) {
        return [{ name: 'Windows Updates', status: 'pass', message: 'No pending updates.', detail: 'All available updates are installed.', recommendation: 'Keep automatic updates enabled.' }];
      }
      return [{ name: 'Windows Updates', status: 'warn', message: `${count} update(s) pending.`, detail: `${count} update(s) are waiting to be installed.`, recommendation: 'Open Settings > Windows Update and install pending updates.' }];
    }
    // Fallback: Try WU API via UsoClient for basic status
    const fallback = await this.runPowerShell(`try { $session = New-Object -ComObject Microsoft.Update.Session -ErrorAction Stop; $searcher = $session.CreateUpdateSearcher(); $result = $searcher.Search('IsInstalled=0 and IsHidden=0'); $result.Updates.Count } catch { '_ERROR_' }`, 30000);
    if (fallback.ok) {
      const raw = fallback.stdout.trim();
      if (raw === '_ERROR_') {
        // Explicit error sentinel - fall through to warning
      } else {
        const count = /^[0-9]+$/.test(raw) ? Number(raw) : null;
        if (count !== null && count === 0) {
          return [{ name: 'Windows Updates', status: 'pass', message: 'No pending updates.', detail: 'All available updates are installed.', recommendation: 'Keep automatic updates enabled.' }];
        } else if (count !== null && count > 0) {
          return [{ name: 'Windows Updates', status: 'warn', message: `${count} update(s) pending.`, detail: `${count} update(s) are waiting to be installed.`, recommendation: 'Open Settings > Windows Update and install pending updates.' }];
        }
      }
    }
    return [{ name: 'Windows Updates', status: 'warn', message: 'Could not query update status.', detail: up.error || 'Windows Update may be disabled or the COM query timed out.', recommendation: 'Check Windows Update in Settings manually.' }];
  }

  async checkBitLocker() {
    const bl = await this.runPowerShell(`Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop | Select-Object ProtectionStatus | ConvertTo-Json`);
    if (bl.ok) {
      try {
        const parsed = JSON.parse(bl.stdout || 'null');
        const b = Array.isArray(parsed) ? parsed.find((item) => item && typeof item.ProtectionStatus !== 'undefined') : parsed;
        const statusValue = b && typeof b.ProtectionStatus !== 'undefined' ? b.ProtectionStatus : null;
        if (statusValue === 1) {
          return [{
            name: 'BitLocker Drive Encryption', status: 'pass',
            message: 'System drive is encrypted.',
            detail: 'Your data is protected if the device is lost or stolen.',
            recommendation: ''
          }];
        } else if (statusValue === 0 || statusValue === null) {
          return [{
            name: 'BitLocker Drive Encryption', status: 'warn',
            message: statusValue === 0 ? 'System drive is NOT encrypted.' : 'BitLocker status unavailable.',
            detail: statusValue === 0 ? 'Anyone with physical access can read your data.' : 'Could not determine BitLocker protection status.',
            recommendation: 'Enable BitLocker via Control Panel > BitLocker Drive Encryption.'
          }];
        }
        return [{
          name: 'BitLocker Drive Encryption', status: 'warn',
          message: 'BitLocker status could not be determined.',
          detail: 'Unexpected BitLocker response format.',
          recommendation: 'Check BitLocker status in Windows settings.'
        }];
      } catch (e) {
        return [{ name: 'BitLocker', status: 'info', message: 'BitLocker status unavailable (may not be supported on this edition).', detail: 'BitLocker requires Windows Pro or Enterprise.' }];
      }
    }
    return [{ name: 'BitLocker', status: 'info', message: 'BitLocker is not available on this system.', detail: 'Requires Windows Pro/Enterprise and a TPM chip.' }];
  }

  async checkExecutionPolicy() {
    const ep = await this.runPowerShell(`try { (Get-ExecutionPolicy -Scope LocalMachine -ErrorAction Stop).ToString() } catch { '' }`);
    if (ep.ok) {
      const policy = ep.stdout.trim();
      const securePolicies = ['Restricted', 'RemoteSigned', 'AllSigned'];
      const pass = securePolicies.includes(policy);
      return [{
        name: 'PowerShell Execution Policy', status: pass ? 'pass' : 'warn',
        message: policy ? `Policy: ${policy}` : 'Policy could not be determined.',
        detail: pass ? 'Only signed or locally authored scripts can run.' : 'Less restrictive execution policy may allow untrusted scripts.',
        recommendation: pass ? '' : 'Consider setting to RemoteSigned: Set-ExecutionPolicy RemoteSigned -Scope LocalMachine'
      }];
    }
    return [{ name: 'PowerShell Execution Policy', status: 'warn', message: 'PowerShell execution policy query failed.', detail: ep.error || 'Unable to query execution policy.', recommendation: 'Check execution policy with Get-ExecutionPolicy -List in PowerShell.' }];
  }

  async checkSecureBoot() {
    const sb = await this.runPowerShell(`Confirm-SecureBootUEFI`);
    if (sb.ok) {
      const enabled = sb.stdout.trim() === 'True';
      return [{
        name: 'Secure Boot', status: enabled ? 'pass' : 'fail',
        message: enabled ? 'Secure Boot is enabled.' : 'Secure Boot is disabled!',
        detail: enabled ? 'Only trusted bootloaders can run during system startup.' : 'System is vulnerable to bootkit attacks.',
        recommendation: enabled ? '' : 'Enable Secure Boot in your UEFI/BIOS firmware settings.'
      }];
    }
    return [{ name: 'Secure Boot', status: 'info', message: 'Secure Boot status could not be determined.', detail: 'This check may not be supported on virtual machines or older hardware.' }];
  }

  async runAudit(onProgress) {
    // All six checks are independent of each other, so run them concurrently
    // instead of sequentially. Each PowerShell spawn has significant cold-start
    // overhead (loading the .NET runtime) on top of the actual query time --
    // running sequentially meant paying that overhead six times in a row.
    // Total time now converges toward whichever single check takes longest
    // (Windows Update, up to 90s worst case) instead of the sum of all six.
    //
    // Progress is centralized here rather than each check method calling
    // onProgress internally, so a real completed/total fraction can be
    // reported (not just "this check started") -- since checks run in
    // parallel, there's no single "step 3 of 6" sequence otherwise.
    const checks = [
      { label: 'Windows Defender', run: () => this.checkDefender() },
      { label: 'User Account Control (UAC)', run: () => this.checkUac() },
      { label: 'Windows Update', run: () => this.checkWindowsUpdate() },
      { label: 'BitLocker', run: () => this.checkBitLocker() },
      { label: 'PowerShell execution policy', run: () => this.checkExecutionPolicy() },
      { label: 'Secure Boot', run: () => this.checkSecureBoot() }
    ];

    const total = checks.length;
    let completed = 0;

    const runOne = async (check) => {
      onProgress?.({ type: 'start', label: check.label, completed, total });
      const result = await check.run();
      completed++;
      onProgress?.({ type: 'complete', label: check.label, completed, total });
      return result;
    };

    const [
      defenderResults,
      uacResult,
      updateResult,
      bitlockerResult,
      epResult,
      secureBootResult
    ] = await Promise.all(checks.map(runOne));

    // Flatten in the same order the UI has always displayed results in, even
    // though execution order is now concurrent rather than sequential.
    return [
      ...defenderResults,
      ...uacResult,
      ...updateResult,
      ...bitlockerResult,
      ...epResult,
      ...secureBootResult
    ];
  }
}

module.exports = SystemAudit;