const logger = require('../utils/logger');
const { InvalidInputError } = require('../utils/errors');
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const { log, ACTIONS } = require('../core/auditLog');

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

// PowerShell/Windows errors are long, technical, and often include a stack
// trace with line/column info that means nothing to an end user. This maps
// the common cases to a short, actionable sentence and falls back to a
// generic message for anything unrecognized (the raw error is still logged
// to the console for debugging).
function friendlyFirewallError(e, fallback) {
  const raw = (e && e.message) || String(e);
  logger.error('Firewall operation failed', { error: raw });
  if (/access is denied/i.test(raw)) return new Error('Access denied. Try running the app as Administrator.');
  if (/requires elevation/i.test(raw)) return new Error('This action requires administrator privileges.');
  if (/cannot find.*rule|no rules? (were)? ?found|no matching rules/i.test(raw)) return new Error('That rule could not be found — it may have already been removed.');
  if (/already exists/i.test(raw)) return new Error('A rule with that name already exists.');
  if (/timed out/i.test(raw)) return new Error('The operation timed out. Please try again.');
  if (/cannot find path|does not exist/i.test(raw)) return new Error('That file or path could not be found.');
  return new Error(fallback || 'Something went wrong updating the firewall. Please try again.');
}

/**
 * Manages Windows Firewall rules for Soterios.
 *
 * All mutating operations are restricted to rules carrying the
 * {@link APP_RULE_PREFIX} so the app never touches built-in Windows rules.
 */
class FirewallManager {
  /**
   * @param {object} db - DatabaseService instance used for audit logging.
   */
  constructor(db) {
    this._db = db;
  }
  /**
   * Execute a PowerShell command and return stdout.
   * @param {string} command
   * @returns {Promise<string>}
   */
  async runPowerShell(command) {
    const { stdout } = await execFilePromise('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      timeout: 15000,
      windowsHide: true
    });
    return stdout;
  }

  /**
   * Get firewall profile statuses (Domain/Private/Public).
   * @returns {Promise<Array<{name:string, enabled:boolean}>>}
   */
  async getStatus() {
    try {
      const stdout = await this.runPowerShell('Get-NetFirewallProfile | Select-Object Name, Enabled | ConvertTo-Json');
      return JSON.parse(stdout);
    } catch (e) {
      logger.error('Failed to get firewall status', e);
      return [];
    }
  }

  /**
   * Get aggregated firewall rule counts.
   * @returns {Promise<Object>} Rule statistics.
   */
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
      logger.error('Failed to get firewall rules', e);
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

  /**
   * List all Windows Firewall rules with app-managed metadata.
   * @returns {Promise<Array<Object>>}
   */
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
      logger.error('Failed to list firewall rules', e);
      return [];
    }
  }

  /**
   * Create a new firewall rule. The rule name is automatically prefixed with
   * {@link APP_RULE_PREFIX} unless it already carries it.
   * @param {Object} spec
   * @param {string} spec.name
   * @param {string} spec.direction - "Inbound" or "Outbound"
   * @param {string} spec.action - "Allow" or "Block"
   * @param {string} [spec.protocol]
   * @param {string} [spec.remoteAddress]
   * @param {number|string} [spec.remotePort]
   * @param {number|string} [spec.localPort]
   * @param {string} [spec.program]
   * @returns {Promise<{success:boolean, name?:string}>}
   */
  async createRule(spec) {
    const { name, direction, action, protocol, remoteAddress, remotePort, localPort, program } = spec || {};
    if (!name || !direction || !action) throw new InvalidInputError('name, direction, and action are required.');
    if (remoteAddress && !isValidIp(remoteAddress)) throw new InvalidInputError('Invalid remote address.');

    const fullName = name.startsWith(APP_RULE_PREFIX) ? name : `${APP_RULE_PREFIX}${name}`;
    if (fullName.includes("'")) {
      throw new InvalidInputError('Rule name contains an invalid character.');
    }
    const parts = [
      `-DisplayName '${psEscape(fullName)}'`,
      `-Direction ${direction === 'Inbound' ? 'Inbound' : 'Outbound'}`,
      `-Action ${action === 'Allow' ? 'Allow' : 'Block'}`
    ];
    if (protocol) parts.push(`-Protocol ${psEscape(protocol)}`);
    if (remoteAddress) parts.push(`-RemoteAddress '${psEscape(remoteAddress)}'`);
    if (remotePort != null && remotePort !== '') {
      const port = Number(remotePort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new InvalidInputError(`Invalid remotePort: ${remotePort}`);
      }
      parts.push(`-RemotePort ${port}`);
    }
    if (localPort != null && localPort !== '') {
      const port = Number(localPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new InvalidInputError(`Invalid localPort: ${localPort}`);
      }
      parts.push(`-LocalPort ${port}`);
    }
    if (program) parts.push(`-Program '${psEscape(program)}'`);

    try {
      await this.runPowerShell(`New-NetFirewallRule ${parts.join(' ')} | Out-Null`);
    } catch (e) {
      throw friendlyFirewallError(e, 'Could not create the firewall rule.');
    }
    log(this._db, ACTIONS.FIREWALL_RULE_CREATE, { name: fullName, spec }, { success: true });
    return { success: true, name: fullName };
  }

  /**
   * Delete an app-managed firewall rule by display name.
   * @param {string} name - Rule display name (must start with APP_RULE_PREFIX).
   * @returns {Promise<{success:boolean}>}
   */
  async deleteRule(name) {
    if (!name || !name.startsWith(APP_RULE_PREFIX)) {
      throw new InvalidInputError('Only rules created in this app can be deleted here.');
    }
    try {
      await this.runPowerShell(`Remove-NetFirewallRule -DisplayName '${psEscape(name)}'`);
    } catch (e) {
      throw friendlyFirewallError(e, 'Could not delete that rule.');
    }
    log(this._db, ACTIONS.FIREWALL_RULE_DELETE, { name }, { success: true });
    return { success: true };
  }

  /**
   * Enable or disable an app-managed firewall rule.
   * @param {string} name - Rule display name (must start with APP_RULE_PREFIX).
   * @param {boolean} enabled
   * @returns {Promise<{success:boolean}>}
   */
  async setRuleEnabled(name, enabled) {
    if (!name || !name.startsWith(APP_RULE_PREFIX)) {
      throw new InvalidInputError('Only rules created in this app can be toggled here.');
    }
    try {
      await this.runPowerShell(`Set-NetFirewallRule -DisplayName '${psEscape(name)}' -Enabled ${enabled ? 'True' : 'False'}`);
    } catch (e) {
      throw friendlyFirewallError(e, 'Could not update that rule.');
    }
    log(this._db, ACTIONS.FIREWALL_RULE_TOGGLE, { name, enabled }, { success: true });
    return { success: true };
  }

  /**
   * Turn a firewall profile (Domain/Private/Public) on or off.
   * @param {string} profile - "Domain", "Private", or "Public".
   * @param {boolean} enabled
   * @returns {Promise<{success:boolean}>}
   */
  async setProfileEnabled(profile, enabled) {
    const VALID_PROFILES = ['Domain', 'Private', 'Public'];
    if (!VALID_PROFILES.includes(profile)) {
      throw new InvalidInputError('Invalid firewall profile.');
    }
    try {
      await this.runPowerShell(`Set-NetFirewallProfile -Name ${profile} -Enabled ${enabled ? 'True' : 'False'}`);
    } catch (e) {
      throw friendlyFirewallError(e, `Could not ${enabled ? 'turn on' : 'turn off'} the ${profile} firewall profile.`);
    }
    return { success: true };
  }

  /**
   * Export all Soterios-managed firewall rules for backup/migration.
   * @returns {Promise<{version:number, exportedAt:string, prefix:string, rules:Array}>}
   */
  async exportRules() {
    const rules = await this.listRules();
    const managed = rules.filter((r) => r.managedByApp);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      prefix: APP_RULE_PREFIX,
      rules: managed.map((r) => ({
        name: r.name,
        direction: r.direction,
        action: r.action,
        enabled: !!r.enabled,
        profile: r.profile || null,
        program: r.program || null,
        protocol: r.protocol || null,
        localPort: r.localPort || null,
        remotePort: r.remotePort || null,
        remoteAddress: r.remoteAddress || null
      }))
    };
  }

  /**
   * Normalize a port value for import. Accepts a single numeric port or "Any".
   * @param {string|number|null|undefined} value
   * @returns {number|undefined}
   */
  _normalizePort(value) {
    if (value == null || value === '') return undefined;
    const raw = String(value).trim();
    if (/^any$/i.test(raw)) return undefined;
    // Fail closed: do not silently drop ranges/lists/keywords (e.g. "80,443", "1-65535", "RPC").
    if (!/^\d{1,5}$/.test(raw)) {
      throw new InvalidInputError(`Unsupported port expression (import supports a single numeric port only): ${value}`);
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new InvalidInputError(`Invalid port value: ${value}`);
    }
    return n;
  }

  /**
   * Normalize a protocol value for import.
   * @param {string|null|undefined} value
   * @returns {string|undefined}
   */
  _normalizeProtocol(value) {
    if (value == null || value === '') return undefined;
    const protocol = String(value).trim();
    const allowed = new Set(['TCP', 'UDP', 'ICMPv4', 'ICMPv6', 'Any']);
    if (!allowed.has(protocol)) {
      throw new InvalidInputError(`Unsupported protocol: ${protocol}`);
    }
    return protocol === 'Any' ? undefined : protocol;
  }

  /**
   * Normalize a remote address for import.
   * @param {string|null|undefined} value
   * @returns {string|undefined}
   */
  _normalizeRemoteAddress(value) {
    if (value == null || value === '') return undefined;
    const raw = String(value).trim();
    if (!raw || raw === 'Any') return undefined;
    // Multi-value / range exports are not re-imported as address filters.
    if (raw.includes(',')) return undefined;
    if (!isValidIp(raw)) {
      throw new InvalidInputError(`Invalid remote address: ${raw}`);
    }
    return raw;
  }

  /**
   * Validate a single imported rule shape before creating it.
   * @param {Object} rule
   * @param {number} index
   */
  _validateImportRule(rule, index) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new InvalidInputError(`Rule at index ${index} is invalid.`);
    }
    if (!rule.name || !rule.direction || !rule.action) {
      throw new InvalidInputError(`Rule at index ${index} is missing name, direction, or action.`);
    }
    if (String(rule.name).length > 256) {
      throw new InvalidInputError(`Rule at index ${index} has a name that is too long.`);
    }
    const dir = String(rule.direction);
    const action = String(rule.action);
    if (dir !== 'Inbound' && dir !== 'Outbound') {
      throw new InvalidInputError(`Rule "${rule.name}" has an invalid direction.`);
    }
    if (action !== 'Allow' && action !== 'Block') {
      throw new InvalidInputError(`Rule "${rule.name}" has an invalid action.`);
    }
    // Throw early for bad address/port/protocol shapes before shelling out.
    try {
      this._normalizeRemoteAddress(rule.remoteAddress);
      this._normalizePort(rule.remotePort);
      this._normalizePort(rule.localPort);
      this._normalizeProtocol(rule.protocol);
    } catch (normErr) {
      throw new InvalidInputError(`Rule at index ${index} has invalid fields: ${normErr.message}`);
    }
  }

  /**
   * Import firewall rules from a previously exported payload.
   * @param {Object} payload
   * @param {number} [payload.version]
   * @param {Array} [payload.rules]
   * @param {string} [options.onConflict] - "skip" | "overwrite" | "rename"
   * @returns {Promise<Object>} Import summary.
   */
  async importRules(payload, options = {}) {
    const onConflict = ['skip', 'overwrite', 'rename'].includes(options.onConflict)
      ? options.onConflict
      : 'skip';

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new InvalidInputError('Import payload must be a JSON object.');
    }
    if (payload.version != null && Number(payload.version) !== 1) {
      throw new InvalidInputError(`Unsupported firewall export version: ${payload.version}`);
    }
    const rules = Array.isArray(payload.rules) ? payload.rules : null;
    if (!rules) {
      throw new InvalidInputError('Import file must include a "rules" array.');
    }
    if (rules.length > 500) {
      throw new InvalidInputError('Import file contains too many rules (limit 500).');
    }

    const existing = await this.listRules();
    const existingNames = new Set(existing.map((r) => r.name));

    const summary = { created: 0, skipped: 0, overwritten: 0, renamed: 0, errors: [] };

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      try {
        this._validateImportRule(rule, i);
        let name = String(rule.name);
        if (!name.startsWith(APP_RULE_PREFIX)) {
          name = `${APP_RULE_PREFIX}${name.replace(/^Soterios\s*-\s*/i, '')}`;
        }

        const exists = existingNames.has(name);
        let mode = 'create';
        if (exists && onConflict === 'skip') {
          summary.skipped += 1;
          continue;
        }
        if (exists && onConflict === 'overwrite') {
          mode = 'overwrite';
          await this.deleteRule(name);
          existingNames.delete(name);
        }
        if (exists && onConflict === 'rename') {
          mode = 'rename';
          let suffix = 2;
          let candidate = `${name} (${suffix})`;
          while (existingNames.has(candidate)) {
            suffix += 1;
            candidate = `${name} (${suffix})`;
          }
          name = candidate;
        }

        let created;
        try {
          created = await this.createRule({
            name,
            direction: rule.direction,
            action: rule.action,
            protocol: this._normalizeProtocol(rule.protocol),
            remoteAddress: this._normalizeRemoteAddress(rule.remoteAddress),
            remotePort: this._normalizePort(rule.remotePort),
            localPort: this._normalizePort(rule.localPort),
            program: rule.program || undefined
          });
        } catch (createErr) {
          if (mode === 'overwrite') {
            throw new InvalidInputError(
              `Rule "${name}" was removed during overwrite but could not be recreated: ${createErr.message || createErr}`
            );
          }
          throw createErr;
        }

        if (rule.enabled === false && created && created.name) {
          try {
            await this.setRuleEnabled(created.name, false);
          } catch (_) {
            /* created as enabled; toggle is best-effort */
          }
        }

        existingNames.add(created.name);
        if (mode === 'overwrite') summary.overwritten += 1;
        else if (mode === 'rename') summary.renamed += 1;
        else summary.created += 1;
      } catch (e) {
        summary.errors.push(e.message || String(e));
      }
    }

    return { success: summary.errors.length === 0, ...summary };
  }
}

module.exports = FirewallManager;
module.exports.APP_RULE_PREFIX = APP_RULE_PREFIX;