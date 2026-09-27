'use strict';

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const REFERENCE_FILE = 'en.json';

// Recursively collects leaf key paths ("settings.theme.title") so flattened
// files can be compared key-by-key. Object and array values are recorded in
// `nested` instead of being treated as valid leaves: the runtime lookup is a
// flat `catalog[key]`, so a nested object would pass a flattened comparison
// yet fail at runtime and fall back to English. Keys that appear both as a
// flat dotted key and inside a nested object are reported as duplicates.
function collectKeys(value, prefix, keys, duplicates, nested) {
  if (value !== null && typeof value === 'object') {
    if (prefix) nested.add(prefix);
    if (Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      collectKeys(child, prefix ? `${prefix}.${key}` : key, keys, duplicates, nested);
    }
    return;
  }
  if (keys.has(prefix)) duplicates.add(prefix);
  keys.add(prefix);
}

// Reads and parses a locale file without modifying it.
// Returns { keys, duplicates, nested } or { error }.
function loadLocale(file, localesDir = LOCALES_DIR) {
  const filePath = path.join(localesDir, file);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { error: `cannot read file (${err.message})` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (err) {
    return { error: `invalid JSON (${err.message})` };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'expected a JSON object of translation keys' };
  }

  const keys = new Set();
  const duplicates = new Set();
  const nested = new Set();
  collectKeys(parsed, '', keys, duplicates, nested);
  return { keys, duplicates, nested };
}

// Builds the list of problems for a loaded locale vs the reference.
// Returns an array of messages; empty when the locale is valid.
function localeProblems(reference, locale) {
  const problems = [];
  for (const key of [...reference.keys].filter((key) => !locale.keys.has(key)).sort()) {
    problems.push(`missing key: ${key}`);
  }
  for (const key of [...locale.keys].filter((key) => !reference.keys.has(key)).sort()) {
    problems.push(`extra key: ${key}`);
  }
  for (const key of [...locale.duplicates].sort()) {
    problems.push(`duplicate key: ${key}`);
  }
  for (const key of [...locale.nested].sort()) {
    problems.push(`nested object: ${key} (locale files must use flat dotted keys)`);
  }
  return problems;
}

// Problems that apply to the reference file itself: ambiguous flattened
// paths and nested structures make every other locale's comparison
// unreliable, so they must fail validation too.
function referenceProblems(reference) {
  const problems = [];
  for (const key of [...reference.duplicates].sort()) {
    problems.push(`duplicate key: ${key}`);
  }
  for (const key of [...reference.nested].sort()) {
    problems.push(`nested object: ${key} (locale files must use flat dotted keys)`);
  }
  return problems;
}

// Validates every locale file under localesDir against en.json.
// Returns { fatal } on setup errors, otherwise
// { checked, keyCount, failures: [{ file, problems }] }.
function validate(localesDir = LOCALES_DIR) {
  if (!fs.existsSync(localesDir)) {
    return { fatal: `Locales directory not found: ${localesDir}` };
  }

  const files = fs.readdirSync(localesDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  if (!files.includes(REFERENCE_FILE)) {
    return { fatal: `Reference locale ${REFERENCE_FILE} not found in ${localesDir}` };
  }

  const reference = loadLocale(REFERENCE_FILE, localesDir);
  if (reference.error) {
    return { fatal: `${REFERENCE_FILE}: ${reference.error}` };
  }

  const failures = [];
  const refProblems = referenceProblems(reference);
  if (refProblems.length) {
    failures.push({ file: REFERENCE_FILE, problems: refProblems });
  }

  let checked = 0;
  for (const file of files) {
    if (file === REFERENCE_FILE) continue;
    checked++;

    const locale = loadLocale(file, localesDir);
    if (locale.error) {
      failures.push({ file, problems: [locale.error] });
      continue;
    }

    const problems = localeProblems(reference, locale);
    if (problems.length) {
      failures.push({ file, problems });
    }
  }

  return { checked, keyCount: reference.keys.size, failures };
}

function main() {
  const result = validate(LOCALES_DIR);

  if (result.fatal) {
    console.error(result.fatal);
    process.exitCode = 1;
    return;
  }

  for (const { file, problems } of result.failures) {
    console.error(`${file}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }

  if (result.failures.length) {
    console.error(`i18n validation failed: ${result.failures.length} of ${result.checked + 1} locale file(s) have problems (reference: ${REFERENCE_FILE}).`);
    process.exitCode = 1;
  } else {
    console.log(`i18n validation passed: ${result.checked} locale(s) match ${REFERENCE_FILE} (${result.keyCount} keys each).`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  LOCALES_DIR,
  REFERENCE_FILE,
  collectKeys,
  loadLocale,
  localeProblems,
  referenceProblems,
  validate
};
