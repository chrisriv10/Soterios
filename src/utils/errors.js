'use strict';

/**
 * Structured error types for Soterios.
 *
 * Each class carries a machine-readable `code` and an optional `cause`
 * so callers can branch on error.code instead of regex-matching messages.
 */

class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || 'app_error';
    this.cause = options.cause || null;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serialize the error to a plain object.
   *
   * @returns {Object} Plain-object representation suitable for logging or IPC.
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      cause: this.cause ? { name: this.cause.name, message: this.cause.message } : null
    };
  }
}

/**
 * Error raised when a requested resource cannot be found.
 *
 * Carries the code `not_found`.
 */
class NotFoundError extends AppError {
  /**
   * @param {string} [message]
   * @param {{ cause?: Error }} [options]
   */
  constructor(message = 'Resource not found.', options = {}) {
    super(message, { ...options, code: 'not_found' });
  }
}

/**
 * Error raised when an operation is denied by permissions or access control.
 *
 * Carries the code `permission_denied`.
 */
class PermissionError extends AppError {
  /**
   * @param {string} [message]
   * @param {{ cause?: Error }} [options]
   */
  constructor(message = 'Permission denied.', options = {}) {
    super(message, { ...options, code: 'permission_denied' });
  }
}

/**
 * Error raised when an operation exceeds its time limit.
 *
 * Carries the code `timeout`.
 */
class TimeoutError extends AppError {
  /**
   * @param {string} [message]
   * @param {{ cause?: Error }} [options]
   */
  constructor(message = 'Operation timed out.', options = {}) {
    super(message, { ...options, code: 'timeout' });
  }
}

/**
 * Error raised when input fails validation.
 *
 * Carries the code `invalid_input`.
 */
class InvalidInputError extends AppError {
  /**
   * @param {string} [message]
   * @param {{ cause?: Error }} [options]
   */
  constructor(message = 'Invalid input.', options = {}) {
    super(message, { ...options, code: 'invalid_input' });
  }
}

module.exports = {
  AppError,
  NotFoundError,
  PermissionError,
  TimeoutError,
  InvalidInputError
};
