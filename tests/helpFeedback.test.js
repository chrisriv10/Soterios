'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildUrl } = require('../src/ui/js/helpFeedback');

test('feedback links open the matching website section and carry only a valid app version', () => {
  const sections = {
    bug: 'bug-reports',
    feature: 'feature-requests',
    general: 'general-feedback',
    security: 'security',
    documentation: 'documentation'
  };

  for (const [category, section] of Object.entries(sections)) {
    const url = new URL(buildUrl(category, '1.4.2'));
    assert.equal(url.origin, 'https://chrisriv10.github.io');
    assert.equal(url.pathname, '/Soterios/feedback/');
    assert.equal(url.hash, `#${section}`);
    assert.deepEqual([...url.searchParams.entries()], [['appVersion', '1.4.2']]);
  }

  const invalidVersionUrl = new URL(buildUrl('bug', '1.4.2&username=local-user'));
  assert.equal(invalidVersionUrl.search, '');
  assert.throws(() => buildUrl('unknown', '1.4.2'), /Unsupported feedback category/);
});

test('website feedback routes separate public conversations from private vulnerability reports', () => {
  const page = fs.readFileSync(path.join(__dirname, '../feedback/index.html'), 'utf8');
  const bugTemplate = fs.readFileSync(path.join(__dirname, '../.github/ISSUE_TEMPLATE/bug_report.yml'), 'utf8');
  const featureTemplate = fs.readFileSync(path.join(__dirname, '../.github/ISSUE_TEMPLATE/feature_request.yml'), 'utf8');
  assert.match(page, /issues\/new\?template=bug_report\.yml/);
  assert.match(page, /issues\/new\?template=feature_request\.yml/);
  assert.match(page, /discussions\/categories\/general/);
  assert.match(page, /security\/advisories\/new/);
  assert.match(page, /Do not post vulnerability details in public issues or Discussions/);
  assert.match(page, /wiki\/Troubleshooting/);
  for (const field of ['soterios-version', 'windows-version', 'description', 'reproduction', 'expected', 'actual', 'logs', 'screenshots']) {
    assert.match(bugTemplate, new RegExp(`id: ${field}`));
  }
  for (const field of ['problem', 'proposed-solution', 'use-cases', 'additional-context']) {
    assert.match(featureTemplate, new RegExp(`id: ${field}`));
  }
  const landingPage = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(landingPage, /href="feedback\/index\.html"/);
  assert.match(page, /href="\.\.\/index\.html#features"/);
  assert.match(page, /href="index\.html" aria-current="page"/);
  assert.doesNotMatch(page, /<form\b/i);
});
