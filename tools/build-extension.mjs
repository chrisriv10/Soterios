import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(repoRoot, 'browser-extension');
const sourceRoot = path.join(extensionRoot, 'src');
const outputRoot = path.join(extensionRoot, 'dist', 'chromium');
const extensionPackage = JSON.parse(await readFile(path.join(extensionRoot, 'package.json'), 'utf8'));
// Single source of truth for the extension version inside bundled code
// (manifest.version is generated from the same value below).
const versionDefine = { SOTERIOS_EXTENSION_VERSION: JSON.stringify(extensionPackage.version) };

const manifest = {
  manifest_version: 3,
  name: 'Soterios — Credential & Phishing Protection',
  short_name: 'Soterios',
  version: extensionPackage.version,
  version_name: `${extensionPackage.version} local-first`,
  description: 'Local-first credential and phishing protection with explicit control over every online service.',
  minimum_chrome_version: '120',
  icons: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  action: { default_title: 'Soterios protection', default_popup: 'popup.html', default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' } },
  background: { service_worker: 'background.js', type: 'module' },
  options_ui: { page: 'options.html', open_in_tab: true },
  permissions: ['storage', 'alarms', 'activeTab', 'scripting', 'declarativeNetRequest'],
  optional_permissions: ['nativeMessaging'],
  declarative_net_request: {
    // Both rulesets ship DISABLED. The background enables them only from
    // validated stored settings (opt-in), so installs/updates can never
    // block requests before the service worker has reconciled state.
    rule_resources: [
      { id: 'soterios-ads', enabled: false, path: 'rules/ads.json' },
      { id: 'soterios-trackers', enabled: false, path: 'rules/trackers.json' }
    ]
  },
  web_accessible_resources: [{
    resources: ['icons/icon32.png'],
    matches: ['http://*/*', 'https://*/*']
  }],
  optional_host_permissions: [
    'http://*/*', 'https://*/*', 'https://api.pwnedpasswords.com/*',
    'https://chrisriv10.github.io/*', 'https://safebrowsing.googleapis.com/*'
  ],
  incognito: 'split',
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
  homepage_url: 'https://github.com/chrisriv10/Soterios'
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

execFileSync(process.execPath, [path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', path.join(extensionRoot, 'tsconfig.json')], { stdio: 'inherit' });

await build({
  entryPoints: { background: path.join(sourceRoot, 'background.ts') },
  outdir: outputRoot, bundle: true, format: 'esm', platform: 'browser', target: 'chrome120',
  legalComments: 'none', minify: false, sourcemap: false, charset: 'utf8', define: versionDefine
});
await build({
  entryPoints: {
    content: path.join(sourceRoot, 'content.ts'), popup: path.join(sourceRoot, 'popup.ts'),
    options: path.join(sourceRoot, 'options.ts'), onboarding: path.join(sourceRoot, 'onboarding.ts'),
    activity: path.join(sourceRoot, 'activity.ts')
  },
  outdir: outputRoot, bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  legalComments: 'none', minify: false, sourcemap: false, charset: 'utf8', define: versionDefine
});

for (const file of ['popup.html', 'options.html', 'onboarding.html', 'activity.html']) {
  await cp(path.join(extensionRoot, file), path.join(outputRoot, file));
}
for (const file of ['theme.css', 'ui.css']) await cp(path.join(sourceRoot, file), path.join(outputRoot, file));
await cp(path.join(extensionRoot, 'icons'), path.join(outputRoot, 'icons'), { recursive: true });
// Phase 2A packaged ad/tracker artifacts: generated DNR rules plus the
// attribution/license/provenance files Phase 1 requires. Raw EasyList
// snapshots (tools/filter-lists/) are build inputs and never ship.
await mkdir(path.join(outputRoot, 'rules'), { recursive: true });
await cp(path.join(extensionRoot, 'rules', 'ads.json'), path.join(outputRoot, 'rules', 'ads.json'));
await cp(path.join(extensionRoot, 'rules', 'trackers.json'), path.join(outputRoot, 'rules', 'trackers.json'));
await cp(path.join(extensionRoot, 'rules', 'LICENSE.md'), path.join(outputRoot, 'rules', 'LICENSE.md'));
await cp(path.join(extensionRoot, 'rules', 'SOURCES.json'), path.join(outputRoot, 'rules', 'SOURCES.json'));
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const testRoot = path.join(extensionRoot, 'dist', 'test');
await rm(testRoot, { recursive: true, force: true });
await build({
  entryPoints: ['contracts', 'settings', 'domains', 'credential', 'heuristics', 'history', 'feed', 'adblock', 'providers'].map((name) => path.join(sourceRoot, `${name}.ts`)),
  outdir: testRoot, bundle: true, format: 'cjs', platform: 'node', target: 'node20', legalComments: 'none', sourcemap: false, define: versionDefine
});

console.log(`Built Soterios browser extension ${extensionPackage.version} at ${outputRoot}`);
