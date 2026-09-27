import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repoRoot, 'browser-extension', 'dist', 'chromium');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const failures = [];
if (manifest.manifest_version !== 3) failures.push('manifest_version must be 3');
if (manifest.content_scripts) failures.push('static content_scripts are forbidden');
for (const permission of manifest.permissions || []) if (!['storage', 'alarms', 'activeTab', 'scripting', 'declarativeNetRequest'].includes(permission)) failures.push(`unexpected required permission: ${permission}`);
for (const banned of ['declarativeNetRequestFeedback', 'declarativeNetRequestWithHostAccess', 'webRequest', 'webRequestBlocking', 'tabs', 'cookies', 'browsingData']) {
  if ((manifest.permissions || []).includes(banned)) failures.push(`forbidden required permission: ${banned}`);
}
if (JSON.stringify(manifest).includes('<all_urls>')) failures.push('manifest must not contain <all_urls>');
if (!manifest.content_security_policy?.extension_pages?.includes("script-src 'self'")) failures.push('explicit self-only script CSP is required');
const webResources = manifest.web_accessible_resources || [];
if (webResources.length !== 1
  || JSON.stringify(webResources[0]) !== JSON.stringify({ resources: ['icons/icon32.png'], matches: ['http://*/*', 'https://*/*'] })) {
  failures.push('only the Soterios field-button icon may be web-accessible');
}

async function files(dir) {
  const output = [];
  for (const name of (await readdir(dir)).sort()) { const file = path.join(dir, name); (await stat(file)).isDirectory() ? output.push(...await files(file)) : output.push(file); }
  return output;
}
const allFiles = await files(root);
for (const file of allFiles.filter((entry) => /\.(?:js|html)$/i.test(entry))) {
  const value = await readFile(file, 'utf8');
  if (/\b(?:eval|new Function)\s*\(/.test(value)) failures.push(`${path.basename(file)} contains dynamic code execution`);
  if (/google-analytics|segment\.com|mixpanel|amplitude|posthog|sentry\.io/i.test(value)) failures.push(`${path.basename(file)} contains a telemetry or analytics reference`);
  if (/<script(?![^>]*\bsrc=)/i.test(value)) failures.push(`${path.basename(file)} contains an inline script`);
  const remoteValues = value.match(/https?:\/\/[^\s"'`),]+/gi) || [];
  const allowedOrigins = ['https://api.pwnedpasswords.com', 'https://chrisriv10.github.io', 'https://safebrowsing.googleapis.com', 'https://github.com/chrisriv10/Soterios', 'http://*/*', 'https://*/*'];
  if (remoteValues.some((remote) => !allowedOrigins.some((allowed) => remote.startsWith(allowed)))) failures.push(`${path.basename(file)} contains an undeclared remote origin`);
}
if (!allFiles.some((file) => file.endsWith(path.join('icons', 'icon128.png')))) failures.push('icon128.png is missing');

// Phase 2A packaged DNR rulesets: distribution invariants only (the compiler
// owns deep rule validation). Exactly two static rulesets, block/allow only,
// no regex/redirect/headers, combined within the guaranteed static budget.
const expectedRulesets = [
  { id: 'soterios-ads', enabled: false, path: 'rules/ads.json' },
  { id: 'soterios-trackers', enabled: false, path: 'rules/trackers.json' },
];
const declared = manifest.declarative_net_request?.rule_resources;
if (JSON.stringify(declared) !== JSON.stringify(expectedRulesets)) {
  failures.push('declarative_net_request must register exactly soterios-ads and soterios-trackers');
} else {
  const seenIds = new Set();
  let combined = 0;
  for (const ruleset of expectedRulesets) {
    let rules = null;
    try {
      rules = JSON.parse(await readFile(path.join(root, ruleset.path), 'utf8'));
    } catch (_) {
      failures.push(`${ruleset.path} is missing or unreadable`);
      continue;
    }
    if (!Array.isArray(rules)) {
      failures.push(`${ruleset.path} must be a JSON rule array`);
      continue;
    }
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object') { failures.push(`${ruleset.path} contains a non-object rule`); break; }
      if (!Number.isInteger(rule.id) || rule.id < 1 || seenIds.has(`${ruleset.id}:${rule.id}`)) {
        failures.push(`${ruleset.path} has a non-positive or duplicate rule id`);
        break;
      }
      seenIds.add(`${ruleset.id}:${rule.id}`);
      const action = rule.action?.type;
      if (action !== 'block' && action !== 'allow') { failures.push(`${ruleset.path} uses forbidden action ${action}`); break; }
      const condition = rule.condition || {};
      if (typeof condition.urlFilter !== 'string' && !Array.isArray(condition.requestDomains)) {
        failures.push(`${ruleset.path} has a rule without urlFilter/requestDomains`); break;
      }
      if ('regexFilter' in condition) { failures.push(`${ruleset.path} must not use regexFilter`); break; }
      // DNR domainType is a scalar enum; array form is silently dropped by
      // Chrome at load, which would ship dead rules with no error.
      if ('domainType' in condition
        && condition.domainType !== 'firstParty' && condition.domainType !== 'thirdParty') {
        failures.push(`${ruleset.path} has a rule with invalid domainType`); break;
      }
      if (rule.action.redirect || rule.action.upgradeScheme || rule.action.allowAllRequests || rule.action.requestHeaders || rule.action.responseHeaders) {
        failures.push(`${ruleset.path} must not redirect or modify headers`); break;
      }
    }
    combined += rules.length;
  }
  if (combined > 30000) failures.push(`packaged static rules (${combined}) exceed the 30000 guaranteed budget`);
  for (const provenance of ['rules/LICENSE.md', 'rules/SOURCES.json']) {
    try {
      await stat(path.join(root, provenance));
    } catch (_) {
      failures.push(`${provenance} must be packaged with the rulesets`);
    }
  }
}
if (failures.length) { console.error(failures.map((item) => `- ${item}`).join('\n')); process.exitCode = 1; }
else console.log(`Validated ${allFiles.length} extension files: permissions, CSP, local code, resources, and telemetry checks passed.`);
