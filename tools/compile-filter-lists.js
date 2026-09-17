'use strict';

// Soterios narrow EasyList/EasyPrivacy -> Chrome MV3 DNR compiler (Phase 1).
//
// Build-time only: reads vendored upstream snapshots from tools/filter-lists/,
// emits static DNR rule arrays (browser-extension/rules/ads.json and
// trackers.json) plus machine-readable provenance (SOURCES.json).
//
// Design constraints (deliberate, documented):
// - Soterios-owned, zero dependencies, Node.js stdlib only. No GPL blocker
//   implementation code is reused or vendored anywhere in this pipeline.
// - Network request filtering ONLY. No cosmetic, redirect, header, scriptlet,
//   or procedural support in Phase 1.
// - Fail safe: unsupported syntax is dropped with a counted reason, never
//   reinterpreted and never broadened. Invalid generated output is rejected
//   instead of written.
// - Deterministic: same input bytes -> byte-identical output files. Rule IDs
//   come from canonical sorting, never from input/filesystem ordering.
// - Offline by default: normal runs and --check never touch the network.
//   Only an explicit --update re-fetches pinned upstream snapshots.
//
// Usage:
//   node tools/compile-filter-lists.js            compile snapshots -> artifacts
//   node tools/compile-filter-lists.mjs --check   (NOT SUPPORTED: this tool is
//     CommonJS on purpose so tests can require() it; see note below)
//   node tools/compile-filter-lists.js --check    regenerate in memory and
//     byte-compare against checked-in artifacts (no writes; nonzero exit
//     on any difference)
//   node tools/compile-filter-lists.js --update   re-fetch pinned snapshots
//     (network), refresh provenance, recompile, rewrite artifacts
//
// NOTE on module format: this file is intentionally CommonJS (.js), matching
// tools/download-clamav.js and tools/doctor.js, so tests/filterCompiler.test.js
// can require() the pure functions directly. There is no ESM equivalent.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { domainToASCII } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCES_PATH = path.join(__dirname, 'filter-sources.json');
const RULES_DIR = path.join(REPO_ROOT, 'browser-extension', 'rules');
const ADS_PATH = path.join(RULES_DIR, 'ads.json');
const TRACKERS_PATH = path.join(RULES_DIR, 'trackers.json');
const SOURCES_OUT_PATH = path.join(RULES_DIR, 'SOURCES.json');

const CONVERTER_NAME = 'soterios-filter-compiler';
const CONVERTER_VERSION = 1;
const CONVERTER_SCHEMA = 1;

// Chrome guaranteed static-rule capacity. Phase 1 enforces only the
// guaranteed minimum across both rulesets and never relies on the larger
// shared/global pool.
const MAX_COMBINED_STATIC_RULES = 30000;
// Conservative cap on requestDomains entries per generated rule. Chrome
// documents no per-array limit; this keeps individual rules human-inspectable
// with serialized sizes in the tens of kilobytes, far below any plausible
// engine concern. The value is irrelevant to correctness (more domains simply
// produce more deterministic chunks); live Chrome validation of the generated
// rulesets confirms acceptance (see the Phase 1.5 report).
const MAX_DOMAINS_PER_RULE = 1000;
// Chrome caps regex rules (evaluated separately per ruleset kind). Phase 1
// emits zero regexFilter rules; this budget guards against regressions if
// that policy ever changes.
const MAX_REGEX_RULES = 1000;

// DNR rule priority scheme (documented):
// - block rules sit at BLOCK_PRIORITY so every allow rule outranks them.
//   Exception semantics therefore never depend on equal-priority action
//   tie-breaking (which Chrome resolves block > redirect > allow).
// - $important adds IMPORTANT_BONUS within its action class, preserving the
//   ABP meaning "this rule wins over same-class conflicts".
const BLOCK_PRIORITY = 1;
const ALLOW_PRIORITY = 100;
const IMPORTANT_BONUS = 1000;

// ABP resource-type options mapped to DNR ResourceType values. Aliases used
// in the wild (xhr, beacon, object-subrequest) fold into their canonical
// DNR counterpart; anything else is an unsupported option (fail safe).
const RESOURCE_TYPE_MAP = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  font: 'font',
  media: 'media',
  object: 'object',
  'object-subrequest': 'object',
  xmlhttprequest: 'xmlhttprequest',
  xhr: 'xmlhttprequest',
  subdocument: 'sub_frame',
  ping: 'ping',
  beacon: 'ping',
  websocket: 'websocket',
  other: 'other',
};

// DNR requestMethods vocabulary (Chrome 91+). ABP $method= values are
// lowercased and validated against exactly this set.
const REQUEST_METHODS = new Set(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put']);

// Options with dedicated fail-safe handling (never silently ignored).
const COSMETIC_OPTION_DROP = new Set(['elemhide', 'generichide']);
const UNSUPPORTED_NAMED_OPTIONS = new Set([
  'document', 'genericblock', 'csp', 'header', 'permissions', 'popup',
  'removeparam', 'replace', 'redirect', 'redirect-rule', 'mp4', 'empty',
  'inline-script', 'inline-font', 'donottrack', 'urlskip', 'urltransform',
  'cookie', '1p', 'strict1p', 'strict3p', 'to', 'denyallow', 'badfilter',
  'method-whitelist', 'emptyparam',
]);

// Hostname tokens allowed in $domain= / initiatorDomains. ASCII hostnames
// only; entities (foo.*), wildcards, and paths are rejected.
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

// A urlFilter accepted by the narrow compiler. Mirrors the ABP pattern
// constructs whose DNR semantics are documented to match ABP: optional
// leading `||` domain anchor or single `|` start anchor, `*` wildcards,
// `^` separator placeholders, optional trailing `|` end anchor or `^`.
// Anything else (regex /.../, parentheses, brackets, braces, backslashes,
// whitespace, quotes, mid-pattern pipes) is rejected so a pattern is only
// ever copied verbatim into semantics Chrome documents as equivalent.
const URL_FILTER_PATTERN = /^(?:\|\|?)?[A-Za-z0-9*_.%\-/?=&:;@+$~#]+(?:\||\^)?$/;

// Drop-reason vocabulary (stable strings; reported per list and in SOURCES.json).
const REASONS = {
  COSMETIC: 'cosmetic',
  COSMETIC_EXTENDED: 'cosmetic-extended',
  REDIRECT: 'redirect',
  REMOVEPARAM: 'removeparam',
  REPLACE: 'replace',
  REGEX: 'regex-unsupported',
  PATTERN: 'pattern-unsupported',
  OPTION: 'unsupported-option',
  DOMAIN_ENTITY: 'domain-entity',
  DOMAIN_INVALID: 'domain-invalid',
  METHOD_INVALID: 'method-invalid',
  EMPTY: 'empty-rule',
  COMMENT: 'comment',
};

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Canonical JSON: sorted object keys, arrays pre-sorted by callers.
// Guarantees identical bytes for identical logical rules.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function isCommentOrHeader(line) {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('!') || /^\[Adblock/i.test(trimmed);
}

// Split "pattern$options" at the options separator. A trailing `$...` section
// is treated as options ONLY if every comma-separated token parses as a
// known option shape; otherwise the `$` belongs to the pattern itself and the
// whole line stays a pattern (which then usually fails pattern mapping and
// is dropped safely instead of being reinterpreted).
function splitOptions(text) {
  const dollar = text.lastIndexOf('$');
  if (dollar <= 0) return { pattern: text, optionText: null };
  // Spaces are allowed in the candidate so option values containing them
  // (e.g. `$csp=default-src none`) still split for proper categorization.
  // Safety is preserved: if the tokens do not ALL validate as options, the
  // `$` is treated as pattern text and the line falls through to pattern
  // mapping (which rejects it) instead of being reinterpreted.
  const candidate = text.slice(dollar + 1);
  if (!/^[A-Za-z0-9_~|=\-.,*+/% ]+$/.test(candidate)) return { pattern: text, optionText: null };
  const tokens = candidate.split(',');
  const valid = tokens.length > 0 && tokens.every((token) => /^~?[A-Za-z0-9_\-]+(=[^,]+)?$/.test(token));
  if (!valid) return { pattern: text, optionText: null };
  return { pattern: text.slice(0, dollar), optionText: candidate };
}

function parseDomainList(raw) {
  // Returns { include: [], exclude: [] } or { error: reason }.
  const include = [];
  const exclude = [];
  for (const part of String(raw).split('|')) {
    if (!part) return { error: REASONS.DOMAIN_INVALID };
    const negated = part.startsWith('~');
    const host = negated ? part.slice(1) : part;
    if (!host) return { error: REASONS.DOMAIN_INVALID };
    if (host.includes('*')) return { error: REASONS.DOMAIN_ENTITY };
    if (!HOSTNAME_PATTERN.test(host)) return { error: REASONS.DOMAIN_INVALID };
    (negated ? exclude : include).push(host.toLowerCase());
  }
  if (!include.length && !exclude.length) return { error: REASONS.DOMAIN_INVALID };
  return { include, exclude };
}

// Map one network-filter line to a canonical DNR rule description, or to a
// drop reason. Returns { rule } or { drop }.
function compileNetworkFilter(text) {
  let body = text.trim();
  if (!body) return { drop: REASONS.EMPTY };
  let exception = false;
  if (body.startsWith('@@')) {
    exception = true;
    body = body.slice(2);
    if (!body) return { drop: REASONS.EMPTY };
  }

  const { pattern, optionText } = splitOptions(body);
  const tokens = optionText ? optionText.split(',') : [];

  const resourceTypes = new Set();
  let domainType = null;
  let initiatorInclude = null;
  let initiatorExclude = null;
  let caseSensitive = false;
  let requestMethods = null;
  let important = false;

  for (const token of tokens) {
    const negated = token.startsWith('~');
    const core = negated ? token.slice(1) : token;
    const [name, value] = core.split('=', 2);
    const lower = name.toLowerCase();

    if (Object.prototype.hasOwnProperty.call(RESOURCE_TYPE_MAP, lower)) {
      if (negated) return { drop: REASONS.OPTION };
      resourceTypes.add(RESOURCE_TYPE_MAP[lower]);
      continue;
    }
    if (lower === 'third-party') {
      if (domainType && domainType !== (negated ? 'firstParty' : 'thirdParty')) {
        return { drop: REASONS.OPTION };
      }
      domainType = negated ? 'firstParty' : 'thirdParty';
      continue;
    }
    if (lower === 'first-party') {
      if (negated) return { drop: REASONS.OPTION };
      if (domainType && domainType !== 'firstParty') return { drop: REASONS.OPTION };
      domainType = 'firstParty';
      continue;
    }
    if (lower === 'domain') {
      if (negated || value === undefined) return { drop: REASONS.OPTION };
      const parsed = parseDomainList(value);
      if (parsed.error) return { drop: parsed.error };
      initiatorInclude = parsed.include;
      initiatorExclude = parsed.exclude;
      continue;
    }
    if (lower === 'match-case') {
      if (negated) return { drop: REASONS.OPTION };
      caseSensitive = true;
      continue;
    }
    if (lower === 'method') {
      if (negated || value === undefined) return { drop: REASONS.OPTION };
      const methods = value.toLowerCase().split('|').filter(Boolean);
      if (!methods.length || methods.some((method) => !REQUEST_METHODS.has(method))) {
        return { drop: REASONS.METHOD_INVALID };
      }
      requestMethods = [...new Set(methods)].sort();
      continue;
    }
    if (lower === 'important') {
      if (negated) return { drop: REASONS.OPTION };
      important = true;
      continue;
    }
    if (lower === 'badfilter') {
      // Negates another list rule; resolving references is out of scope for
      // the narrow compiler, so the negation itself is dropped (counted)
      // rather than applied or misread.
      return { drop: REASONS.OPTION };
    }
    if (COSMETIC_OPTION_DROP.has(lower)) return { drop: REASONS.COSMETIC };
    if (lower === 'redirect' || lower === 'redirect-rule' || lower === 'mp4') {
      return { drop: REASONS.REDIRECT };
    }
    if (lower === 'removeparam') return { drop: REASONS.REMOVEPARAM };
    if (lower === 'replace') return { drop: REASONS.REPLACE };
    return { drop: REASONS.OPTION };
  }

  // Regex patterns (/.../) are never emitted: Chrome caps regex rules
  // separately and many list regexes are rejected by DNR outright.
  if (/^\/.*\/[a-z]*$/.test(pattern)) return { drop: REASONS.REGEX };
  if (!URL_FILTER_PATTERN.test(pattern)) return { drop: REASONS.PATTERN };
  // A lone wildcard or anchor-only pattern would match nearly everything.
  const stripped = pattern.replace(/[|*^]/g, '');
  if (!stripped) return { drop: REASONS.PATTERN };

  const condition = { urlFilter: pattern };
  if (resourceTypes.size) condition.resourceTypes = [...resourceTypes].sort();
  if (domainType) condition.domainType = [domainType];
  if (initiatorInclude && initiatorInclude.length) {
    condition.initiatorDomains = [...initiatorInclude].sort();
  }
  if (initiatorExclude && initiatorExclude.length) {
    condition.excludedInitiatorDomains = [...initiatorExclude].sort();
  }
  if (caseSensitive) condition.isUrlFilterCaseSensitive = true;
  if (requestMethods) condition.requestMethods = requestMethods;

  const action = exception ? 'allow' : 'block';
  const base = exception ? ALLOW_PRIORITY : BLOCK_PRIORITY;
  return {
    rule: {
      action: { type: action },
      condition,
      priority: base + (important ? IMPORTANT_BONUS : 0),
    },
  };
}

// Classify one source line. Returns { kind: 'comment' }, { kind: 'rule',
// rule }, or { kind: 'drop', reason }.
function compileLine(line) {
  const text = line.trim();
  if (isCommentOrHeader(line)) return { kind: 'comment' };
  // Regex filters first: a /.../  pattern containing cosmetic-looking text
  // is still a regex (dropped as regex-unsupported, never reinterpreted).
  if (/^@@?\/.*\/[a-z]*(\$.*)?$/.test(text)) return { kind: 'drop', reason: REASONS.REGEX };
  // Cosmetic and extended-cosmetic syntax never becomes a network rule.
  if (text.includes('##+js(') || text.includes('#$#') || text.includes('#%#')
    || text.includes('#?#') || text.includes('#@$#') || text.includes('#@?#')
    || /:(has|has-text|matches-|xpath|style|contains|:-abp-|is|not)\(/.test(text)) {
    return { kind: 'drop', reason: REASONS.COSMETIC_EXTENDED };
  }
  if (text.includes('##') || text.includes('#@#')) {
    return { kind: 'drop', reason: REASONS.COSMETIC };
  }
  // Normalize network outcomes to the same { kind, reason } shape so callers
  // count the specific drop reason instead of a generic fallback.
  const network = compileNetworkFilter(text);
  if (network.rule) return { kind: 'rule', rule: network.rule };
  return { kind: 'drop', reason: network.drop || REASONS.PATTERN };
}

function newListStats() {
  return {
    inputRules: 0,
    comments: 0,
    supported: 0,
    generated: 0,
    duplicates: 0,
    unsupported: 0,
    regexRules: 0,
    compactable: 0,
    nonCompactable: 0,
    groups: 0,
    groupedRules: 0,
    individualRules: 0,
    largestGroup: 0,
    chunks: 0,
    unsupportedByReason: {},
  };
}

function countDrop(stats, reason) {
  stats.unsupported += 1;
  stats.unsupportedByReason[reason] = (stats.unsupportedByReason[reason] || 0) + 1;
}

// Compile one list's text into canonical (pre-ID) rules plus statistics.
function compileListText(text) {
  const stats = newListStats();
  const canonical = [];
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isCommentOrHeader(line)) {
      stats.comments += 1;
      continue;
    }
    stats.inputRules += 1;
    const outcome = compileLine(line);
    if (outcome.kind === 'rule' && outcome.rule) {
      stats.supported += 1;
      canonical.push(canonicalJson(outcome.rule));
    } else {
      countDrop(stats, outcome.reason || REASONS.PATTERN);
    }
  }
  return { canonical, stats };
}

// Deterministic IDs: sort canonical forms (independent of input and
// filesystem ordering), dedupe exact matches, assign 1-based sequence.
function dedupeCanonicalForms(canonicalForms) {
  const sorted = [...canonicalForms].sort();
  const uniques = [];
  let duplicates = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] === sorted[i - 1]) duplicates += 1;
    else uniques.push(sorted[i]);
  }
  return { uniques, duplicates };
}

function assignSequentialIds(sortedUniqueForms) {
  const rules = [];
  let id = 0;
  for (const form of sortedUniqueForms) {
    id += 1;
    const rule = JSON.parse(form);
    rule.id = id;
    rules.push(rule);
  }
  return rules;
}

function assignRuleIds(canonicalForms, stats) {
  const { uniques, duplicates } = dedupeCanonicalForms(canonicalForms);
  stats.duplicates += duplicates;
  const rules = assignSequentialIds(uniques);
  stats.generated = rules.length;
  return rules;
}

// Extract the ASCII hostname from a pure domain-anchored pattern
// (`||host^`). Returns null for anything with semantics beyond a hostname
// match: paths, wildcards, anchors, ports, IP literals, userinfo, trailing
// dots, or malformed/Unicode-unconvertible hosts. Callers treat null as
// "keep the individual urlFilter rule", never as a drop.
function extractCompactDomain(urlFilter) {
  const match = /^\|\|([^|^/*]+)\^$/.exec(String(urlFilter || ''));
  if (!match) return null;
  let host = match[1];
  if (!host || host.includes(':') || host.includes('@') || host.includes('%')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (host.endsWith('.')) return null;
  try {
    // Standards-based ASCII folding (punycode); built-in, no dependency.
    host = domainToASCII(host.toLowerCase());
  } catch (_) {
    return null;
  }
  if (!host || !HOSTNAME_PATTERN.test(host)) return null;
  return host;
}

// Canonical grouping key: every emitted DNR condition except the target
// request domain. Rules sharing a key are semantically identical apart from
// the domain they match, so (and only so) they may share a requestDomains
// array. Action type and priority are part of the key: blocks, allows, and
// $important variants never merge.
function groupKeyForRule(rule) {
  const condition = { ...(rule.condition || {}) };
  delete condition.urlFilter;
  delete condition.requestDomains;
  return canonicalJson({
    action: rule.action && rule.action.type,
    priority: rule.priority,
    condition,
  });
}

// Group deduplicated canonical rules into requestDomains chunks.
// Returns { grouped, individual, groupCount, largestGroup, chunks,
// compactable, nonCompactable }. Deterministic: sorted keys, sorted domains,
// fixed chunk size; input order is irrelevant.
function compactCanonicalRules(dedupedCanonicalForms, options = {}) {
  const maxDomains = options.maxDomainsPerRule ?? MAX_DOMAINS_PER_RULE;
  const groups = new Map();
  const individual = [];
  let compactable = 0;
  for (const form of dedupedCanonicalForms) {
    const rule = JSON.parse(form);
    const domain = extractCompactDomain(rule.condition && rule.condition.urlFilter);
    if (domain === null) {
      individual.push(rule);
      continue;
    }
    compactable += 1;
    const key = groupKeyForRule(rule);
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(domain);
  }
  const grouped = [];
  const sortedKeys = [...groups.keys()].sort();
  let largestGroup = 0;
  let chunks = 0;
  for (const key of sortedKeys) {
    const domains = [...groups.get(key)].sort();
    largestGroup = Math.max(largestGroup, domains.length);
    const core = JSON.parse(key);
    for (let i = 0; i < domains.length; i += maxDomains) {
      chunks += 1;
      grouped.push({
        action: { type: core.action },
        condition: { requestDomains: domains.slice(i, i + maxDomains), ...core.condition },
        priority: core.priority,
      });
    }
  }
  return {
    grouped,
    individual,
    groupCount: sortedKeys.length,
    largestGroup,
    chunks,
    compactable,
    nonCompactable: dedupedCanonicalForms.length - compactable,
  };
}

// Coverage proof: every input canonical rule must be represented in the final
// ruleset, either as an individual rule or as its exact domain inside a group
// with an identical group key. Returns { total, missing, missingSamples }.
// Callers fail the build on any gap.
function verifyCompactionCoverage(inputCanonicalForms, finalRules) {
  const individualSet = new Set();
  const groupedDomains = new Map();
  for (const rule of finalRules) {
    const rest = { action: rule.action, condition: rule.condition, priority: rule.priority };
    if (rest.condition && Array.isArray(rest.condition.requestDomains)) {
      const key = groupKeyForRule(rest);
      if (!groupedDomains.has(key)) groupedDomains.set(key, new Set());
      for (const domain of rest.condition.requestDomains) groupedDomains.get(key).add(domain);
    } else {
      individualSet.add(canonicalJson(rest));
    }
  }
  let missing = 0;
  const missingSamples = [];
  for (const form of inputCanonicalForms) {
    const rule = JSON.parse(form);
    const domain = extractCompactDomain(rule.condition && rule.condition.urlFilter);
    let represented = false;
    if (domain === null) {
      represented = individualSet.has(form);
    } else {
      const key = groupKeyForRule(rule);
      represented = groupedDomains.has(key) && groupedDomains.get(key).has(domain);
    }
    if (!represented) {
      missing += 1;
      if (missingSamples.length < 5) missingSamples.push(form);
    }
  }
  return { total: inputCanonicalForms.length, missing, missingSamples };
}

// Structural validation of every generated rule. Throws on the first
// violation so corrupt output is never written.
function validateRule(rule, seenIds) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new Error('Generated rule is not an object.');
  }
  if (!Number.isInteger(rule.id) || rule.id < 1) {
    throw new Error(`Generated rule has an invalid id: ${JSON.stringify(rule.id)}.`);
  }
  if (seenIds.has(rule.id)) throw new Error(`Duplicate generated rule id: ${rule.id}.`);
  seenIds.add(rule.id);
  const actionType = rule.action && rule.action.type;
  if (actionType !== 'block' && actionType !== 'allow') {
    throw new Error(`Unsupported generated action: ${JSON.stringify(actionType)}.`);
  }
  const actionKeys = Object.keys(rule.action || {}).sort().join(',');
  if (actionKeys !== 'type') {
    throw new Error(`Generated action carries unsupported fields: ${actionKeys}.`);
  }
  const condition = rule.condition;
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    throw new Error(`Generated rule ${rule.id} has no condition.`);
  }
  const hasUrlFilter = typeof condition.urlFilter === 'string' && condition.urlFilter.length > 0;
  const hasDomains = Array.isArray(condition.requestDomains) && condition.requestDomains.length > 0;
  if ((hasUrlFilter ? 1 : 0) + (hasDomains ? 1 : 0) !== 1) {
    throw new Error(`Generated rule ${rule.id} must have exactly one of urlFilter/requestDomains.`);
  }
  if (hasDomains && condition.requestDomains.some(
    (host) => typeof host !== 'string' || !HOSTNAME_PATTERN.test(host))) {
    throw new Error(`Generated rule ${rule.id} has malformed requestDomains.`);
  }
  if ('regexFilter' in condition) {
    throw new Error(`Generated rule ${rule.id} unexpectedly uses regexFilter.`);
  }
  if (condition.resourceTypes !== undefined) {
    const allowed = new Set(['main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
      'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']);
    if (!Array.isArray(condition.resourceTypes) || !condition.resourceTypes.length
      || condition.resourceTypes.some((type) => !allowed.has(type))) {
      throw new Error(`Generated rule ${rule.id} has unsupported resourceTypes.`);
    }
  }
  for (const key of ['initiatorDomains', 'excludedInitiatorDomains']) {
    if (condition[key] !== undefined) {
      if (!Array.isArray(condition[key]) || !condition[key].length
        || condition[key].some((host) => typeof host !== 'string' || !HOSTNAME_PATTERN.test(host))) {
        throw new Error(`Generated rule ${rule.id} has a malformed ${key}.`);
      }
    }
  }
  if (!Number.isInteger(rule.priority) || rule.priority < 1) {
    throw new Error(`Generated rule ${rule.id} has an invalid priority.`);
  }
  const topKeys = Object.keys(rule).sort().join(',');
  if (topKeys !== 'action,condition,id,priority') {
    throw new Error(`Generated rule ${rule.id} has unexpected shape: ${topKeys}.`);
  }
}

function validateRules(rules) {
  const seenIds = new Set();
  for (const rule of rules) validateRule(rule, seenIds);
  return { count: rules.length };
}

// Deterministic serialization: fixed key order (id, priority, action,
// condition), 2-space indent, trailing newline. Byte-identical for identical
// logical rulesets on any OS.
function serializeRuleset(rules) {
  const ordered = rules.map((rule) => ({
    id: rule.id,
    priority: rule.priority,
    action: rule.action,
    condition: rule.condition,
  }));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function readSourcesManifest() {
  return JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
}

function loadListSnapshot(listKey, manifest) {
  const entry = manifest.lists && manifest.lists[listKey];
  if (!entry || typeof entry.vendoredFile !== 'string') {
    throw new Error(`Unknown filter list in ${path.basename(SOURCES_PATH)}: ${listKey}.`);
  }
  const absolute = path.join(REPO_ROOT, entry.vendoredFile);
  const bytes = fs.readFileSync(absolute);
  const actual = sha256Hex(bytes);
  if (entry.sha256 && actual !== String(entry.sha256).toLowerCase()) {
    throw new Error(
      `Snapshot integrity mismatch for ${listKey} (${entry.vendoredFile}): ` +
      `expected ${entry.sha256}, got ${actual}. Refusing to compile.`
    );
  }
  return { entry, text: bytes.toString('utf8'), bytes };
}

// Compile both lists and return every artifact in memory. Never throws for
// over-budget output: the caller decides how to signal it. This keeps the
// complete valid rulesets available for inspection even when they exceed the
// conservative Phase-1 budget, instead of silently discarding rules.
function compileAll(manifest, options = {}) {
  const budgetLimit = options.maxCombinedStaticRules ?? MAX_COMBINED_STATIC_RULES;
  const outputs = {};
  const perList = {};
  const pairs = [
    ['easylist', 'ads.json'],
    ['easyprivacy', 'trackers.json'],
  ];
  for (const [listKey, fileName] of pairs) {
    const { entry, text, bytes } = loadListSnapshot(listKey, manifest);
    const { canonical, stats } = compileListText(text);
    // Deduplicate first so duplicate counting is independent of grouping.
    const { uniques, duplicates } = dedupeCanonicalForms(canonical);
    stats.duplicates += duplicates;
    // Compact AFTER deduplication and BEFORE ID assignment: pure
    // `||host^` filters group into requestDomains rules; everything else
    // stays an individual urlFilter rule. No supported filter is dropped.
    const compacted = compactCanonicalRules(uniques);
    stats.compactable = compacted.compactable;
    stats.nonCompactable = compacted.nonCompactable;
    stats.groups = compacted.groupCount;
    stats.largestGroup = compacted.largestGroup;
    stats.chunks = compacted.chunks;
    stats.groupedRules = compacted.grouped.length;
    stats.individualRules = compacted.individual.length;
    const combinedForms = [...compacted.individual, ...compacted.grouped]
      .map((rule) => canonicalJson(rule))
      .sort();
    const rules = assignSequentialIds(combinedForms);
    stats.generated = rules.length;
    validateRules(rules);
    const coverage = verifyCompactionCoverage(uniques, rules);
    if (coverage.missing > 0) {
      throw new Error(
        `Compaction coverage gap in ${listKey}: ${coverage.missing} of ${coverage.total} ` +
        `supported filters unrepresented (${coverage.missingSamples.join(' | ')}).`
      );
    }
    outputs[fileName] = serializeRuleset(rules);
    perList[listKey] = {
      entry,
      stats,
      ruleCount: rules.length,
      bytes: bytes.length,
      outputBytes: Buffer.byteLength(outputs[fileName], 'utf8'),
    };
  }
  const combined = perList.easylist.ruleCount + perList.easyprivacy.ruleCount;
  const withinBudget = combined <= budgetLimit;
  return { outputs, perList, combined, withinBudget, budgetLimit };
}

// Machine-readable provenance. Fully deterministic: no timestamps, no
// absolute paths, no environment data. Same inputs -> identical bytes.
function buildSourcesJson(manifest, compiled) {
  const doc = {
    schema: 1,
    converter: { name: CONVERTER_NAME, version: CONVERTER_VERSION, schema: CONVERTER_SCHEMA },
    budgets: {
      maxCombinedStaticRules: compiled.budgetLimit,
      maxRegexRules: MAX_REGEX_RULES,
      maxDomainsPerRule: MAX_DOMAINS_PER_RULE,
      combinedRules: compiled.combined,
      combinedRegexRules: 0,
      withinBudget: compiled.withinBudget,
    },
    lists: {},
    rulesets: {
      'ads.json': { source: 'easylist', rules: compiled.perList.easylist.ruleCount },
      'trackers.json': { source: 'easyprivacy', rules: compiled.perList.easyprivacy.ruleCount },
    },
  };
  for (const [listKey, fileName] of [['easylist', 'ads.json'], ['easyprivacy', 'trackers.json']]) {
    const { entry, stats, bytes, outputBytes } = compiled.perList[listKey];
    doc.lists[listKey] = {
      title: entry.title,
      repository: entry.repository,
      upstreamCommit: entry.upstreamCommit,
      publishedUrl: entry.publishedUrl,
      listVersion: entry.listVersion,
      lastModified: entry.lastModified,
      sourceFile: entry.vendoredFile,
      sha256: entry.sha256,
      license: entry.license,
      licenseUrl: entry.licenseUrl,
      attribution: entry.attribution,
      sourceBytes: bytes,
      inputRules: stats.inputRules,
      supported: stats.supported,
      generated: stats.generated,
      duplicates: stats.duplicates,
      unsupported: stats.unsupported,
      unsupportedByReason: stats.unsupportedByReason,
      compactable: stats.compactable,
      nonCompactable: stats.nonCompactable,
      groups: stats.groups,
      groupedRules: stats.groupedRules,
      individualRules: stats.individualRules,
      largestGroup: stats.largestGroup,
      chunks: stats.chunks,
      outputFile: `browser-extension/rules/${fileName}`,
      outputBytes,
    };
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function printReport(manifest, compiled) {
  const lines = ['Soterios filter-list compiler report', '======================================'];
  for (const listKey of ['easylist', 'easyprivacy']) {
    const { entry, stats } = compiled.perList[listKey];
    lines.push('');
    lines.push(`${entry.title} (${entry.listVersion}, commit ${String(entry.upstreamCommit).slice(0, 12)})`);
    lines.push(`  input rules:       ${stats.inputRules}`);
    lines.push(`  supported:         ${stats.supported}`);
    lines.push(`  compactable:       ${stats.compactable}`);
    lines.push(`  non-compactable:   ${stats.nonCompactable}`);
    lines.push(`  generated:         ${stats.generated} (${stats.groupedRules} grouped, ${stats.individualRules} individual)`);
    lines.push(`  duplicates:        ${stats.duplicates}`);
    lines.push(`  unsupported:       ${stats.unsupported}`);
    lines.push(`  regex rules:       0 (policy: urlFilter only)`);
    const reasons = Object.entries(stats.unsupportedByReason).sort((a, b) => b[1] - a[1]);
    if (reasons.length) {
      lines.push('');
      lines.push('  Unsupported reasons:');
      for (const [reason, count] of reasons) {
        lines.push(`    ${reason.padEnd(24)}${count}`);
      }
    }
  }
  lines.push('');
  lines.push(`Combined DNR rules:  ${compiled.combined} (budget ${compiled.budgetLimit})`);
  lines.push(`Combined regex rules: 0 (budget ${MAX_REGEX_RULES})`);
  if (!compiled.withinBudget) {
    lines.push(`OVER BUDGET: combined output exceeds the Phase-1 budget of ${compiled.budgetLimit}.`);
    lines.push('No rules were discarded to fit. Reduce scope explicitly before shipping.');
  }
  lines.push(`Manifest: ${path.relative(REPO_ROOT, SOURCES_PATH)}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function writeArtifacts(compiled, manifest) {
  fs.mkdirSync(RULES_DIR, { recursive: true });
  fs.writeFileSync(ADS_PATH, compiled.outputs['ads.json']);
  fs.writeFileSync(TRACKERS_PATH, compiled.outputs['trackers.json']);
  fs.writeFileSync(SOURCES_OUT_PATH, buildSourcesJson(manifest, compiled));
}

function compileToDisk(options = {}) {
  const manifest = readSourcesManifest();
  const compiled = compileAll(manifest, options);
  writeArtifacts(compiled, manifest);
  printReport(manifest, compiled);
  if (!compiled.withinBudget) {
    process.stderr.write(
      `filter-compiler: combined output (${compiled.combined} rules) exceeds the ` +
      `Phase-1 budget of ${compiled.budgetLimit}. Artifacts were written for ` +
      'inspection, but the build fails: reduce scope explicitly before shipping.\n'
    );
    process.exitCode = 1;
  }
  return compiled;
}

// --check: regenerate in memory, byte-compare, no writes.
function checkArtifacts() {
  const manifest = readSourcesManifest();
  const compiled = compileAll(manifest);
  const expected = {
    [ADS_PATH]: compiled.outputs['ads.json'],
    [TRACKERS_PATH]: compiled.outputs['trackers.json'],
    [SOURCES_OUT_PATH]: buildSourcesJson(manifest, compiled),
  };
  const mismatches = [];
  for (const [filePath, content] of Object.entries(expected)) {
    let onDisk = null;
    try {
      onDisk = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    if (onDisk !== content) mismatches.push(path.relative(REPO_ROOT, filePath));
  }
  printReport(manifest, compiled);
  if (mismatches.length) {
    process.stderr.write(
      `Filter artifacts differ from checked-in output: ${mismatches.join(', ')}. ` +
      'Run node tools/compile-filter-lists.js to regenerate.\n'
    );
    process.exitCode = 1;
    return false;
  }
  process.stdout.write('Filter artifacts are up to date.\n');
  return true;
}

function fetchUrl(url, { timeoutMs = 60000, maxBytes = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'SoteriosFilterCompiler/1.0' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Unexpected HTTP ${response.statusCode} for ${url}.`));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(new Error(`Response exceeds ${maxBytes} byte cap.`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Fetch timed out after ${timeoutMs}ms.`)));
    request.on('error', reject);
  });
}

function validateSnapshotText(listKey, text) {
  const lines = String(text).split('\n');
  if (!/^\[Adblock/i.test((lines[0] || '').trim())) {
    throw new Error(`Snapshot for ${listKey} does not start with an Adblock header.`);
  }
  const header = lines.slice(0, 20).join('\n');
  for (const required of ['! Title:', '! Version:', '! Commit:']) {
    if (!header.includes(required)) {
      throw new Error(`Snapshot for ${listKey} is missing required header ${required}.`);
    }
  }
  const commit = (header.match(/! Commit:\s*([0-9a-f]{40})/i) || [])[1] || null;
  const version = (header.match(/! Version:\s*(\S+)/) || [])[1] || null;
  const modified = (header.match(/! Last modified:\s*(.+)/) || [])[1]?.trim() || null;
  return { commit, version, modified };
}

// --update: re-fetch pinned snapshots over HTTPS (explicit, networked),
// validate format, refresh vendored files + provenance, recompile.
async function updateSnapshots() {
  const manifestPath = SOURCES_PATH;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const listKey of ['easylist', 'easyprivacy']) {
    const entry = manifest.lists[listKey];
    process.stdout.write(`Fetching ${entry.title} from ${entry.publishedUrl}...\n`);
    const bytes = await fetchUrl(entry.publishedUrl);
    const meta = validateSnapshotText(listKey, bytes.toString('utf8'));
    if (!meta.commit) throw new Error(`Fetched ${listKey} snapshot has no parseable commit header.`);
    const absolute = path.join(REPO_ROOT, entry.vendoredFile);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
    const oldVersion = entry.listVersion;
    const oldSha = entry.sha256;
    entry.upstreamCommit = meta.commit;
    if (meta.version) entry.listVersion = meta.version;
    if (meta.modified) entry.lastModified = meta.modified;
    entry.sha256 = sha256Hex(bytes);
    process.stdout.write(
      `  ${listKey}: ${oldVersion} (${String(oldSha).slice(0, 12)}) -> ` +
      `${entry.listVersion} (${String(entry.sha256).slice(0, 12)}), ${bytes.length} bytes.\n`
    );
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return compileToDisk();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--update')) {
    await updateSnapshots();
    return;
  }
  if (args.has('--check')) {
    checkArtifacts();
    return;
  }
  compileToDisk();
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`filter-compiler: ${err && err.message ? err.message : err}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONVERTER_NAME,
  CONVERTER_VERSION,
  MAX_COMBINED_STATIC_RULES,
  MAX_REGEX_RULES,
  MAX_DOMAINS_PER_RULE,
  BLOCK_PRIORITY,
  ALLOW_PRIORITY,
  IMPORTANT_BONUS,
  REASONS,
  RESOURCE_TYPE_MAP,
  compileLine,
  compileNetworkFilter,
  compileListText,
  dedupeCanonicalForms,
  assignSequentialIds,
  assignRuleIds,
  extractCompactDomain,
  groupKeyForRule,
  compactCanonicalRules,
  verifyCompactionCoverage,
  validateRule,
  validateRules,
  serializeRuleset,
  canonicalJson,
  buildSourcesJson,
  compileAll,
  checkArtifacts,
  compileToDisk,
};
