/**
 * Audit logging constants and helper.
 *
 * All sensitive security actions should call log() after the primary
 * action completes so there is an immutable record of who did what.
 */
'use strict';

/**
 * Well-known audit action identifiers.
 * @readonly
 * @enum {string}
 */
const ACTIONS = Object.freeze({
  FIREWALL_RULE_CREATE: 'firewall.rule.create',
  FIREWALL_RULE_DELETE: 'firewall.rule.delete',
  FIREWALL_RULE_TOGGLE: 'firewall.rule.toggle',
  LOCKDOWN_ACTIVATE: 'lockdown.activate',
  LOCKDOWN_RESTORE: 'lockdown.restore',
  QUARANTINE_ADD: 'quarantine.add',
  QUARANTINE_RESTORE: 'quarantine.restore',
  QUARANTINE_DELETE: 'quarantine.delete',
  PROCESS_KILL: 'process.kill',
  SETTING_CHANGE: 'setting.change',
  MAINTENANCE_RUN: 'maintenance.run',
});

/**
 * Append an audit entry. Failures are swallowed so audit logging
 * never breaks the primary action.
 *
 * @param {DatabaseService} db - Database service instance.
 * @param {string} action - One of ACTIONS.
 * @param {*} [detail] - Action detail payload.
 * @param {*} [result] - Action result payload.
 * @param {boolean} [userInitiated=false] - Whether the user triggered this.
 */
function log(db, action, detail, result, userInitiated = false) {
  if (!db || !action) return;
  try {
    db.addAuditEntry({
      action,
      detail: JSON.stringify(detail),
      result: JSON.stringify(result),
      userInitiated: userInitiated ? 1 : 0,
    });
  } catch (_) {
    // Audit logging must never break the primary action.
  }
}

module.exports = { ACTIONS, log };
