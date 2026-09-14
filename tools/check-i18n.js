'use strict';

// Reports locale strings that are still identical to en.json, which usually
// means they were copied over (e.g. by tools/sync-missing-i18n.js) but never
// translated. This is a read-only report: it exits 0 even when matches are
// found unless --strict is passed, so existing untranslated strings do not
// break CI. Complements tools/validate-i18n.js, which checks key parity
// (missing/extra keys) rather than untranslated values.

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const REFERENCE_FILE = 'en.json';
const MAX_VALUE_DISPLAY = 90;

// Values that are expected to stay identical across locales: product/brand
// names, units, protocols, and common technical acronyms. Extend this list
// when a reported term is intentionally kept in English.
const EXEMPT_VALUES = new Set([
  // Product and service names
  'Soterios', 'ClamAV', 'XposedOrNot', 'HIBP', 'Have I Been Pwned',
  'Chrome', 'Edge', 'Brave', 'Firefox', 'Windows', 'Microsoft',
  'Electron', 'Node.js', 'Rust',
  // OS features and product names that stay in English in most locales
  'Windows Defender', 'Windows Security', 'Windows Settings',
  'Windows Update', 'Windows Firewall', 'BitLocker', 'PowerShell',
  'Task Manager', 'Task Scheduler', 'Control Panel', 'File Explorer',
  'Event Viewer', 'Registry Editor', 'Real-Time Protection',
  // Protocol and connection-state literals
  'Time Wait', 'Close Wait', 'Established', 'Listen', 'Syn Sent',
  'SMBv1', 'SMBv2', 'SMBv3', 'WHOIS',
  // Units
  'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'kB', 'KiB', 'MiB', 'GiB',
  'ms', 'ns', 'Hz', 'MHz', 'GHz', 'W', 'V', 'A',
  // Acronyms and technical identifiers
  'CPU', 'GPU', 'RAM', 'OS', 'PC', 'IP', 'IPv4', 'IPv6', 'MAC', 'DNS',
  'DHCP', 'NAT', 'HTTP', 'HTTPS', 'URL', 'URI', 'VPN', 'LAN', 'WAN',
  'WLAN', 'Wi-Fi', 'TCP', 'UDP', 'ICMP', 'SSL', 'TLS', 'DoH', 'SSH',
  'FTP', 'SFTP', 'SMB', 'RDP', 'NTP', 'SNMP', 'WMI', 'USB', 'SSD', 'HDD',
  'NVMe', 'SATA', 'BIOS', 'UEFI', 'TPM', 'NTFS', 'FAT32', 'exFAT',
  'PDF', 'CSV', 'HTML', 'CSS', 'JSON', 'XML', 'YAML', 'CLI', 'GUI', 'UI',
  'API', 'SDK', 'OK', 'ID', 'AI', 'IoT', 'VM', 'ISO', 'SQL', 'QR',
  'GUID', 'UUID', 'ASCII', 'UTF-8', 'UTF-16', 'SHA-1', 'SHA-256', 'MD5',
  'AES', 'RSA', '2FA', 'MFA', 'OTP', 'TOTP', 'DNS over HTTPS',
]);

// Matches values that carry no translatable text: URLs, emails, file paths,
// registry keys, environment variables, CLI flags, version numbers, and
// strings that consist only of {placeholders} or non-letter characters.
// Every pattern is anchored: the ENTIRE value must match, so a translatable
// sentence that merely contains a URL, path, or env var is still reported.
// Path-like patterns allow spaces inside segments only when the value starts
// with an unambiguous prefix (drive letter, \\, registry hive, or %VAR%);
// segments are written as [^\\/]+ (anything-but-separator) so each separator
// split is deterministic and the regex cannot backtrack on space runs.
// Bare rooted/relative paths stay space-free so "word/word" text is not
// mistaken for a path.
const EXEMPT_PATTERNS = [
  /^[a-z][a-z0-9+.-]*:\/\/\S+$/i,            // URLs (http://, chrome://, …)
  /^www\.\S+$/i,                             // bare www links
  /^[a-z0-9_*-]+(\.[a-z0-9_-]+)+$/i,         // bare hostnames (vpn.example.com)
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/,              // email addresses
  /^[A-Z]:[\\/](?:[^\\/]+[\\/])*[^\\/]*$/i,  // Windows drive paths (C:\…)
  /^[\\/]{2}[^\\/]+(?:[\\/][^\\/]+)*[\\/]?$/, // UNC paths (\\server\share)
  /^[\\/][\w.-]+(?:[\\/][\w.-]+)*[\\/]?$/,   // rooted paths (/etc/hosts, \System32)
  /^[\w.-]+(?:[\\/][\w.-]+)+[\\/]$|^[\w.-]+(?:[\\/][\w.-]+){2,}$/, // relative paths (assets/clamav/, a\b\c)
  /^(?:HKEY_[A-Z_]+|HKLM|HKCU):?(?:\\[^\\]+)*\\?$/i, // registry keys
  /^%[\w()]+%(?:[\\/][^\\/]+)*$/i,           // env vars like %APPDATA% (optionally followed by a path)
  /^--?[\w-]+(?:=\S+)?$/,                    // CLI flags (-v, --verbose, --output=json)
  /^v?\d+(\.\d+)+([-.][\w.-]*)?$/,           // version numbers
  /^[\w.-]+\.(exe|dll|sys|json|js|mjs|cjs|ts|ps1|bat|cmd|sh|log|txt|md|reg|xml|ya?ml|ini|cfg|toml|zip|7z|png|jpe?g|ico|svg|html?|csv|pdf|msi|dat|tmp|bak|key|pem|pub|sig|plist|app|dmg|pkg|deb|rpm)$/i, // file names
];

function isExempt(value) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (EXEMPT_VALUES.has(trimmed)) return true;
  // No letters at all: punctuation, digits, symbols (",", "—", "100%").
  if (!/\p{L}/u.test(trimmed)) return true;
  // Only placeholders or markup: every character is inside a {token}, a
  // %VAR%, or is a non-letter (punctuation, digits, symbols). The {token}
  // body may not contain '<', and bare <…> spans are not exempt, so a
  // value holding something like <script is still reported.
  if (/^(?:\{[^{}<]*\}|%[\w]+%|[^\p{L}])*$/u.test(trimmed)) return true;
  return EXEMPT_PATTERNS.some((re) => re.test(trimmed));
}

// Recursively collects leaf string values keyed by dotted path so flat files
// ("a.b": "x") and nested files ({a: {b: "x"}}) compare on equal footing.
// Non-string leaves are ignored: numbers and booleans cannot be untranslated.
function collectStrings(value, prefix, out) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectStrings(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (typeof value === 'string' && prefix) {
    out.set(prefix, value);
  }
}

// Reads and parses a locale file without modifying it.
// Returns { strings } or { error }.
function loadLocale(file) {
  const filePath = path.join(LOCALES_DIR, file);
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
    return { error: 'expected a JSON object of translation strings' };
  }

  const strings = new Map();
  collectStrings(parsed, '', strings);
  return { strings };
}

function truncate(value) {
  return value.length > MAX_VALUE_DISPLAY
    ? `${value.slice(0, MAX_VALUE_DISPLAY - 1)}…`
    : value;
}

function printHelp() {
  console.log(`Usage: node tools/check-i18n.js [--strict]

Scans every locale in src/i18n/locales/ against ${REFERENCE_FILE} and reports
strings whose translated value is still identical to the English source.

Options:
  --strict   exit 1 when identical strings are found (for CI use)
  -h, --help show this help

Exits 0 by default so existing untranslated strings do not break builds.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }
  const strict = args.includes('--strict');
  const unknown = args.filter((a) => a !== '--strict');
  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(', ')}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(LOCALES_DIR)) {
    console.error(`Locales directory not found: ${LOCALES_DIR}`);
    process.exitCode = 1;
    return;
  }

  const reference = loadLocale(REFERENCE_FILE);
  if (reference.error) {
    console.error(`${REFERENCE_FILE}: ${reference.error}`);
    process.exitCode = 1;
    return;
  }

  const localeFiles = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json') && f !== REFERENCE_FILE)
    .sort();

  if (!localeFiles.length) {
    console.log(`No non-English locale files found in ${LOCALES_DIR}`);
    return;
  }

  console.log(`check:i18n — scanning ${localeFiles.length} locale(s) against ${REFERENCE_FILE}\n`);

  let hadError = false;
  let totalMatches = 0;
  let localesWithMatches = 0;

  for (const file of localeFiles) {
    const result = loadLocale(file);
    if (result.error) {
      console.error(`${file}: ${result.error}`);
      hadError = true;
      continue;
    }

    const matches = [];
    for (const [key, value] of result.strings) {
      if (reference.strings.get(key) === value && !isExempt(value)) {
        matches.push([key, value]);
      }
    }

    if (!matches.length) {
      console.log(`${file}: no untranslated strings found`);
      continue;
    }

    localesWithMatches += 1;
    totalMatches += matches.length;
    console.log(`${file}: ${matches.length} string(s) identical to English`);
    for (const [key, value] of matches) {
      console.log(`  ${key} = "${truncate(value)}"`);
    }
    console.log('');
  }

  if (hadError) {
    process.exitCode = 1;
    return;
  }

  console.log(
    `Summary: ${totalMatches} string(s) identical to English across ` +
      `${localesWithMatches}/${localeFiles.length} locale(s).`
  );
  console.log(
    'Identical values are not always errors — brand names, units, and shared ' +
      'loanwords can legitimately match. Extend EXEMPT_VALUES in this script ' +
      'for terms that should stay in English.'
  );

  if (strict && totalMatches > 0) {
    process.exitCode = 1;
  }
}

main();
