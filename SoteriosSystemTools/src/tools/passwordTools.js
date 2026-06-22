// Password generator + strength checker.
// No external deps — uses Node's crypto for secure random generation.

const crypto = require('crypto');

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

// Common/weak passwords + patterns — small embedded list for offline use.
// (Not exhaustive; this is a heuristic check, not a breach database lookup.)
const COMMON_PASSWORDS = new Set([
  'password', 'password1', '123456', '123456789', 'qwerty', 'letmein',
  'admin', 'welcome', 'monkey', 'dragon', 'football', 'iloveyou',
  'abc123', '111111', '123123', 'sunshine', 'master', 'login', 'starwars'
]);

function secureRandomInt(maxExclusive) {
  // Rejection sampling against crypto.randomInt for unbiased results
  return crypto.randomInt(0, maxExclusive);
}

function generatePassword({
  length = 16,
  useLower = true,
  useUpper = true,
  useDigits = true,
  useSymbols = true,
  excludeAmbiguous = false
} = {}) {
  let pool = '';
  if (useLower) pool += LOWER;
  if (useUpper) pool += UPPER;
  if (useDigits) pool += DIGITS;
  if (useSymbols) pool += SYMBOLS;

  if (excludeAmbiguous) {
    pool = pool.replace(/[Il1O0o]/g, '');
  }

  if (!pool) throw new Error('At least one character set must be enabled');
  if (length < 4 || length > 128) throw new Error('Length must be between 4 and 128');

  // Guarantee at least one char from each selected set, then fill the rest
  const requiredSets = [];
  if (useLower) requiredSets.push(LOWER);
  if (useUpper) requiredSets.push(UPPER);
  if (useDigits) requiredSets.push(DIGITS);
  if (useSymbols) requiredSets.push(SYMBOLS);

  const chars = [];
  for (const set of requiredSets) {
    const filtered = excludeAmbiguous ? set.replace(/[Il1O0o]/g, '') : set;
    chars.push(filtered[secureRandomInt(filtered.length)]);
  }
  while (chars.length < length) {
    chars.push(pool[secureRandomInt(pool.length)]);
  }

  // Fisher-Yates shuffle using crypto randomness so required chars aren't
  // predictably at the front
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

function estimateEntropyBits(password) {
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += SYMBOLS.length;
  if (poolSize === 0) return 0;
  return Math.round(password.length * Math.log2(poolSize));
}

function checkStrength(password) {
  if (!password) {
    return { score: 0, label: 'Empty', entropyBits: 0, issues: ['No password provided'] };
  }

  const issues = [];
  const lower = password.toLowerCase();

  if (password.length < 8) issues.push('Shorter than 8 characters');
  if (!/[a-z]/.test(password)) issues.push('No lowercase letters');
  if (!/[A-Z]/.test(password)) issues.push('No uppercase letters');
  if (!/[0-9]/.test(password)) issues.push('No digits');
  if (!/[^a-zA-Z0-9]/.test(password)) issues.push('No symbols');
  if (COMMON_PASSWORDS.has(lower)) issues.push('Matches a commonly used password');
  if (/^(.)\1+$/.test(password)) issues.push('Repeated single character');
  if (/0123|1234|2345|3456|4567|5678|6789|abcd|qwerty/i.test(password)) {
    issues.push('Contains a common sequence');
  }

  const entropyBits = estimateEntropyBits(password);

  // Score 0-100 blending entropy and issue count
  let score = Math.min(100, Math.round((entropyBits / 80) * 100));
  score -= issues.length * 10;
  score = Math.max(0, Math.min(100, score));

  let label;
  if (COMMON_PASSWORDS.has(lower)) label = 'Very Weak';
  else if (score < 25) label = 'Very Weak';
  else if (score < 50) label = 'Weak';
  else if (score < 70) label = 'Moderate';
  else if (score < 90) label = 'Strong';
  else label = 'Very Strong';

  return { score, label, entropyBits, issues };
}

module.exports = [
  {
    id: 'password-generator',
    name: 'Password Generator',
    description: 'Generate cryptographically random passwords with customizable rules.',
    category: 'Security',
    icon: 'key',
    run: async (args) => {
      const password = generatePassword(args);
      return { password, strength: checkStrength(password) };
    }
  },
  {
    id: 'password-strength-checker',
    name: 'Password Strength Checker',
    description: 'Analyze a password and estimate how resistant it is to guessing/cracking.',
    category: 'Security',
    icon: 'shield-check',
    run: async (args) => {
      const password = args && args.password ? String(args.password) : '';
      return checkStrength(password);
    }
  }
];
