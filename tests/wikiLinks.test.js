'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { convertMarkdownLinks } = require('../tools/convert-wiki-links');

test('wiki link conversion removes the .md suffix from relative page links', () => {
  const source = '[Installation](Installation.md) [FAQ](Troubleshooting.md#common)';
  assert.equal(convertMarkdownLinks(source), '[Installation](Installation) [FAQ](Troubleshooting#common)');
});

test('wiki link conversion preserves external URLs and anchors', () => {
  const source = '[Repository](https://github.com/chrisriv10/Soterios/blob/main/docs/README.md) [Top](#top)';
  assert.equal(convertMarkdownLinks(source), source);
});

test('the GitHub Wiki workflow normalizes links after copying source pages', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'wiki-sync.yml'), 'utf8');
  assert.match(workflow, /node \.\.\/tools\/convert-wiki-links\.js \./);
  assert.match(workflow, /find \. -maxdepth 1 -type f -name '\*\.md'/);
  assert.match(workflow, /! -name '_Sidebar\.md'/);
  assert.match(workflow, /! -name '_Footer\.md'/);
});
