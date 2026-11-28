'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function withTempTree(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-pages-'));
  try {
    await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Pages assembly copies the landing page while preserving the signed feed', async () => {
  const { assemblePagesSite } = await import('../tools/assemble-pages-site.mjs');
  await withTempTree(async (root) => {
    const sourceDir = path.join(root, 'repo');
    const siteDir = path.join(sourceDir, 'public');
    const feedDir = path.join(siteDir, 'threat-feed');
    fs.mkdirSync(feedDir, { recursive: true });
    fs.mkdirSync(path.join(sourceDir, 'feedback'), { recursive: true });
    fs.mkdirSync(path.join(sourceDir, 'assets', 'site'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'index.html'), '<h1>Landing page fixture</h1>');
    fs.writeFileSync(path.join(sourceDir, 'site.css'), 'body { color: #123; }');
    fs.writeFileSync(path.join(sourceDir, 'site.js'), 'window.fixture = true;');
    fs.writeFileSync(path.join(sourceDir, '.nojekyll'), '');
    fs.writeFileSync(path.join(sourceDir, 'feedback', 'index.html'), '<h1>Feedback fixture</h1>');
    fs.writeFileSync(path.join(sourceDir, 'assets', 'brand-logo.png'), 'logo');
    fs.writeFileSync(path.join(sourceDir, 'assets', 'soteriosTextLogo.png'), 'wordmark');
    fs.writeFileSync(path.join(sourceDir, 'assets', 'site', 'hero.webp'), 'site image');
    fs.writeFileSync(path.join(sourceDir, 'private.txt'), 'must not be published');
    fs.writeFileSync(path.join(feedDir, 'manifest.json'), '{"fixture":"signed-feed"}');

    await assemblePagesSite({ sourceDir, siteDir });

    assert.equal(fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8'), '<h1>Landing page fixture</h1>');
    assert.equal(fs.readFileSync(path.join(siteDir, 'site.css'), 'utf8'), 'body { color: #123; }');
    assert.equal(fs.readFileSync(path.join(siteDir, 'site.js'), 'utf8'), 'window.fixture = true;');
    assert.equal(fs.readFileSync(path.join(siteDir, '.nojekyll'), 'utf8'), '');
    assert.equal(fs.readFileSync(path.join(siteDir, 'feedback', 'index.html'), 'utf8'), '<h1>Feedback fixture</h1>');
    assert.equal(fs.readFileSync(path.join(siteDir, 'assets', 'brand-logo.png'), 'utf8'), 'logo');
    assert.equal(fs.readFileSync(path.join(siteDir, 'assets', 'soteriosTextLogo.png'), 'utf8'), 'wordmark');
    assert.equal(fs.readFileSync(path.join(siteDir, 'assets', 'site', 'hero.webp'), 'utf8'), 'site image');
    assert.equal(fs.readFileSync(path.join(feedDir, 'manifest.json'), 'utf8'), '{"fixture":"signed-feed"}');
    assert.equal(fs.existsSync(path.join(siteDir, 'private.txt')), false);
  });
});

test('Pages assembly creates a nojekyll marker when the landing page PR has not merged yet', async () => {
  const { assemblePagesSite } = await import('../tools/assemble-pages-site.mjs');
  await withTempTree(async (root) => {
    const sourceDir = path.join(root, 'repo');
    const siteDir = path.join(sourceDir, 'public');
    fs.mkdirSync(siteDir, { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'threat-feed'), { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'threat-feed', 'manifest.json'), 'feed');

    await assemblePagesSite({ sourceDir, siteDir });

    assert.equal(fs.existsSync(path.join(siteDir, 'index.html')), false);
    assert.equal(fs.readFileSync(path.join(siteDir, '.nojekyll'), 'utf8'), '');
    assert.equal(fs.readFileSync(path.join(siteDir, 'threat-feed', 'manifest.json'), 'utf8'), 'feed');
  });
});

test('Pages publishing waits for an uploaded artifact in a separate deployment job', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/threat-feed.yml'), 'utf8');
  assert.match(workflow, /deploy-pages:\s*\n\s+needs: build-pages/);
  assert.match(workflow, /include-hidden-files:\s*true/);
  assert.match(workflow, /Wait for Pages artifact registration/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /tools\/assemble-pages-site\.mjs/);
  assert.match(workflow, /site\.css/);
  assert.match(workflow, /assets\/site\/\*\*/);
  assert.match(workflow, /feedback\/\*\*/);
});
