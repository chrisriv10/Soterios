const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

// Prefix used for every rule this app creates. Destructive/mutating actions
// (delete, enable/disable) are restricted to rules carrying this prefix so a
// stray click can never touch a built-in Windows rule.
const APP_RULE_PREFIX = 'Soterios - ';

function psEscape(value) {
  // Escape for embedding inside a single-quoted PowerShell string.
  return String(value).replace(/'/g, "''");
}

function isValidIp(ip) {
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const v6 = /^[0-9a-fA-F:]+$/;
  return v4.test(ip) || (v6.test(ip) && ip.includes(':'));
}

class FirewallManager {
  async runPowerShell(command) {
    const { stdout } = await execFilePromise('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      timeout: 15000,
      windowsHide: true
    });
    return stdout;
  }

  async getStatus() {
    try {
      const stdout = await this.runPowerShell('Get-NetFirewallProfile | Select-Object Name, Enabled | ConvertTo-Json');
      return JSON.parse(stdout);
    } catch (e) {
      console.error('Failed to get firewall status', e);
      return [];
    }
  }

  async getRules() {
    try {
      const command = [
        '$rules = Get-NetFirewallRule -PolicyStore ActiveStore | Select-Object DisplayName, Direction, Action, Enabled, Profile;',
        '$total = $rules.Count;',
        '$inbound = ($rules | Where-Object Direction -eq "Inbound").Count;',
        '$outbound = ($rules | Where-Object Direction -eq "Outbound").Count;',
        '$enabled = ($rules | Where-Object Enabled -eq "True").Count;',
        '$disabled = $total - $enabled;',
        '$allow = ($rules | Where-Object Action -eq "Allow").Count;',
        '$block = ($rules | Where-Object Action -eq "Block").Count;',
        '$profDomain = ($rules | Where-Object Profile -eq "Domain").Count;',
        '$profPrivate = ($rules | Where-Object Profile -eq "Private").Count;',
        '$profPublic = ($rules | Where-Object Profile -eq "Public").Count;',
        'Write-Output "$total|$inbound|$outbound|$enabled|$disabled|$allow|$block|$profDomain|$profPrivate|$profPublic"'
      ].join(' ');
      const stdout = await this.runPowerShell(command);
      const parts = stdout.trim().split('|');
      return {
        total: parseInt(parts[0], 10) || 0,
        inbound: parseInt(parts[1], 10) || 0,
        outbound: parseInt(parts[2], 10) || 0,
        enabled: parseInt(parts[3], 10) || 0,
        disabled: parseInt(parts[4], 10) || 0,
        allow: parseInt(parts[5], 10) || 0,
        block: parseInt(parts[6], 10) || 0,
        profiles: {
          domain: parseInt(parts[7], 10) || 0,
          private: parseInt(parts[8], 10) || 0,
          public: parseInt(parts[9], 10) || 0
        }
      };
    } catch (e) {
      console.error('Failed to get firewall rules', e);
      return {
        total: 0,
        inbound: 0,
        outbound: 0,
        enabled: 0,
        disabled: 0,
        allow: 0,
        block: 0,
        profiles: {
          domain: 0,
          private: 0,
          public: 0
        }
      };
    }
  }

  async listRules() {
    try {
      const command = [
        '$rules = Get-NetFirewallRule -PolicyStore ActiveStore;',
        '$appFilters = @{}; Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | ForEach-Object { $appFilters[$_.InstanceID] = $_ };',
        '$portFilters = @{}; Get-NetFirewallPortFilter -PolicyStore ActiveStore | ForEach-Object { $portFilters[$_.InstanceID] = $_ };',
        '$addrFilters = @{}; Get-NetFirewallAddressFilter -PolicyStore ActiveStore | ForEach-Object { $addrFilters[$_.InstanceID] = $_ };',
        '$out = foreach ($r in $rules) {',
        '  $app = $appFilters[$r.InstanceID]; $port = $portFilters[$r.InstanceID]; $addr = $addrFilters[$r.InstanceID];',
        '  [PSCustomObject]@{',
        '    Name = $r.DisplayName; Direction = $r.Direction.ToString(); Action = $r.Action.ToString();',
        '    Enabled = $r.Enabled.ToString(); Profile = $r.Profile.ToString();',
        '    Program = if ($app) { $app.Program } else { $null };',
        '    Protocol = if ($port) { $port.Protocol } else { $null };',
        '    LocalPort = if ($port) { $port.LocalPort -join "," } else { $null };',
        '    RemotePort = if ($port) { $port.RemotePort -join "," } else { $null };',
        '    RemoteAddress = if ($addr) { $addr.RemoteAddress -join "," } else { $null };',
        '  }',
        '}',
        '$out | ConvertTo-Json -Compress'
      ].join(' ');
      const stdout = await this.runPowerShell(command);
      let rules = JSON.parse(stdout || '[]');
      if (!Array.isArray(rules)) rules = [rules];
      return rules.map((r) => ({
        name: r.Name,
        direction: r.Direction,
        action: r.Action,
        enabled: r.Enabled === 'True',
        profile: r.Profile,
        program: r.Program || null,
        protocol: r.Protocol || null,
        localPort: r.LocalPort || null,
        remotePort: r.RemotePort || null,
        remoteAddress: r.RemoteAddress || null,
        managedByApp: typeof r.Name === 'string' && r.Name.startsWith(APP_RULE_PREFIX)
      }));
    } catch (e) {
      console.error('Failed to list firewall rules', e);
      return [];
    }
  }

  // Generic rule creator. Only include the params you have — anything
  // omitted is left unrestricted by Windows Firewall's defaults.
  async createRule(spec) {
    const { name, direction, action, protocol, remoteAddress, remotePort, localPort, program } = spec || {};
    if (!name || !direction || !action) throw new Error('name, direction, and action are required.');
    if (remoteAddress && !isValidIp(remoteAddress)) throw new Error('Invalid remote address.');

    const fullName = name.startsWith(APP_RULE_PREFIX) ? name : `${APP_RULE_PREFIX}${name}`;
    const parts = [
      `-DisplayName '${psEscape(fullName)}'`,
      `-Direction ${direction === 'Inbound' ? 'Inbound' : 'Outbound'}`,
      `-Action ${action === 'Allow' ? 'Allow' : 'Block'}`
    ];
    if (protocol) parts.push(`-Protocol ${psEscape(protocol)}`);
    if (remoteAddress) parts.push(`-RemoteAddress '${psEscape(remoteAddress)}'`);
    if (remotePort) parts.push(`-RemotePort ${Number(remotePort)}`);
    if (localPort) parts.push(`-LocalPort ${Number(localPort)}`);
    if (program) parts.push(`-Program '${psEscape(program)}'`);

    await this.runPowerShell(`New-NetFirewallRule ${parts.join(' ')} | Out-Null`);
    return { success: true, name: fullName };
  }

  async deleteRule(name) {
    if (!name || !name.startsWith(APP_RULE_PREFIX)) {
      throw new Error('Only rules created in this app can be deleted here.');
    }
    await this.runPowerShell(`Remove-NetFirewallRule -DisplayName '${psEscape(name)}'`);
    return { success: true };
  }

  async setRuleEnabled(name, enabled) {
    if (!name || !name.startsWith(APP_RULE_PREFIX)) {
      throw new Error('Only rules created in this app can be toggled here.');
    }
    await this.runPowerShell(`Set-NetFirewallRule -DisplayName '${psEscape(name)}' -Enabled ${enabled ? 'True' : 'False'}`);
    return { success: true };
  }
}

module.exports = FirewallManager;