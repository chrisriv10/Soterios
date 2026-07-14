const crypto = require('crypto');

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

// Expanded from the original 19-entry list. Still nowhere near a full
// breach-corpus (that would need an external wordlist file), but this is
// enough to catch the passwords/base-words people overwhelmingly reach for,
// which is what actually matters for a "did you pick something guessable"
// check -- exhaustive coverage matters far less than catching the common
// cases with high confidence.
// Passwords longer than this are flagged — very long passwords are hard to
// remember, often indicate copy-paste from a generator without storage, and
// can hit input limits on some sites.
const MAX_RECOMMENDED_PASSWORD_LENGTH = 64;

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '123456789', '12345678',
  '1234567', '1234567890', 'qwerty', 'qwerty123', 'qwertyuiop', 'letmein',
  'letmein1', 'admin', 'administrator', 'welcome', 'welcome1', 'monkey',
  'dragon', 'football', 'baseball', 'basketball', 'iloveyou', 'trustno1',
  'abc123', '111111', '000000', '123123', 'sunshine', 'master', 'login',
  'starwars', 'princess', 'shadow', 'superman', 'batman', 'freedom',
  'whatever', 'ninja', 'mustang', 'access', 'flower', 'hunter', 'ranger',
  'buster', 'soccer', 'hockey', 'killer', 'george', 'jennifer', 'michael',
  'jordan', 'michelle', 'daniel', 'computer', 'internet', 'service',
  'default', 'guest', 'test', 'test123', 'temp', 'temp123', 'changeme',
  'passw0rd', 'p@ssword', 'p@ssw0rd', 'root', 'toor', 'user', 'oracle',
  'summer', 'winter', 'spring', 'autumn', 'august', 'september', 'october',
  'november', 'december', 'january', 'chocolate', 'cookie', 'coffee',
  'pepper', 'pirate', 'wizard', 'dolphin', 'tiger', 'eagle', 'falcon',
  'phoenix', 'diamond', 'silver', 'golden', 'purple', 'orange', 'yellow',
  'zaq1zaq1', 'qazwsx', '1qaz2wsx', 'asdfghjkl', 'asdf1234', 'iloveu',
  'loveme', 'nothing', 'secret', 'security', 'money', 'cheese', 'donald',
  'trump', 'biden', 'harley', 'ranger1', 'matrix', 'startrek', 'ferrari',
  'corvette', 'thunder', 'blessed', 'liverpool', 'chelsea', 'arsenal',
  'gladiator', 'sparta', 'legend', 'cowboys', 'yankees', 'raiders'
]);

// Common leetspeak substitutions, used to catch "p@ssw0rd"-style variants of
// dictionary words that a pure exact-match check would miss entirely.
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
function deleetify(password) {
  return password
    .toLowerCase()
    .split('')
    .map((ch) => LEET_MAP[ch] || ch)
    .join('');
}

// Adjacent-key substrings (both directions) from the standard US QWERTY
// layout. Catches "qazwsx", "asdfgh", "1qaz2wsx", "poiuyt", etc. -- keyboard
// walks that look "random" by charset-entropy math but are some of the most
// commonly guessed password shapes there are.
const KEYBOARD_ROWS = [
  '`1234567890-=',
  'qwertyuiop[]\\',
  'asdfghjkl;\'',
  'zxcvbnm,./',
  '1qaz2wsx3edc4rfv5tgb'
];
function buildKeyboardSequences(minLen = 4) {
  const seqs = new Set();
  for (const row of KEYBOARD_ROWS) {
    for (let i = 0; i <= row.length - minLen; i++) {
      const fwd = row.slice(i, i + minLen);
      seqs.add(fwd);
      seqs.add(fwd.split('').reverse().join(''));
    }
  }
  return seqs;
}
const KEYBOARD_SEQUENCES = buildKeyboardSequences(4);
function hasKeyboardWalk(password) {
  const lower = password.toLowerCase();
  for (const seq of KEYBOARD_SEQUENCES) {
    if (lower.includes(seq)) return true;
  }
  return false;
}

// Generalizes the original hardcoded '0123|1234|...' regex to any run of
// ascending or descending consecutive character codes, of any length and
// starting anywhere -- so "6789", "jklm", "fedcba" are all caught, not just
// the specific runs someone thought to hardcode.
function hasSequentialRun(password, minRun = 4) {
  const s = password.toLowerCase();
  let asc = 1;
  let desc = 1;
  for (let i = 1; i < s.length; i++) {
    const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
    asc = diff === 1 ? asc + 1 : 1;
    desc = diff === -1 ? desc + 1 : 1;
    if (asc >= minRun || desc >= minRun) return true;
  }
  return false;
}

// Same idea for repetition: the original only caught a password that is
// ENTIRELY one repeated character ("aaaaaaaa"). This catches any repeated
// run of 3+ within a longer password ("aaaa1234!") and any whole-password
// repeated block ("abcabcabc", "12121212").
function hasRepeatedRun(password, minRun = 3) {
  let run = 1;
  for (let i = 1; i < password.length; i++) {
    run = password[i] === password[i - 1] ? run + 1 : 1;
    if (run >= minRun) return true;
  }
  return false;
}
function isRepeatedPattern(password) {
  const n = password.length;
  for (let size = 1; size <= Math.floor(n / 2); size++) {
    if (n % size !== 0) continue;
    if (password.slice(0, size).repeat(n / size) === password) return true;
  }
  return false;
}

// Years and common date shapes (mmddyyyy, ddmmyyyy) are frequently embedded
// in passwords (birth years, graduation years) and are guessable even when
// they satisfy a "must contain a digit" policy.
function hasDatePattern(password) {
  return /\b(19\d{2}|20\d{2})\b/.test(password) || /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(password);
}

// Does the deleetified password contain a known common password/word as a
// substantial substring? Catches "Password123!" and "p@ssw0rd2024", not
// just an exact "password" match.
function containsCommonSubstring(password) {
  const deleeted = deleetify(password);
  for (const word of COMMON_PASSWORDS) {
    if (word.length < 4) continue; // skip very short entries, too many false positives as substrings
    if (deleeted.includes(word)) return word;
  }
  return null;
}

function secureRandomInt(maxExclusive) { return crypto.randomInt(0, maxExclusive); }

function generatePassword({ length = 16, useLower = true, useUpper = true, useDigits = true, useSymbols = true, excludeAmbiguous = false } = {}) {
  let pool = '';
  if (useLower) pool += LOWER;
  if (useUpper) pool += UPPER;
  if (useDigits) pool += DIGITS;
  if (useSymbols) pool += SYMBOLS;
  if (excludeAmbiguous) pool = pool.replace(/[Il1O0o]/g, '');
  if (!pool) throw new Error('At least one character set must be enabled');
  if (length < 4 || length > 128) throw new Error('Length must be between 4 and 128');

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
  while (chars.length < length) chars.push(pool[secureRandomInt(pool.length)]);

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

// Rough, qualitative crack-time estimate for an offline attack against a
// reasonably fast hash. Deliberately coarse (bucketed, not a precise
// seconds figure) since precision here would be false precision -- the
// real-world number depends entirely on the attacker's hash algorithm and
// hardware, which this has no way to know.
function crackTimeEstimate(score) {
  if (score < 20) return 'Instantly';
  if (score < 40) return 'Minutes to hours';
  if (score < 60) return 'Days to months';
  if (score < 80) return 'Years';
  return 'Centuries';
}

function checkStrength(password) {
  if (!password) return { score: 0, label: 'Empty', entropyBits: 0, issues: ['No password provided'], crackTimeEstimate: 'Instantly' };

  const issues = [];
  const lower = password.toLowerCase();
  const isExactCommon = COMMON_PASSWORDS.has(lower);
  const commonSubstring = !isExactCommon ? containsCommonSubstring(password) : null;
  const keyboardWalk = hasKeyboardWalk(password);
  const sequentialRun = hasSequentialRun(password);
  const repeatedRun = hasRepeatedRun(password) || isRepeatedPattern(password);
  const datePattern = hasDatePattern(password);

  if (password.length < 8) issues.push('Shorter than 8 characters');
  if (password.length > MAX_RECOMMENDED_PASSWORD_LENGTH) issues.push('Too long password');
  if (!/[a-z]/.test(password)) issues.push('No lowercase letters');
  if (!/[A-Z]/.test(password)) issues.push('No uppercase letters');
  if (!/[0-9]/.test(password)) issues.push('No digits');
  if (!/[^a-zA-Z0-9]/.test(password)) issues.push('No symbols');
  if (isExactCommon) issues.push('This is one of the most commonly used passwords');
  else if (commonSubstring) issues.push(`Contains a common word or password ("${commonSubstring}"), with or without substitutions`);
  if (keyboardWalk) issues.push('Contains a keyboard pattern (e.g. qwerty, asdf, 1qaz2wsx)');
  if (sequentialRun) issues.push('Contains a sequential run of characters (e.g. 1234, abcd)');
  if (repeatedRun) issues.push('Contains a repeated character or repeated block');
  if (datePattern) issues.push('Contains a year or date, which is often guessable (e.g. birth year)');

  // Base score from charset-diversity entropy, same idea as before.
  const entropyBits = estimateEntropyBits(password);
  let score = Math.min(100, Math.round((entropyBits / 80) * 100));

  // Weakest-link penalties: a password can look high-entropy by raw charset
  // math while still being trivially guessable because it's built entirely
  // from a known pattern. Real attackers try dictionaries, keyboard walks,
  // and common substitutions *before* brute force, so those patterns need
  // to cap the score regardless of what the charset math says.
  if (isExactCommon) {
    score = Math.min(score, 3);
  } else {
    if (commonSubstring) score -= 45;
    if (keyboardWalk) score -= 35;
    if (sequentialRun) score -= 30;
    if (repeatedRun) score -= 30;
    if (datePattern) score -= 8;
  }
  // Softer, additive penalties for missing character classes / short length.
  score -= issues.length * 4;
  score = Math.max(0, Math.min(100, score));

  let label;
  if (isExactCommon || score < 25) label = 'Very Weak';
  else if (score < 50) label = 'Weak';
  else if (score < 70) label = 'Moderate';
  else if (score < 90) label = 'Strong';
  else label = 'Very Strong';

  return { score, label, entropyBits, issues, crackTimeEstimate: crackTimeEstimate(score) };
}

module.exports = [
  {
    id: 'password-generator', name: 'Password Generator',
    description: 'Generate cryptographically random passwords with customizable rules.',
    category: 'Security', icon: 'key',
    run: async (args) => { const password = generatePassword(args); return { password, strength: checkStrength(password) }; }
  },
  {
    id: 'password-strength-checker', name: 'Password Strength Checker',
    description: 'Analyze a password against dictionary, keyboard-pattern, sequence, and repetition attacks -- not just raw character-set math.',
    category: 'Security', icon: 'shield-check',
    run: async (args) => { return checkStrength(args && args.password ? String(args.password) : ''); }
  }, 

];
module.exports.helpers = {
  KeyboardWalk: hasKeyboardWalk,
  SequentialRun: hasSequentialRun,
  RepeatedRun: hasRepeatedRun,
  RepeatedPattern: isRepeatedPattern,
  DatePattern: hasDatePattern,
  CommonSubstring: containsCommonSubstring,
  Strength: checkStrength
};
