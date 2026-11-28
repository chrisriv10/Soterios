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
          ? `Query timed out after ${timeoutMs}ms (Windows Update search can be slow; try again or check manually in Settings).`
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
          out.push({ name: 'Windows Defender Antivirus', section: 'antivirus', status: 'pass', message: 'Defender antivirus is enabled and running.', detail: `Engine: ${s.AMEngineVersion || 'N/A'} | Signatures: ${s.AntivirusSignatureVersion || 'N/A'} (${s.AntivirusSignatureAge || 0} days old)`, recommendation: '', actionUri: 'windowsdefender://threatsettings/' });
        } else {
          out.push({ name: 'Windows Defender Antivirus', section: 'antivirus', status: 'fail', message: 'Defender antivirus is disabled.', detail: 'Microsoft Defender Antivirus reports that its service is disabled. Windows may be using another antivirus provider.', recommendation: 'Open Windows Security and review which antivirus provider is active.', actionUri: 'windowsdefender://threatsettings/' });
        }
        out.push({ name: 'Real-Time Protection', section: 'antivirus', status: s.RealTimeProtectionEnabled ? 'pass' : 'fail', message: s.RealTimeProtectionEnabled ? 'Real-time protection is active.' : 'Real-time protection is off.', detail: s.RealTimeProtectionEnabled ? 'Microsoft Defender checks files and activity in real time. It cannot detect or block every threat.' : 'Microsoft Defender is not checking files and activity in real time. Manual scans and other security controls may still be available.', recommendation: s.RealTimeProtectionEnabled ? '' : 'Enable real-time protection in Windows Security settings.', actionUri: 'windowsdefender://threatsettings/' });
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
        message: enabled ? 'UAC is enabled.' : 'UAC is disabled.',
        detail: enabled ? 'UAC prompts for approval or credentials when an operation needs administrator permissions, depending on your settings.' : 'Programs running with an administrator account can make system changes without a UAC prompt.',
        recommendation: enabled ? '' : 'Enable UAC via Control Panel > User Accounts > Change User Account Control settings.',
        manageAction: 'open-windows-utility',
        manageContext: 'uac'
      }];
    }
    return [{ name: 'User Account Control', section: 'system', status: 'error', message: 'Could not check UAC status.', detail: 'Could not read the UAC setting. Check it in Windows User Account Control settings.', manageAction: 'open-windows-utility', manageContext: 'uac' }];
  }

  async checkWindowsUpdate() {
    // Primary: COM query - filter to MANDATORY updates only (matching Windows Settings behavior)
    // Windows Settings only shows mandatory updates by default; optional/driver/preview updates are hidden
    const up = await this.runPowerShell(`$session = New-Object -ComObject Microsoft.Update.Session -ErrorAction Stop; $searcher = $session.CreateUpdateSearcher(); $pending = $searcher.Search('IsInstalled=0 and IsHidden=0'); $mandatory = $pending.Updates | Where-Object { $_.IsMandatory -eq \$true }; $mandatory.Count`, 90000);
    if (up.ok) {
      const raw = up.stdout.trim();
      const count = /^[0-9]+$/.test(raw) ? Number(raw) : null;
      if (count === null) {
        return [{ name: 'Windows Updates', section: 'updates', status: 'warn', message: 'Could not parse update status.', detail: 'The Windows Update query returned an unexpected response. Check Windows Update in Settings.', recommendation: 'Open Settings > Windows Update to check the status manually.', actionUri: 'ms-settings:windowsupdate' }];
      } else if (count === 0) {
        return [{ name: 'Windows Updates', section: 'updates', status: 'pass', message: 'No pending mandatory updates.', detail: 'The update query found no pending mandatory updates. Optional and driver updates may still be available.', recommendation: '', actionUri: 'ms-settings:windowsupdate' }];
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
          return [{ name: 'Windows Updates', section: 'updates', status: 'pass', message: 'No pending mandatory updates.', detail: 'The update query found no pending mandatory updates. Optional and driver updates may still be available.', recommendation: '', actionUri: 'ms-settings:windowsupdate' }];
        } else if (count !== null && count > 0) {
          return [{ name: 'Windows Updates', section: 'updates', status: 'warn', message: `${count} mandatory update(s) pending.`, detail: `${count} mandatory update(s) are waiting to be installed.`, recommendation: 'Open Settings > Windows Update and install pending updates.', actionUri: 'ms-settings:windowsupdate' }];
        }
      }
    }
    // Sanitize error - don't expose raw PowerShell/COM errors to user
    const friendlyError = this.sanitizeWindowsUpdateError(up.error);
    return [{ name: 'Windows Updates', section: 'updates', status: 'warn', message: 'Could not query update status.', detail: friendlyError, recommendation: 'Open Settings > Windows Update to check the status manually.', actionUri: 'ms-settings:windowsupdate' }];
  }

  sanitizeWindowsUpdateError(rawError) {
    return 'Could not read Windows Update status. Try again later or check Settings > Windows Update.';
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
            message: 'BitLocker protection is on for the system drive.',
            detail: 'This check reads BitLocker protection status, not encryption progress. Access still depends on Windows sign-in and recovery settings.',
            recommendation: '',
            actionUri: 'control /name Microsoft.BitLockerDriveEncryption'
          }];
        } else if (statusValue === 0 || statusValue === null) {
          return [{
            name: 'BitLocker Drive Encryption', section: 'system', status: 'warn',
            message: statusValue === 0 ? 'BitLocker protection is off for the system drive.' : 'BitLocker status unavailable.',
            detail: statusValue === 0 ? 'BitLocker protection is off for this drive. Windows sign-in may limit access while Windows is running, but it does not encrypt the drive.' : 'Could not determine BitLocker protection status.',
            recommendation: statusValue === 0
              ? 'Enable BitLocker via Control Panel > BitLocker Drive Encryption.'
              : 'Check BitLocker status in Windows settings.',
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
          return [{ name: 'BitLocker', section: 'system', status: 'info', message: 'BitLocker status could not be read.', detail: 'The BitLocker response was not in the expected format. Open BitLocker settings to check status.', actionUri: 'control /name Microsoft.BitLockerDriveEncryption' }];
      }
    }
    return [{ name: 'BitLocker', section: 'system', status: 'info', message: 'Could not query BitLocker status.', detail: 'Check BitLocker in Windows Settings or Control Panel. Availability depends on your Windows edition and device configuration.', actionUri: 'ms-settings:deviceencryption' }];
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
        detail: pass ? 'Execution policy can restrict script execution, but it is not a security boundary.' : 'A less restrictive execution policy may allow scripts from untrusted sources. Execution policy is not a security boundary.',
        recommendation: pass ? '' : 'Consider setting to RemoteSigned: Set-ExecutionPolicy RemoteSigned -Scope LocalMachine',
        manageAction: 'open-powershell',
        manageContext: 'execution-policy'
      }];
    }
    return [{ name: 'PowerShell Execution Policy', section: 'updates', status: 'warn', message: 'PowerShell execution policy query failed.', detail: ep.error || 'Unable to query execution policy.', recommendation: 'Check execution policy with Get-ExecutionPolicy -List in PowerShell.', manageAction: 'open-powershell', manageContext: 'execution-policy' }];
  }

  async checkSecureBoot() {
    const sb = await this.runPowerShell(`Confirm-SecureBootUEFI`);
    if (sb.ok) {
      const enabled = sb.stdout.trim() === 'True';
      return [{
        name: 'Secure Boot', section: 'system', status: enabled ? 'pass' : 'fail',
        message: enabled ? 'Secure Boot is enabled.' : 'Secure Boot is disabled.',
        detail: enabled ? 'UEFI verifies signatures on boot software before starting Windows.' : 'Secure Boot is off, so UEFI does not verify boot software signatures through this feature.',
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
      ...(name === 'Network Protection'
        ? { manageAction: 'open-powershell', manageContext: 'network-protection' }
        : { actionUri: 'windowsdefender://threatsettings/' })
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
      out.push({ name: 'Tamper Protection', section: 'antivirus', status: 'pass', message: 'Tamper protection is enabled.', detail: 'Tamper Protection helps prevent unauthorized changes to selected Microsoft Defender settings.', recommendation: '', actionUri: 'windowsdefender://threatsettings/' });
    } else if (data.tamperProtected === false) {
      out.push({ name: 'Tamper Protection', section: 'antivirus', status: 'fail', message: 'Tamper protection is off.', detail: 'Selected Defender settings are not protected by Tamper Protection. Other Windows protections may still apply.', recommendation: 'Enable tamper protection in Windows Security > Virus & threat protection > Manage settings.', actionUri: 'windowsdefender://threatsettings/' });
    } else {
      out.push({ name: 'Tamper Protection', section: 'antivirus', status: 'info', message: 'Tamper protection status could not be determined.', detail: 'This check may not be supported on this system.', actionUri: 'windowsdefender://threatsettings/' });
    }
    if (Number(data.cloudProtectionLevel) > 0) {
      out.push({ name: 'Cloud-delivered Protection', section: 'antivirus', status: 'pass', message: 'Cloud-delivered protection is active.', detail: "Defender can use Microsoft's cloud service to assess suspicious files and provide threat intelligence.", recommendation: '', actionUri: 'windowsdefender://threatsettings/' });
    } else if (data.cloudProtectionLevel === 0) {
      out.push({ name: 'Cloud-delivered Protection', section: 'antivirus', status: 'fail', message: 'Cloud-delivered protection is off.', detail: 'Defender does not use cloud-delivered protection. Local signatures and other Windows security features may still be active.', recommendation: 'Turn on cloud-delivered protection in Windows Security > Virus & threat protection > Manage settings.', actionUri: 'windowsdefender://threatsettings/' });
    } else {
      out.push({ name: 'Cloud-delivered Protection', section: 'antivirus', status: 'info', message: 'Cloud-delivered protection status could not be determined.', detail: 'This setting may not be reported on this system.', actionUri: 'windowsdefender://threatsettings/' });
    }
    if (data.networkProtectionMode === 'block') {
      out.push({ name: 'Network Protection', section: 'antivirus', status: 'pass', message: 'Network protection is on.', detail: 'Defender Network Protection helps block connections to sites Microsoft identifies as malicious or suspicious.', recommendation: '', manageAction: 'open-powershell', manageContext: 'network-protection' });
    } else if (data.networkProtectionMode === 'audit') {
      out.push({ name: 'Network Protection', section: 'antivirus', status: 'info', message: 'Network protection is in audit mode.', detail: "Audit mode records connections that match Defender's criteria but does not block them.", recommendation: 'Enable network protection block mode with PowerShell or Group Policy.', manageAction: 'open-powershell', manageContext: 'network-protection' });
    } else if (data.networkProtectionMode === 'off') {
      out.push({ name: 'Network Protection', section: 'antivirus', status: 'fail', message: 'Defender Network Protection is off.', detail: 'Defender Network Protection does not block sites while it is off. Other security controls may still apply.', recommendation: 'Enable network protection block mode with PowerShell or Group Policy.', manageAction: 'open-powershell', manageContext: 'network-protection' });
    } else {
      out.push({ name: 'Network Protection', section: 'antivirus', status: 'info', message: 'Network protection status could not be determined.', detail: 'Network Protection status could not be determined.', manageAction: 'open-powershell', manageContext: 'network-protection' });
    }
    return out;
  }

  async checkSmb1() {
    const r = await this.runPowerShell(`$p = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters' -ErrorAction SilentlyContinue; if ($p -and $p.PSObject.Properties.Name -contains 'SMB1') { [string]$p.SMB1 } else { $null }`);
    if (r.ok) {
      const v = r.stdout.trim();
      if (v === '0') {
        return [{ name: 'SMBv1 server setting', section: 'system', status: 'pass', message: 'SMBv1 server setting is disabled.', detail: 'The SMB1 server setting in the registry is disabled. This check does not inspect every SMB1 client or feature setting.', recommendation: '', manageAction: 'open-windows-utility', manageContext: 'windows-features' }];
      }
      if (v === '1') {
        return [{ name: 'SMBv1 server setting', section: 'system', status: 'fail', message: 'SMBv1 server setting is enabled.', detail: 'SMBv1 has known vulnerabilities. Disable it if no application or device requires it.', recommendation: 'Disable SMBv1: Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart', manageAction: 'open-windows-utility', manageContext: 'windows-features' }];
      }
        return [{ name: 'SMBv1 server setting', section: 'system', status: 'warn', message: 'SMBv1 server setting could not be confirmed.', detail: 'No SMB1 server registry value was found. Check the SMB server and client settings in Windows.', recommendation: 'Check SMBv1 status: Get-SmbServerConfiguration | Select SMB1Protocol', manageAction: 'open-windows-utility', manageContext: 'windows-features' }];
    }
    return [{ name: 'SMBv1 server setting', section: 'system', status: 'warn', message: 'SMBv1 server setting could not be determined.', detail: 'The SMB1 server setting could not be read. Check SMB server and client settings in Windows.', recommendation: 'Check SMBv1 status: Get-SmbServerConfiguration | Select SMB1Protocol', manageAction: 'open-windows-utility', manageContext: 'windows-features' }];
  }

  async checkAutoLogon() {
    const r = await this.runPowerShell(`$w = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -ErrorAction SilentlyContinue; if ($w) { $auto = if ($w.PSObject.Properties.Name -contains 'AutoAdminLogon') { [string]$w.AutoAdminLogon } else { '' }; $hasPw = $w.PSObject.Properties.Name -contains 'DefaultPassword'; [PSCustomObject]@{ autoAdminLogon = $auto; hasDefaultPassword = $hasPw } | ConvertTo-Json -Depth 6 } else { $null }`);
    if (r.ok) {
      try {
        const d = JSON.parse(r.stdout);
        const on = !!(d && d.autoAdminLogon === '1');
        const pw = !!(d && d.hasDefaultPassword);
        if (on && pw) {
          return [{ name: 'Automatic Logon', section: 'accounts', status: 'fail', message: 'Automatic logon has a default password value in the registry.', detail: 'The Winlogon registry contains a default password value. Disable automatic logon and remove that value if it is no longer needed.', recommendation: 'Disable automatic logon: Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" -Name AutoAdminLogon -Value 0', actionUri: 'control userpasswords2' }];
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
          return [{ name: 'Remote Desktop', section: 'system', status: 'pass', message: 'Remote Desktop is disabled.', detail: 'This check found Windows Remote Desktop disabled. Other remote-access tools or services may still accept connections.', recommendation: '', actionUri: 'ms-settings:remotedesktop' }];
        }
        if (d && d.rdpEnabled === true) {
          if (d.nlaEnabled) {
            return [{ name: 'Remote Desktop', section: 'system', status: 'warn', message: 'Remote Desktop is enabled (NLA on).', detail: 'Network Level Authentication verifies users before Windows establishes a remote desktop session.', recommendation: 'Turn off Remote Desktop when not needed: Settings > System > Remote Desktop.', actionUri: 'ms-settings:remotedesktop' }];
          }
          return [{ name: 'Remote Desktop', section: 'system', status: 'fail', message: 'Remote Desktop is enabled without Network Level Authentication.', detail: 'Without NLA, Windows establishes the Remote Desktop connection before authenticating the user. Enable NLA when your clients support it.', recommendation: 'Enable NLA: Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name UserAuthentication -Value 1', actionUri: 'ms-settings:remotedesktop' }];
        }
      } catch (e) { /* fall through to error */ }
    }
    return [{ name: 'Remote Desktop', section: 'system', status: 'info', message: 'Remote Desktop status could not be determined.', detail: r.error || 'Terminal Server registry query failed.', actionUri: 'ms-settings:remotedesktop' }];
  }

  async checkLsaProtection() {
    const r = await this.runPowerShell(`$lsa = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -ErrorAction SilentlyContinue; if ($lsa -and $lsa.PSObject.Properties.Name -contains 'RunAsPPL') { [int]$lsa.RunAsPPL } else { $null }`);
    if (r.ok) {
      const v = r.stdout.trim();
      if (v === '1' || v === '2') {
        return [{ name: 'LSA Protection', section: 'system', status: 'pass', message: 'LSA protection is configured on.', detail: 'When active, this setting restricts nonprotected processes from loading code into LSASS or reading its memory. It helps reduce credential-theft risk.', recommendation: '', manageAction: 'open-powershell', manageContext: 'lsa-protection' }];
      }
      if (v === '0') {
        return [{ name: 'LSA Protection', section: 'system', status: 'fail', message: 'LSA protection is off.', detail: 'Windows is not configured to apply this additional restriction to LSASS. Other protections may still apply.', recommendation: 'Enable LSA protection: Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa" -Name RunAsPPL -Value 1', manageAction: 'open-powershell', manageContext: 'lsa-protection' }];
      }
    }
    return [{ name: 'LSA Protection', section: 'system', status: 'info', message: 'LSA protection status could not be determined.', detail: r.error || 'The RunAsPPL registry value is not set on this system.', manageAction: 'open-powershell', manageContext: 'lsa-protection' }];
  }

  async checkAccounts() {
    const r = await this.runPowerShell(`$ads = $null; try { $ads = [adsi]('WinNT://' + $env:COMPUTERNAME) } catch { }; $min = $null; $lock = $null; $comp = $null; if ($ads) { try { $min = [int]$ads.MinimumPasswordLength } catch { }; try { $lock = [int]$ads.LockoutThreshold } catch { }; try { $comp = [bool]$ads.PasswordComplexity } catch { } }; if ($null -eq $min) { $lsa = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -ErrorAction SilentlyContinue; if ($lsa -and $lsa.PSObject.Properties.Name -contains 'MinPwdLen') { $min = [int]$lsa.MinPwdLen }; if ($lsa -and $lsa.PSObject.Properties.Name -contains 'LockoutBadCount') { $lock = [int]$lsa.LockoutBadCount } }; $gd = $null; try { $guest = Get-LocalUser -Name 'Guest' -ErrorAction Stop; $gd = -not [bool]$guest.Enabled } catch { try { $g = [adsi]('WinNT://' + $env:COMPUTERNAME + '/Guest'); $gd = [bool]$g.Disabled } catch { } }; [PSCustomObject]@{ minLength = $min; lockout = $lock; complexity = $comp; guestDisabled = $gd } | ConvertTo-Json -Depth 6`);
    if (!r.ok) {
      return [
        { name: 'Password Policy', section: 'accounts', status: 'warn', message: 'Password policy could not be determined.', detail: r.error || 'Local policy query failed.', recommendation: 'Check the policy: net accounts', manageAction: 'open-powershell', manageContext: 'password-policy' },
        { name: 'Guest Account', section: 'accounts', status: 'info', message: 'Guest account status could not be determined.', detail: r.error || 'Local accounts query failed.', manageAction: 'open-powershell', manageContext: 'guest-account' }
      ];
    }
    let d;
    try { d = JSON.parse(r.stdout); } catch (e) { d = null; }
    if (!d) {
      return [
        { name: 'Password Policy', section: 'accounts', status: 'warn', message: 'Password policy could not be determined.', detail: 'The local policy query returned an unexpected response.', recommendation: 'Check the policy: net accounts', manageAction: 'open-powershell', manageContext: 'password-policy' },
        { name: 'Guest Account', section: 'accounts', status: 'info', message: 'Guest account status could not be determined.', detail: 'Could not query the local Guest account.', manageAction: 'open-powershell', manageContext: 'guest-account' }
      ];
    }

    const rawMin = d.minLength;
    const rawLock = d.lockout;
    const rawComplex = d.complexity;
    const minLength = rawMin === null || rawMin === undefined ? null : Number(rawMin);
    const lockout = rawLock === null || rawLock === undefined ? null : Number(rawLock);
    const complexity = rawComplex === null || rawComplex === undefined ? null : Boolean(rawComplex);

    const guestRow = d.guestDisabled === true
      ? { name: 'Guest Account', section: 'accounts', status: 'pass', message: 'Guest account is disabled.', detail: 'The built-in Guest account is disabled.', recommendation: '', manageAction: 'open-powershell', manageContext: 'guest-account' }
      : d.guestDisabled === false
        ? { name: 'Guest Account', section: 'accounts', status: 'fail', message: 'Guest account is enabled.', detail: 'The built-in Guest account can be used to sign in.', recommendation: 'Disable the Guest account: net user Guest /active:no', manageAction: 'open-powershell', manageContext: 'guest-account' }
        : { name: 'Guest Account', section: 'accounts', status: 'info', message: 'Guest account status could not be determined.', detail: 'Could not query the local Guest account.', manageAction: 'open-powershell', manageContext: 'guest-account' };

    if (minLength === null && lockout === null && complexity === null) {
      return [
        { name: 'Password Policy', section: 'accounts', status: 'warn', message: 'Password policy could not be determined.', detail: 'The local password policy could not be read on this system.', recommendation: 'Check the policy: net accounts', manageAction: 'open-powershell', manageContext: 'password-policy' },
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
      policyRow = { name: 'Password Policy', section: 'accounts', status: 'pass', message: 'Password policy meets recommendations.', detail: detailParts.join(' | '), recommendation: '', manageAction: 'open-powershell', manageContext: 'password-policy' };
    } else if (policyStatus === 'fail') {
      policyRow = { name: 'Password Policy', section: 'accounts', status: 'fail', message: 'Password policy is weak.', detail: detailParts.join(' | '), recommendation: 'Require longer passwords and a lockout threshold: net accounts /minpwlen:12 /lockoutthreshold:5', manageAction: 'open-powershell', manageContext: 'password-policy' };
    } else {
      policyRow = { name: 'Password Policy', section: 'accounts', status: 'warn', message: 'Password policy could be stronger.', detail: detailParts.join(' | '), recommendation: 'Consider requiring longer passwords: net accounts /minpwlen:12', manageAction: 'open-powershell', manageContext: 'password-policy' };
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
      { label: 'SMBv1 server setting', run: () => this.checkSmb1() },
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
