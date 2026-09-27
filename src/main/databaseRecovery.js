'use strict';

/**
 * Application-startup database recovery for issue #165.
 *
 * `DatabaseService` stays strict ("open this database or throw"). This module
 * owns the only policy that may set a damaged database aside: when a strict
 * open fails with CONFIRMED SQLite corruption, the damaged database family
 * (`soterios.db` + existing `-wal`/`-shm` sidecars) is preserved under
 * collision-safe `.corrupt-<id>` names and exactly one fresh database is
 * created at the canonical path. Anything else — permission errors, disk
 * full, bad paths, schema/programming bugs, valid SQLite with an unexpected
 * schema — propagates untouched.
 *
 * No salvage is attempted: damaged files are preserved for possible later
 * manual recovery, never parsed, merged, replayed, or deleted.
 */

const fs = require('fs');
const path = require('path');
const DatabaseService = require('../core/database');

// SQLite result codes that unambiguously mean the file itself is damaged.
// Observed with better-sqlite3 v13: garbage/truncated files fail open/init
// with SQLITE_NOTADB; page-level damage fails reads with SQLITE_CORRUPT.
const CORRUPTION_CODES = Object.freeze(new Set(['SQLITE_NOTADB', 'SQLITE_CORRUPT']));

// Exact engine messages for the same two states, used only when no usable
// result code is present. These strings come from SQLite itself, so a
// permission, schema, or programming error can never produce them.
const CORRUPTION_MESSAGE_PATTERN = /file is not a database|database disk image is malformed/i;

const MAX_ERROR_TEXT_CHARS = 500;
const MAX_COLLISION_SUFFIXES = 1000;

function truncateText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Unknown database error';
  return text.length > MAX_ERROR_TEXT_CHARS ? `${text.slice(0, MAX_ERROR_TEXT_CHARS)}…` : text;
}

/**
 * Decide whether an open/init failure is CONFIRMED SQLite corruption.
 * Fail-closed: anything without a corruption code (or, absent a code, without
 * one of SQLite's own corruption messages) is not corruption.
 */
function isConfirmedCorruptionError(error) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return false;
  const code = error.code;
  if (typeof code === 'string' && code.length > 0) {
    return CORRUPTION_CODES.has(code);
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return CORRUPTION_MESSAGE_PATTERN.test(message);
}

/**
 * Format a Windows-safe recovery identifier (no colons): 20260925T231500123Z.
 */
function formatRecoveryId(date = new Date()) {
  const pad = (value, length) => String(value).padStart(length, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}`
    + `T${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}`
    + `${pad(date.getUTCMilliseconds(), 3)}Z`;
}

function isPreservableFile(fsModule, filePath) {
  try {
    return fsModule.existsSync(filePath) && fsModule.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

/**
 * Existing members of the damaged database family. Sidecars are included
 * only when actually present; a main path that is not a regular file is
 * never moved (fail closed instead).
 *
 * Note: the failed strict open itself may already have dropped foreign
 * -wal/-shm files (SQLite manages sidecars on open). Preservation covers
 * whatever survives; it never fabricates or fetches sidecars.
 */
function collectFamilySources(fsModule, dbPath) {
  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  return candidates.filter((candidate) => isPreservableFile(fsModule, candidate));
}

function destinationFor(sourcePath, recoveryId, attempt) {
  const suffix = attempt === 0 ? `.corrupt-${recoveryId}` : `.corrupt-${recoveryId}-${attempt}`;
  return `${sourcePath}${suffix}`;
}

/**
 * Move every source aside under one shared recovery ID. All destinations
 * are verified absent first; on any failure, completed moves are rolled
 * back and a recovery error is thrown. Never deletes anything.
 */
function preserveFamily(fsModule, sources, recoveryId) {
  let destinations = null;
  for (let attempt = 0; attempt < MAX_COLLISION_SUFFIXES; attempt += 1) {
    const claimed = sources.map((source) => destinationFor(source, recoveryId, attempt));
    if (claimed.every((destination) => !fsModule.existsSync(destination))) {
      destinations = claimed;
      break;
    }
  }
  if (!destinations) {
    throw new Error(`Could not find unused recovery names for ${sources.length} database file(s).`);
  }
  const moved = [];
  try {
    sources.forEach((source, index) => {
      fsModule.renameSync(source, destinations[index]);
      moved.push({ from: source, to: destinations[index] });
    });
  } catch (moveError) {
    const rollbackErrors = [];
    for (let index = moved.length - 1; index >= 0; index -= 1) {
      try {
        fsModule.renameSync(moved[index].to, moved[index].from);
      } catch (rollbackError) {
        rollbackErrors.push(`${moved[index].to}: ${rollbackError.message || rollbackError}`);
      }
    }
    const detail = [`Preservation failed: ${moveError.message || moveError}.`];
    if (rollbackErrors.length > 0) {
      detail.push(`Rollback incomplete: ${rollbackErrors.join('; ')}.`);
    }
    throw new Error(detail.join(' '));
  }
  return destinations;
}

/**
 * Open the application database, recovering once from confirmed corruption.
 *
 * @param {object} options
 * @param {string} options.dbPath - Canonical database path (userData/soterios.db).
 * @param {Function} [options.openDatabase] - Strict open factory, defaults to DatabaseService.
 * @param {object} [options.fsModule] - fs-shaped seam (existsSync/statSync/renameSync).
 * @param {Function} [options.now] - Clock returning a Date, for deterministic IDs.
 * @returns {{db: DatabaseService, recovery: null|{originalPath, preservedPath, preservedFiles, reason, sqliteCode}}}
 * @throws The original error for anything that is not confirmed corruption,
 * a preservation error when the damaged set cannot be moved safely, or a
 * fatal error when the single fresh-database attempt fails.
 */
function openApplicationDatabaseWithRecovery(options = {}) {
  const {
    dbPath,
    openDatabase = (targetPath) => new DatabaseService(targetPath),
    fsModule = fs,
    now = () => new Date(),
  } = options;
  if (typeof dbPath !== 'string' || dbPath.length === 0) {
    throw new Error('A database path is required.');
  }
  try {
    return { db: openDatabase(dbPath), recovery: null };
  } catch (openError) {
    if (!isConfirmedCorruptionError(openError)) {
      throw openError;
    }
    const reason = truncateText(openError.message || openError);
    const sqliteCode = typeof openError.code === 'string' ? openError.code : null;
    const sources = collectFamilySources(fsModule, dbPath);
    const recoveryId = formatRecoveryId(now());
    const preservedFiles = preserveFamily(fsModule, sources, recoveryId);
    let fresh;
    try {
      fresh = openDatabase(dbPath);
    } catch (freshError) {
      throw new Error(
        `Damaged database preserved but a fresh database could not be created: ${truncateText(freshError.message || freshError)}`
      );
    }
    return {
      db: fresh,
      recovery: {
        originalPath: dbPath,
        preservedPath: preservedFiles[0] || null,
        preservedFiles,
        reason,
        sqliteCode,
      },
    };
  }
}

module.exports = {
  openApplicationDatabaseWithRecovery,
  isConfirmedCorruptionError,
  formatRecoveryId,
  collectFamilySources,
  preserveFamily,
  CORRUPTION_CODES,
};
