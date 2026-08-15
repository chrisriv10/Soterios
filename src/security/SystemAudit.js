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

  async runPowerShell(script, timeoutMs = 30000) {
    try {
      // Try both -Command and -ExecutionPolicy Bypass to ensure execution
      const { stdout, stderr } = await execPromise(
        `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script}"`,
        { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10 }
      );
      if (stderr && stderr.trim()) {
        console.warn(`PowerShell stderr for script: ${script.substring(0, 80)}...`, stderr);
      }
      return { ok: true, stdout, stderr };
    } catch (e) {
      const timedOut = e.killed && e.signal === 'SIGTERM';
      const errorDetails = (e.stderr && e.stderr.trim()) || e.message || String(e);
      console.error(`PowerShell execution failed for script: ${script.substring(0, 100)}... Error:`, errorDetails);
      console.error('Full error object:', e);
      return {
        ok: false,
        error: timedOut
          ? `Query timed out after ${timeoutMs}ms (Windows Update search can be slow — try again or check manually in Settings).`
          : errorDetails
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
          out.push({ name: 'Windows Defender Antivirus', section: 'antivirus', status: 'pass', message: 'Defender antivirus is enabled and running.', detail: `Engine: ${s.AMEngineVersion || 'N/A'} | Signatures: ${s.AntivirusSignatureVersion || 'N/A'} (${s.AntivirusSignatureAge || 0} days old)`, recommendation: '', actionUri: 'ms-settings:windowsdefender' });
        } else {
          out.push({ name: 'Windows Defender Antivirus', section: 'antivirus', status: 'fail', message: 'Defender antivirus is disabled!', detail: 'Antivirus protection is turned off.', recommendation: 'Open Windows Security > Virus & threat protection and turn on real-time protection.', actionUri: 'ms-settings:windowsdefender' });
        }
        out.push({ name: 'Real-Time Protection', section: 'antivirus', status: s.RealTimeProtectionEnabled ? 'pass' : 'fail', message: s.RealTimeProtectionEnabled ? 'Real-time protection is active.' : 'Real-time protection is off!', detail: s.RealTimeProtectionEnabled ? 'Threats are blocked as they appear.' : 'Your system is vulnerable to active threats.', recommendation: s.RealTimeProtectionEnabled ? '' : 'Enable real-time protection in Windows Security settings.', actionUri: 'ms-settings:windowsdefender' });
      } catch (e) {
        out.push({ name: 'Windows Defender', section: 'antivirus', status: 'error', message: 'Could not parse Defender status.', detail: e.message, actionUri: 'ms-settings:windowsdefender' });
      }
    } else {
      out.push({ name: 'Windows Defender', section: 'antivirus', status: 'error', message: 'Failed to query Defender status.', detail: 'The Get-MpComputerStatus cmdlet may not be available on this system.', actionUri: 'ms-settings:windowsdefender' });
    }
    return out;
  }

  async checkUac() {
    const uac = await this.runPowerShell(`(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System').EnableLUA`);
    if (uac.ok) {
      const enabled = uac.stdout.trim() === '1';
      return [{
        name: 'User Account Control (UAC)', section: 'system', status: enabled ? 'pass' : 'fail',
        message: enabled ? 'UAC is enabled.' : 'UAC is disabled! This is a severe security risk.',
        detail: enabled ? 'UAC prompts before making system-level changes.' : 'All programs run with full administrator privileges.',
        recommendation: enabled ? '' : 'Enable UAC via Control Panel > User Accounts > Change User Account Control settings.',
        actionUri: 'control userpasswords2'
      }];
    }
    return [{ name: 'User Account Control', section: 'system', status: 'error', message: 'Could not check UAC status.', actionUri: 'control userpasswords2' }];
  }

  async checkWindowsUpdate() {
    // Primary: COM query - filter to MANDATORY updates only (matching Windows Settings behavior)
    // Windows Settings only shows mandatory updates by default; optional/driver/preview updates are hidden
    const up = await this.runPowerShell(`$session = New-Object -ComObject Microsoft.Update.Session -ErrorAction Stop; $searcher = $session.CreateUpdateSearcher(); $pending = $searcher.Search('IsInstalled=0 and IsHidden=0'); $mandatory = $pending.Updates | Where-Object { $_.IsMandatory -eq \$true }; $mandatory.Count`, 90000);
    if (up.ok) {
      const raw = up.stdout.trim();
      const count = /^[0-9]+$/.test(raw) ? Number(raw) : null;
      if (count === null) {
        return [{ name: 'Windows Updates', section: 'updates', status: 'warn', message: 'Could not parse update status.', detail: raw || 'Unexpected response from Windows Update query.', recommendation: 'Check Windows Update in Settings manually.', actionUri: 'ms-settings:windowsupdate' }];
      } else if (count === 0) {
        return [{ name: 'Windows Updates', section: 'updates', status: 'pass', message: 'No pending updates.', detail: 'All mandatory updates are installed.', recommendation: '', actionUri: 'ms-settings:windowsupdate' }];
      }
      return [{ name: 'Windows Updates', section: 'updates', status: 'warn', message: `${count} mandatory update(s) pending.`, detail: `${count} mandatory update(s) are waiting to be installed.`, recommendation: 'Open Settings > Windows Update and install pending updates.', actionUri: 'ms-settings:windowsupdate' }];
    }
    // Fallback: Try WU API via UsoClient for basic status
    const fallback = await this.runPowerShell(`try { $session = New-Object -ComObject Microsoft.Update.Session -ErrorAction Stop; $searcher = $session.CreateUpdateSearcher(); $result = $searcher.Search('IsInstalled=0 and IsHidden=0'); $mandatory = $result.Updates | Where-Object { $_.IsMandatory -eq \$true }; $mandatory.Count } catch { '_ERROR_' }`, 30000);
    if (fallback.ok) {
      const raw = fallback.stdout.trim();
      if (raw === '_ERROR_') {
        // Explicit error sentinel - fall through to warning
      } else {
        const count = /^[0-9]+$/.test(raw) ? Number(raw) : null;
        if (count !== null && count === 0) {
          return [{ name: 'Windows Updates', section: 'updates', status: 'pass', message: 'No pending updates.', detail: 'All mandatory updates are installed.', recommendation: '', actionUri: 'ms-settings:windowsupdate' }];
        } else if (count !== null && count > 0) {
          return [{ name: 'Windows Updates', section: 'updates', status: 'warn', message: `${count} mandatory update(s) pending.`, detail: `${count} mandatory update(s) are waiting to be installed.`, recommendation: 'Open Settings > Windows Update and install pending updates.', actionUri: 'ms-settings:windowsupdate' }];
        }
      }
    }
    // Sanitize error - don't expose raw PowerShell/COM errors to user
    const friendlyError = this.sanitizeWindowsUpdateError(up.error);
    return [{ name: 'Windows Updates', section: 'updates', status: 'warn', message: 'Could not query update status.', detail: friendlyError, recommendation: 'Check Windows Update in Settings manually.', actionUri: 'ms-settings:windowsupdate' }];
  }

  sanitizeWindowsUpdateError(rawError) {
    if (!rawError) return 'Windows Update may be disabled or the COM query timed out.';
    const err = String(rawError);
    // PowerShell parser errors
    if (err.includes('At line') && err.includes('char:')) return 'Windows Update query failed — the update service may be busy or temporarily unavailable.';
    // COM errors
    if (err.includes('0x8007') || err.includes('0x8024') || err.includes('HRESULT')) return 'Windows Update service returned an error. The service may be disabled or corrupted.';
    if (err.includes('Microsoft.Update.Session') || err.includes('CreateUpdateSearcher')) return 'Could not connect to Windows Update service. It may be disabled or not running.';
    if (err.includes('timeout') || err.includes('timed out')) return 'Windows Update query timed out. The service may be busy.';
    // Generic fallback
    return 'Unable to check Windows Update status. Please check manually in Settings > Windows Update.';
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
            name: 'BitLocker Drive Encryption', section: 'system', status: 'pass',
            message: 'System drive is encrypted.',
            detail: 'Your data is protected if the device is lost or stolen.',
            recommendation: '',
            actionUri: 'control /name Microsoft.BitLockerDriveEncryption'
          }];
        } else if (statusValue === 0 || statusValue === null) {
          return [{
            name: 'BitLocker Drive Encryption', section: 'system', status: 'warn',
            message: statusValue === 0 ? 'System drive is NOT encrypted.' : 'BitLocker status unavailable.',
            detail: statusValue === 0 ? 'Anyone with physical access can read your data.' : 'Could not determine BitLocker protection status.',
            recommendation: 'Enable BitLocker via Control Panel > BitLocker Drive Encryption.',
            actionUri: 'control /name Microsoft.BitLockerDriveEncryption'
          }];
        }
        return [{
          name: 'BitLocker Drive Encryption', section: 'system', status: 'warn',
          message: 'BitLocker status could not be determined.',
          detail: 'Unexpected BitLocker response format.',
          recommendation: 'Check BitLocker status in Windows settings.',
          actionUri: 'control /name Microsoft.BitLockerDriveEncryption'
        }];
      } catch (e) {
        return [{ name: 'BitLocker', section: 'system', status: 'info', message: 'BitLocker status unavailable (may not be supported on this edition).', detail: 'BitLocker requires Windows Pro or Enterprise.', actionUri: 'control /name Microsoft.BitLockerDriveEncryption' }];
      }
    }
    return [{ name: 'BitLocker', section: 'system', status: 'info', message: 'BitLocker is not available on this system.', detail: 'Requires Windows Pro/Enterprise and a TPM chip.', actionUri: 'control /name Microsoft.BitLockerDriveEncryption' }];
  }

  async checkExecutionPolicy() {
    const ep = await this.runPowerShell(`try { (Get-ExecutionPolicy -Scope LocalMachine -ErrorAction Stop).ToString() } catch { '' }`);
    if (ep.ok) {
      const policy = ep.stdout.trim();
      const securePolicies = ['Restricted', 'RemoteSigned', 'AllSigned'];
      const pass = securePolicies.includes(policy);
      return [{
        name: 'PowerShell Execution Policy', section: 'updates', status: pass ? 'pass' : 'warn',
        message: policy ? `Policy: ${policy}` : 'Policy could not be determined.',
        detail: pass ? 'Only signed or locally authored scripts can run.' : 'Less restrictive execution policy may allow untrusted scripts.',
        recommendation: pass ? '' : 'Consider setting to RemoteSigned: Set-ExecutionPolicy RemoteSigned -Scope LocalMachine',
        manageAction: 'open-powershell'
      }];
    }
    return [{ name: 'PowerShell Execution Policy', section: 'updates', status: 'warn', message: 'PowerShell execution policy query failed.', detail: ep.error || 'Unable to query execution policy.', recommendation: 'Check execution policy with Get-ExecutionPolicy -List in PowerShell.', manageAction: 'open-powershell' }];
  }

  async checkSecureBoot() {
    const sb = await this.runPowerShell(`Confirm-SecureBootUEFI`);
    if (sb.ok) {
      const enabled = sb.stdout.trim() === 'True';
      return [{
        name: 'Secure Boot', section: 'system', status: enabled ? 'pass' : 'fail',
        message: enabled ? 'Secure Boot is enabled.' : 'Secure Boot is disabled!',
        detail: enabled ? 'Only trusted bootloaders can run during system startup.' : 'System is vulnerable to bootkit attacks.',
        recommendation: enabled ? '' : 'Enable Secure Boot in your UEFI/BIOS firmware settings.',
        actionUri: 'ms-settings:recovery'
      }];
    }
    return [{ name: 'Secure Boot', section: 'system', status: 'info', message: 'Secure Boot status could not be determined.', detail: 'This check may not be supported on virtual machines or older hardware.', actionUri: 'ms-settings:recovery' }];
  }

  async checkDefenderHardening() {
    const h = await this.runPowerShell(`$pref = Get-MpPreference -ErrorAction SilentlyContinue; $status = Get-MpComputerStatus -ErrorAction SilentlyContinue; $cloud = if ($pref -and $pref.PSObject.Properties.Name -contains 'MAPSReporting' -and $null -ne $pref.MAPSReporting) { [int]$pref.MAPSReporting } else { $null }; $netFromPref = if ($pref -and $pref.PSObject.Properties.Name -contains 'EnableNetworkProtection') { $pref.EnableNetworkProtection } else { $null }; $netFromReg = $null; try { $regVal = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows Defender\\Windows Defender Exploit Guard\\Network Protection' -ErrorAction Stop).EnableNetworkProtection; if ($null -ne $regVal) { $netFromReg = [int]$regVal } } catch { }; function Get-NetMode([object]$val) { if ($null -eq $val) { return 'unknown' }; if ($val -is [bool]) { if ($val) { return 'block' } else { return 'off' } }; if ($val -is [string]) { switch ($val.Trim().ToLower()) { '1' { return 'block' } 'true' { return 'block' } 'enabled' { return 'block' } '2' { return 'audit' } '0' { return 'off' } 'false' { return 'off' } 'disabled' { return 'off' } default { return 'unknown' } } }; $n = 0; if ($val -is [int] -or $val -is [long] -or $val -is [double] -or $val -is [decimal]) { $n = [int]$val } else { return 'unknown' }; if ($n -eq 1) { return 'block' }; if ($n -eq 2) { return 'audit' }; if ($n -eq 0) { return 'off' }; return 'unknown' }; $netMode = Get-NetMode $netFromPref; if ($netMode -eq 'unknown') { $netMode = Get-NetMode $netFromReg }; $tamper = if ($status) { [bool]$status.IsTamperProtected } else { $null }; [PSCustomObject]@{ tamperProtected = $tamper; cloudProtectionLevel = $cloud; networkProtectionMode = $netMode } | ConvertTo-Json -Depth 6`);
    const errorRow = (name) => ({
      name, section: 'antivirus', status: 'error',
      message: 'Could not query Defender hardening settings.',
      detail: h.error || 'The Get-MpPreference cmdlet may not be available on this system.',
      actionUri: 'ms-settings:windowsdefender'
    });
    if (!h.ok) {
      return [
        errorRow('Tamper Protection'),
        errorRow('Cloud-delivered Protection'),
        errorRow('Network Protection')
      ];
    }
    let data;
    try { data = JSON.parse(h.stdout); } catch (e) { data = null; }
    if (!data) {
      return [
        errorRow('Tamper Protection'),
        errorRow('Cloud-delivered Protection'),
        errorRow('Network Protection')
      ];
    }
    const out = [];
    if (data.tamperProtected === true) {
      out.push({ name: 'Tamper Protection', section: 'antivirus', status: 'pass', message: 'Tamper protection is enabled.', detail: 'Malware cannot disable Defender protections.', recommendation: '', actionUri: 'ms-settings:windowsdefender' });
    } else if (data.tamperProtected === false) {
      out.push({ name: 'Tamper Protection', section: 'antivirus', status: 'fail', message: 'Tamper protection is off!', detail: 'Malware can disable Defender protections without warning.', recommendation: 'Enable tamper protection in Windows Security > Virus & threat protection > Manage settings.', actionUri: 'ms-settings:windowsdefender' });
    } else {
      out.push({ name: 'Tamper Protection', section: 'antivirus', status: 'info', message: 'Tamper protection status could not be determined.', detail: 'This check may not be supported on this system.', actionUri: 'ms-settings:windowsdefender' });
    }
    if (Number(data.cloudProtectionLevel) > 0) {
      out.push({ name: 'Cloud-delivered Protection', section: 'antivirus', status: 'pass', message: 'Cloud-delivered protection is active.', detail: 'New threats are blocked using up-to-the-minute cloud intelligence.', recommendation: '', actionUri: 'ms-settings:windowsdefender' });
    } else if (data.cloudProtectionLevel === 0) {
      out.push({ name: 'Cloud-delivered Protection', section: 'antivirus', status: 'fail', message: 'Cloud-delivered protection is off!', detail: 'Protection relies only on locally installed signatures.', recommendation: 'Turn on cloud-delivered protection in Windows Security > Virus & threat protection > Manage settings.', actionUri: 'ms-settings:windowsdefender' });
    } else {
      out.push({ name: 'Cloud-delivered Protection', section: 'antivirus', status: 'info', message: 'Cloud-delivered protection status could not be determined.', detail: 'This setting may not be reported on this system.', actionUri: 'ms-settings:windowsdefender' });
    }
    if (data.networkProtectionMode === 'block') {
      out.push({ name: 'Network Protection', section: 'antivirus', status: 'pass', message: 'Network protection is on.', detail: 'Malicious connections and phishing sites are blocked.', recommendation: '', actionUri: 'ms-settings:windowsdefender' });
    } else if (data.networkProtectionMode === 'audit') {
      out.push({ name: 'Network Protection', section: 'antivirus', status: 'info', message: 'Network protection is in audit mode.', detail: 'Malicious connections are logged but not blocked.', recommendation: 'Enable block mode in Windows Security > App & browser control.', actionUri: 'ms-settings:windowsdefender' });
    } else if (data.networkProtectionMode === 'off') {
      out.push({ name: 'Network Protection', section: 'antivirus', status: 'fail', message: 'Network protection is off!', detail: 'Malicious network connections are not blocked.', recommendation: 'Enable network protection in Windows Security > App & browser control.', actionUri: 'ms-settings:windowsdefender' });
    } else {
      out.push({ name: 'Network Protection', section: 'antivirus', status: 'info', message: 'Network protection status could not be determined.', detail: 'Windows did not report a network protection state.', actionUri: 'ms-settings:windowsdefender' });
    }
    return out;
  }

  async checkSmb1() {
    const r = await this.runPowerShell(`$p = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' -ErrorAction SilentlyContinue; if ($p -and $p.PSObject.Properties.Name -contains 'SMB1') { [string]$p.SMB1 } else { $null }`);
    if (r.ok) {
      const v = r.stdout.trim();
      if (v === '0') {
        return [{ name: 'SMBv1', section: 'system', status: 'pass', message: 'SMBv1 is disabled.', detail: 'The legacy SMBv1 protocol with known wormable vulnerabilities is off.', recommendation: '', actionUri: 'control /name Microsoft.WindowsOptionalFeatures' }];
      }
      if (v === '1') {
        return [{ name: 'SMBv1', section: 'system', status: 'fail', message: 'SMBv1 is enabled!', detail: 'SMBv1 has known wormable vulnerabilities (WannaCry, SMBGhost).', recommendation: 'Disable SMBv1: Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart', actionUri: 'control /name Microsoft.WindowsOptionalFeatures' }];
      }
      return [{ name: 'SMBv1', section: 'system', status: 'warn', message: 'SMBv1 may be enabled.', detail: 'Could not confirm SMBv1 is disabled — it may be enabled by default.', recommendation: 'Check SMBv1 status: Get-SmbServerConfiguration | Select SMB1Protocol', actionUri: 'control /name Microsoft.WindowsOptionalFeatures' }];
    }
    return [{ name: 'SMBv1', section: 'system', status: 'warn', message: 'SMBv1 status could not be determined.', detail: r.error || 'Registry query failed.', recommendation: 'Check SMBv1 status: Get-SmbServerConfiguration | Select SMB1Protocol', actionUri: 'control /name Microsoft.WindowsOptionalFeatures' }];
  }

  async checkAutoLogon() {
    const r = await this.runPowerShell(`$w = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -ErrorAction SilentlyContinue; if ($w) { $auto = if ($w.PSObject.Properties.Name -contains 'AutoAdminLogon') { [string]$w.AutoAdminLogon } else { '' }; $hasPw = $w.PSObject.Properties.Name -contains 'DefaultPassword'; [PSCustomObject]@{ autoAdminLogon = $auto; hasDefaultPassword = $hasPw } | ConvertTo-Json -Depth 6 } else { $null }`);
    if (r.ok) {
      try {
        const d = JSON.parse(r.stdout);
        const on = !!(d && d.autoAdminLogon === '1');
        const pw = !!(d && d.hasDefaultPassword);
        if (on && pw) {
          return [{ name: 'Automatic Logon', section: 'accounts', status: 'fail', message: 'Automatic logon stores a plaintext password!', detail: 'Login credentials are stored in plaintext in the registry — anyone with access can read them.', recommendation: 'Disable automatic logon: Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" -Name AutoAdminLogon -Value 0', actionUri: 'control userpasswords2' }];
        }
        if (on) {
          return [{ name: 'Automatic Logon', section: 'accounts', status: 'warn', message: 'Automatic logon is enabled.', detail: 'Windows signs in automatically at startup without a prompt.', recommendation: 'Consider disabling automatic logon in User Accounts (netplwiz) settings.', actionUri: 'control userpasswords2' }];
        }
        return [{ name: 'Automatic Logon', section: 'accounts', status: 'pass', message: 'Automatic logon is disabled.', detail: 'Users must sign in manually at startup.', recommendation: '', actionUri: 'control userpasswords2' }];
      } catch (e) { /* fall through to error */ }
    }
    return [{ name: 'Automatic Logon', section: 'accounts', status: 'info', message: 'Automatic logon status could not be determined.', detail: r.error || 'Winlogon registry query failed.', actionUri: 'control userpasswords2' }];
  }

  async checkRemoteDesktop() {
    const r = await this.runPowerShell(`$ts = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -ErrorAction SilentlyContinue; $rdp = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -ErrorAction SilentlyContinue; [PSCustomObject]@{ rdpEnabled = if ($ts) { $ts.fDenyTSConnections -ne 1 } else { $null }; nlaEnabled = if ($rdp) { $rdp.UserAuthentication -eq 1 } else { $null } } | ConvertTo-Json -Depth 6`);
    if (r.ok) {
      try {
        const d = JSON.parse(r.stdout);
        if (d && d.rdpEnabled === false) {
          return [{ name: 'Remote Desktop', section: 'system', status: 'pass', message: 'Remote Desktop is disabled.', detail: 'No remote desktop attack surface is exposed.', recommendation: '', actionUri: 'ms-settings:system-remote-desktop' }];
        }
        if (d && d.rdpEnabled === true) {
          if (d.nlaEnabled) {
            return [{ name: 'Remote Desktop', section: 'system', status: 'warn', message: 'Remote Desktop is enabled (NLA on).', detail: 'Remote connections require network-level authentication.', recommendation: 'Turn off Remote Desktop when not needed: Settings > System > Remote Desktop.', actionUri: 'ms-settings:system-remote-desktop' }];
          }
          return [{ name: 'Remote Desktop', section: 'system', status: 'fail', message: 'Remote Desktop is enabled WITHOUT Network Level Authentication!', detail: 'Attackers can attempt password brute force over the network.', recommendation: 'Enable NLA: Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name UserAuthentication -Value 1', actionUri: 'ms-settings:system-remote-desktop' }];
        }
      } catch (e) { /* fall through to error */ }
    }
    return [{ name: 'Remote Desktop', section: 'system', status: 'info', message: 'Remote Desktop status could not be determined.', detail: r.error || 'Terminal Server registry query failed.', actionUri: 'ms-settings:system-remote-desktop' }];
  }

  async checkLsaProtection() {
    const r = await this.runPowerShell(`$lsa = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -ErrorAction SilentlyContinue; if ($lsa -and $lsa.PSObject.Properties.Name -contains 'RunAsPPL') { [int]$lsa.RunAsPPL } else { $null }`);
    if (r.ok) {
      const v = r.stdout.trim();
      if (v === '1' || v === '2') {
        return [{ name: 'LSA Protection', section: 'system', status: 'pass', message: 'LSA protection is enabled.', detail: 'Credential-dumping tools cannot read Local Security Authority memory.', recommendation: '', manageAction: 'open-powershell' }];
      }
      if (v === '0') {
        return [{ name: 'LSA Protection', section: 'system', status: 'fail', message: 'LSA protection is off!', detail: 'Credential-theft tools can read LSA memory and steal password hashes.', recommendation: 'Enable LSA protection: Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa" -Name RunAsPPL -Value 1', manageAction: 'open-powershell' }];
      }
    }
    return [{ name: 'LSA Protection', section: 'system', status: 'info', message: 'LSA protection status could not be determined.', detail: r.error || 'The RunAsPPL registry value is not set on this system.', manageAction: 'open-powershell' }];
  }

  async checkAccounts() {
    const r = await this.runPowerShell(`$ads = $null; try { $ads = [adsi]('WinNT://' + $env:COMPUTERNAME) } catch { }; $min = $null; $lock = $null; $comp = $null; if ($ads) { try { $min = [int]$ads.MinimumPasswordLength } catch { }; try { $lock = [int]$ads.LockoutThreshold } catch { }; try { $comp = [bool]$ads.PasswordComplexity } catch { } }; if ($null -eq $min) { $lsa = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -ErrorAction SilentlyContinue; if ($lsa -and $lsa.PSObject.Properties.Name -contains 'MinPwdLen') { $min = [int]$lsa.MinPwdLen }; if ($lsa -and $lsa.PSObject.Properties.Name -contains 'LockoutBadCount') { $lock = [int]$lsa.LockoutBadCount } }; $gd = $null; try { $guest = Get-LocalUser -Name 'Guest' -ErrorAction Stop; $gd = -not [bool]$guest.Enabled } catch { try { $g = [adsi]('WinNT://' + $env:COMPUTERNAME + '/Guest'); $gd = [bool]$g.Disabled } catch { } }; [PSCustomObject]@{ minLength = $min; lockout = $lock; complexity = $comp; guestDisabled = $gd } | ConvertTo-Json -Depth 6`);
    if (!r.ok) {
      return [
        { name: 'Password Policy', section: 'accounts', status: 'warn', message: 'Password policy could not be determined.', detail: r.error || 'Local policy query failed.', recommendation: 'Check the policy: net accounts', manageAction: 'open-powershell' },
        { name: 'Guest Account', section: 'accounts', status: 'info', message: 'Guest account status could not be determined.', detail: r.error || 'Local accounts query failed.', manageAction: 'open-powershell' }
      ];
    }
    let d;
    try { d = JSON.parse(r.stdout); } catch (e) { d = null; }
    if (!d) {
      return [
        { name: 'Password Policy', section: 'accounts', status: 'warn', message: 'Password policy could not be determined.', detail: 'The local policy query returned an unexpected response.', recommendation: 'Check the policy: net accounts', manageAction: 'open-powershell' },
        { name: 'Guest Account', section: 'accounts', status: 'info', message: 'Guest account status could not be determined.', detail: 'Could not query the local Guest account.', manageAction: 'open-powershell' }
      ];
    }

    const rawMin = d.minLength;
    const rawLock = d.lockout;
    const rawComplex = d.complexity;
    const minLength = rawMin === null || rawMin === undefined ? null : Number(rawMin);
    const lockout = rawLock === null || rawLock === undefined ? null : Number(rawLock);
    const complexity = rawComplex === null || rawComplex === undefined ? null : Boolean(rawComplex);

    const guestRow = d.guestDisabled === true
      ? { name: 'Guest Account', section: 'accounts', status: 'pass', message: 'Guest account is disabled.', detail: 'No anonymous local access to this PC.', recommendation: '', manageAction: 'open-powershell' }
      : d.guestDisabled === false
        ? { name: 'Guest Account', section: 'accounts', status: 'fail', message: 'Guest account is enabled!', detail: 'Anonymous users can log on locally.', recommendation: 'Disable the Guest account: net user Guest /active:no', manageAction: 'open-powershell' }
        : { name: 'Guest Account', section: 'accounts', status: 'info', message: 'Guest account status could not be determined.', detail: 'Could not query the local Guest account.', manageAction: 'open-powershell' };

    if (minLength === null && lockout === null && complexity === null) {
      return [
        { name: 'Password Policy', section: 'accounts', status: 'warn', message: 'Password policy could not be determined.', detail: 'The local password policy could not be read on this system.', recommendation: 'Check the policy: net accounts', manageAction: 'open-powershell' },
        guestRow
      ];
    }

    let policyStatus = 'pass';
    const detailParts = [];
    if (minLength === null || minLength < 8) {
      policyStatus = policyStatus === 'pass' ? 'fail' : policyStatus;
      detailParts.push('Min length: not enforced');
    } else {
      detailParts.push(`Min length: ${minLength}`);
      if (minLength < 12) policyStatus = 'warn';
    }
    if (lockout === null || lockout === 0) {
      policyStatus = 'fail';
      detailParts.push('Lockout: not enforced');
    } else {
      detailParts.push(`Lockout: ${lockout} attempts`);
      if (lockout < 5) policyStatus = 'warn';
    }
    detailParts.push(complexity ? 'Complexity: required' : 'Complexity: not required');
    if (!complexity && policyStatus === 'pass') policyStatus = 'warn';

    let policyRow;
    if (policyStatus === 'pass') {
      policyRow = { name: 'Password Policy', section: 'accounts', status: 'pass', message: 'Password policy meets recommendations.', detail: detailParts.join(' | '), recommendation: '', manageAction: 'open-powershell' };
    } else if (policyStatus === 'fail') {
      policyRow = { name: 'Password Policy', section: 'accounts', status: 'fail', message: 'Password policy is weak.', detail: detailParts.join(' | '), recommendation: 'Require longer passwords and a lockout threshold: net accounts /minpwlen:12 /lockoutthreshold:5', manageAction: 'open-powershell' };
    } else {
      policyRow = { name: 'Password Policy', section: 'accounts', status: 'warn', message: 'Password policy could be stronger.', detail: detailParts.join(' | '), recommendation: 'Consider requiring longer passwords: net accounts /minpwlen:12', manageAction: 'open-powershell' };
    }

    return [policyRow, guestRow];
  }

  async runAudit(onProgress) {
    // All checks are independent of each other, so run them concurrently
    // instead of sequentially. Each PowerShell spawn has significant cold-start
    // overhead (loading the .NET runtime) on top of the actual query time --
    // running sequentially meant paying that overhead a dozen times in a row.
    // Total time now converges toward whichever single check takes longest
    // (Windows Update, up to 90s worst case) instead of the sum of all checks.
    //
    // Progress is centralized here rather than each check method calling
    // onProgress internally, so a real completed/total fraction can be
    // reported (not just "this check started") -- since checks run in
    // parallel, there's no single "step 3 of 12" sequence otherwise.
    const checks = [
      { label: 'Windows Defender', run: () => this.checkDefender() },
      { label: 'Defender hardening', run: () => this.checkDefenderHardening() },
      { label: 'User Account Control (UAC)', run: () => this.checkUac() },
      { label: 'Windows Update', run: () => this.checkWindowsUpdate() },
      { label: 'BitLocker', run: () => this.checkBitLocker() },
      { label: 'PowerShell execution policy', run: () => this.checkExecutionPolicy() },
      { label: 'Secure Boot', run: () => this.checkSecureBoot() },
      { label: 'SMBv1', run: () => this.checkSmb1() },
      { label: 'Automatic Logon', run: () => this.checkAutoLogon() },
      { label: 'Remote Desktop', run: () => this.checkRemoteDesktop() },
      { label: 'LSA protection', run: () => this.checkLsaProtection() },
      { label: 'Local accounts', run: () => this.checkAccounts() }
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

    const results = await Promise.all(checks.map(runOne));
    return results.flat();
  }
}

module.exports = SystemAudit;