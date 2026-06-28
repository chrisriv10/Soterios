const { exec } = require('child_process');
const util = require('util');
const si = require('systeminformation');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');

class SystemAudit {
  async runPowerShell(script) {
    try {
      const { stdout } = await execPromise(`powershell.exe -NoProfile -NonInteractive -Command "${script}"`, { timeout: 15000 });
      return { ok: true, stdout };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async runAudit() {
    const results = [];

    // 1. Windows Defender
    const def = await this.runPowerShell(`Get-MpComputerStatus | Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled, AMEngineVersion, AntivirusSignatureVersion, AntivirusSignatureAge | ConvertTo-Json`);
    if (def.ok) {
      try {
        const s = JSON.parse(def.stdout);
        if (s.AntivirusEnabled) {
          results.push({ name: 'Windows Defender Antivirus', status: 'pass', message: 'Defender antivirus is enabled and running.', detail: `Engine: ${s.AMEngineVersion || 'N/A'} | Signatures: ${s.AntivirusSignatureVersion || 'N/A'} (${s.AntivirusSignatureAge || 0} days old)`, recommendation: 'Keep Windows Update enabled for automatic definition updates.' });
        } else {
          results.push({ name: 'Windows Defender Antivirus', status: 'fail', message: 'Defender antivirus is disabled!', detail: 'Antivirus protection is turned off.', recommendation: 'Open Windows Security > Virus & threat protection and turn on real-time protection.' });
        }
        results.push({ name: 'Real-Time Protection', status: s.RealTimeProtectionEnabled ? 'pass' : 'fail', message: s.RealTimeProtectionEnabled ? 'Real-time protection is active.' : 'Real-time protection is off!', detail: s.RealTimeProtectionEnabled ? 'Threats are blocked as they appear.' : 'Your system is vulnerable to active threats.', recommendation: s.RealTimeProtectionEnabled ? '' : 'Enable real-time protection in Windows Security settings.' });
      } catch (e) {
        results.push({ name: 'Windows Defender', status: 'error', message: 'Could not parse Defender status.', detail: e.message });
      }
    } else {
      results.push({ name: 'Windows Defender', status: 'error', message: 'Failed to query Defender status.', detail: 'The Get-MpComputerStatus cmdlet may not be available on this system.' });
    }

    // 2. UAC
    const uac = await this.runPowerShell(`(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System').EnableLUA`);
    if (uac.ok) {
      const enabled = uac.stdout.trim() === '1';
      results.push({
        name: 'User Account Control (UAC)', status: enabled ? 'pass' : 'fail',
        message: enabled ? 'UAC is enabled.' : 'UAC is disabled! This is a severe security risk.',
        detail: enabled ? 'UAC prompts before making system-level changes.' : 'All programs run with full administrator privileges.',
        recommendation: enabled ? '' : 'Enable UAC via Control Panel > User Accounts > Change User Account Control settings.'
      });
    } else {
      results.push({ name: 'User Account Control', status: 'error', message: 'Could not check UAC status.' });
    }

    // 3. Windows Update status
    const up = await this.runPowerShell(`$session = New-Object -ComObject Microsoft.Update.Session -ErrorAction Stop; $searcher = $session.CreateUpdateSearcher(); $pending = $searcher.Search('IsInstalled=0 and IsHidden=0'); $pending.Updates.Count`);
    if (up.ok) {
      const raw = up.stdout.trim();
      const count = /^[0-9]+$/.test(raw) ? Number(raw) : null;
      if (count === null) {
        results.push({ name: 'Windows Updates', status: 'warn', message: 'Could not parse update status.', detail: raw || 'Unexpected response from Windows Update query.', recommendation: 'Check Windows Update in Settings manually.' });
      } else if (count === 0) {
        results.push({ name: 'Windows Updates', status: 'pass', message: 'No pending updates.', detail: 'All available updates are installed.', recommendation: 'Keep automatic updates enabled.' });
      } else {
        results.push({ name: 'Windows Updates', status: 'warn', message: `${count} update(s) pending.`, detail: `${count} update(s) are waiting to be installed.`, recommendation: 'Open Settings > Windows Update and install pending updates.' });
      }
    } else {
      results.push({ name: 'Windows Updates', status: 'warn', message: 'Could not query update status.', detail: up.error || 'Windows Update may be disabled or the COM query timed out.', recommendation: 'Check Windows Update in Settings manually.' });
    }

    // 4. BitLocker
    const bl = await this.runPowerShell(`Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop | Select-Object ProtectionStatus | ConvertTo-Json`);
    if (bl.ok) {
      try {
        const parsed = JSON.parse(bl.stdout || 'null');
        const b = Array.isArray(parsed) ? parsed.find((item) => item && typeof item.ProtectionStatus !== 'undefined') : parsed;
        const statusValue = b && typeof b.ProtectionStatus !== 'undefined' ? b.ProtectionStatus : null;
        if (statusValue === 1) {
          results.push({
            name: 'BitLocker Drive Encryption', status: 'pass',
            message: 'System drive is encrypted.',
            detail: 'Your data is protected if the device is lost or stolen.',
            recommendation: ''
          });
        } else if (statusValue === 0 || statusValue === null) {
          results.push({
            name: 'BitLocker Drive Encryption', status: 'warn',
            message: statusValue === 0 ? 'System drive is NOT encrypted.' : 'BitLocker status unavailable.',
            detail: statusValue === 0 ? 'Anyone with physical access can read your data.' : 'Could not determine BitLocker protection status.',
            recommendation: 'Enable BitLocker via Control Panel > BitLocker Drive Encryption.'
          });
        } else {
          results.push({
            name: 'BitLocker Drive Encryption', status: 'warn',
            message: 'BitLocker status could not be determined.',
            detail: 'Unexpected BitLocker response format.',
            recommendation: 'Check BitLocker status in Windows settings.'
          });
        }
      } catch (e) {
        results.push({ name: 'BitLocker', status: 'info', message: 'BitLocker status unavailable (may not be supported on this edition).', detail: 'BitLocker requires Windows Pro or Enterprise.' });
      }
    } else {
      results.push({ name: 'BitLocker', status: 'info', message: 'BitLocker is not available on this system.', detail: 'Requires Windows Pro/Enterprise and a TPM chip.' });
    }

    // 5. PowerShell Execution Policy
    const ep = await this.runPowerShell(`try { (Get-ExecutionPolicy -Scope LocalMachine -ErrorAction Stop).ToString() } catch { '' }`);
    if (ep.ok) {
      const policy = ep.stdout.trim();
      const securePolicies = ['Restricted', 'RemoteSigned', 'AllSigned'];
      const pass = securePolicies.includes(policy);
      results.push({
        name: 'PowerShell Execution Policy', status: pass ? 'pass' : 'warn',
        message: policy ? `Policy: ${policy}` : 'Policy could not be determined.',
        detail: pass ? 'Only signed or locally authored scripts can run.' : 'Less restrictive execution policy may allow untrusted scripts.',
        recommendation: pass ? '' : 'Consider setting to RemoteSigned: Set-ExecutionPolicy RemoteSigned -Scope LocalMachine'
      });
    } else {
      results.push({ name: 'PowerShell Execution Policy', status: 'warn', message: 'PowerShell execution policy query failed.', detail: ep.error || 'Unable to query execution policy.', recommendation: 'Check execution policy with Get-ExecutionPolicy -List in PowerShell.' });
    }

    // 6. Secure Boot status
    const sb = await this.runPowerShell(`Confirm-SecureBootUEFI`);
    if (sb.ok) {
      const enabled = sb.stdout.trim() === 'True';
      results.push({
        name: 'Secure Boot', status: enabled ? 'pass' : 'fail',
        message: enabled ? 'Secure Boot is enabled.' : 'Secure Boot is disabled!',
        detail: enabled ? 'Only trusted bootloaders can run during system startup.' : 'System is vulnerable to bootkit attacks.',
        recommendation: enabled ? '' : 'Enable Secure Boot in your UEFI/BIOS firmware settings.'
      });
    } else {
      results.push({ name: 'Secure Boot', status: 'info', message: 'Secure Boot status could not be determined.', detail: 'This check may not be supported on virtual machines or older hardware.' });
    }

    return results;
  }
}

module.exports = SystemAudit;
