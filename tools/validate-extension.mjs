import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repoRoot, 'browser-extension', 'dist', 'chromium');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const failures = [];

if (manifest.manifest_version !== 3) failures.push('manifest_version must be 3');
if (manifest.content_scripts) failures.push('static content_scripts are forbidden');
for (const permission of manifest.permissions || []) if (!['storage', 'alarms', 'activeTab', 'scripting'].includes(permission)) failures.push(`unexpected required permission: ${permission}`);
if (JSON.stringify(manifest).includes('<all_urls>')) failures.push('manifest must not contain <all_urls>');
if (!manifest.content_security_policy?.extension_pages?.includes("script-src 'self'")) failures.push('explicit self-only script CSP is required');
if (manifest.web_accessible_resources?.length) failures.push('no web-accessible resources are expected');

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
if (failures.length) { console.error(failures.map((item) => `- ${item}`).join('\n')); process.exitCode = 1; }
else console.log(`Validated ${allFiles.length} extension files: permissions, CSP, local code, resources, and telemetry checks passed.`);
