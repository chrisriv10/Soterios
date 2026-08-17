'use strict';

/**
 * Centralized logger for Soterios main-process code.
 *
 * Levels: debug < info < warn < error
 * Console output is always enabled; optional file append is opt-in.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel = LEVELS.info;
let filePath = null;
let fsRef = null;

/**
 * Configures the global logger settings.
 *
 * @param {{level?: string, filePath?: string|null}} [options={}] - Logger options.
 */
function configure(options = {}) {
  if (options.level && LEVELS[options.level] != null) {
    minLevel = LEVELS[options.level];
  }
  if (options.filePath) {
    filePath = options.filePath;
    fsRef = require('fs');
    const path = require('path');
    try {
      fsRef.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (_) {
      /* ignore */
    }
  }
  if (options.filePath === null) {
    filePath = null;
  }
}

/**
 * Determines whether a message at the given level should be logged.
 *
 * @param {string} level - Log level.
 * @returns {boolean} True if the level meets the current threshold.
 */
function shouldLog(level) {
  return (LEVELS[level] || 0) >= minLevel;
}

/**
 * Formats a log line with timestamp, level, message, and optional metadata.
 *
 * @param {string} level - Log level.
 * @param {string} message - Log message.
 * @param {*} [meta] - Optional metadata.
 * @returns {string} Formatted log line.
 */
function formatLine(level, message, meta) {
  const ts = new Date().toISOString();
  let metaStr = '';
  if (meta !== undefined && meta !== null) {
    if (meta instanceof Error) {
      metaStr = ' ' + JSON.stringify({
        name: meta.name,
        error: meta.message,
        stack: meta.stack
      });
    } else if (typeof meta === 'object' && !Array.isArray(meta)) {
      const keys = Object.keys(meta);
      if (keys.length) {
        metaStr = ' ' + JSON.stringify(meta);
      } else if (meta.message || meta.stack) {
        metaStr = ' ' + JSON.stringify({
          error: meta.message || String(meta),
          stack: meta.stack || undefined
        });
      } else {
        metaStr = ' ' + JSON.stringify(String(meta));
      }
    } else {
      metaStr = ' ' + JSON.stringify(meta);
    }
  }
  return `[${ts}] ${level.toUpperCase()} ${message}${metaStr}`;
}

/**
 * Writes a log entry to the console and optional file sink.
 *
 * @param {string} level - Log level.
 * @param {string} message - Log message.
 * @param {*} [meta] - Optional metadata.
 */
function write(level, message, meta) {
  if (!shouldLog(level)) return;
  const line = formatLine(level, message, meta);
  const consoleFn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'debug'
          ? console.debug || console.log
          : console.log;
  consoleFn(line);

  if (filePath && fsRef) {
    try {
      fsRef.appendFileSync(filePath, line + '\n');
    } catch (_) {
      /* never throw from logger */
    }
  }
}

const logger = {
  configure,
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  LEVELS,
};

module.exports = logger;
