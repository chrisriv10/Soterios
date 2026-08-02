'use strict';

const { InvalidInputError } = require('../../utils/errors');

/**
 * Validate IPC arguments against a schema.
 *
 * Schema shape (array of rule objects):
 * [
 *   { name: 'targetPaths', type: 'array', required: true, minItems: 1 },
 *   { name: 'limit', type: 'number', required: false, min: 1, max: 500 },
 *   { name: 'channel', type: 'string', required: true, allowed: ['scan','custom'] },
 *   { name: 'path', type: 'string', required: true, pattern: /^[A-Za-z]:\\/ }
 * ]
 *
 * Supported type validators: 'string', 'number', 'boolean', 'array', 'object'
 * Supported constraints: required, min, max, minItems, maxItems, allowed, pattern
 *
 * @param {{ name: string, type: string, required?: boolean, min?: number, max?: number, minItems?: number, maxItems?: number, allowed?: any[], pattern?: RegExp }[]} schema
 * @param {object|Array} args
 * @returns {object|Array} validated args (same shape as input)
 * @throws {InvalidInputError}
 */
function validateArgs(schema, args) {
  if (!Array.isArray(schema)) {
    throw new InvalidInputError('Schema must be an array of validation rules.');
  }

  const source = Array.isArray(args) ? args : { ...args };

  for (const rule of schema) {
    const { name, type, required } = rule;
    let value;

    if (Array.isArray(source)) {
      // positional args: schema entries are matched by index
      const idx = schema.indexOf(rule);
      value = source[idx];
    } else {
      value = source[name];
    }

    if (required && (value === undefined || value === null)) {
      throw new InvalidInputError(`Missing required argument: ${name}`);
    }

    if (value === undefined || value === null) {
      continue;
    }

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== type) {
      throw new InvalidInputError(
        `Argument "${name}" must be of type ${type}, got ${actualType}.`
      );
    }

    if (type === 'string') {
      const str = String(value);
      if (str.length === 0) {
        throw new InvalidInputError(`Argument "${name}" must be a non-empty string.`);
      }
      if (rule.pattern && !rule.pattern.test(str)) {
        throw new InvalidInputError(
          `Argument "${name}" does not match required pattern.`
        );
      }
      if (rule.allowed && !rule.allowed.includes(str)) {
        throw new InvalidInputError(
          `Argument "${name}" must be one of: ${rule.allowed.join(', ')}.`
        );
      }
    }

    if (type === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        throw new InvalidInputError(`Argument "${name}" must be a finite number.`);
      }
      if (rule.min != null && num < rule.min) {
        throw new InvalidInputError(
          `Argument "${name}" must be >= ${rule.min}.`
        );
      }
      if (rule.max != null && num > rule.max) {
        throw new InvalidInputError(
          `Argument "${name}" must be <= ${rule.max}.`
        );
      }
    }

    if (type === 'array') {
      const arr = value;
      if (rule.minItems != null && arr.length < rule.minItems) {
        throw new InvalidInputError(
          `Argument "${name}" must contain at least ${rule.minItems} item(s).`
        );
      }
      if (rule.maxItems != null && arr.length > rule.maxItems) {
        throw new InvalidInputError(
          `Argument "${name}" must contain at most ${rule.maxItems} item(s).`
        );
      }
    }
  }

  return source;
}

module.exports = { validateArgs };
