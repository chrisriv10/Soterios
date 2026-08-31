#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// GitHub Wiki pages are addressed without the .md suffix. Only rewrite
// relative Markdown links; external URLs and anchors must remain unchanged.
const RELATIVE_MARKDOWN_LINK = /\]\((?![A-Za-z][A-Za-z\d+.-]*:|[/#])([^\s)]+?)\.md(#[^)]*)?\)/gi;

function convertMarkdownLinks(content) {
  return content.replace(RELATIVE_MARKDOWN_LINK, (_match, linkPath, anchor = '') => `](${linkPath}${anchor})`);
}

function convertWikiDirectory(directory) {
  const root = path.resolve(directory);
  let changed = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const file = path.join(root, entry.name);
    const source = fs.readFileSync(file, 'utf8');
    const converted = convertMarkdownLinks(source);
    if (converted === source) continue;
    fs.writeFileSync(file, converted, 'utf8');
    changed += 1;
  }
  return changed;
}

if (require.main === module) {
  const directory = process.argv[2];
  if (!directory) {
    console.error('Usage: node tools/convert-wiki-links.js <wiki-directory>');
    process.exit(1);
  }
  console.log(`Normalized wiki links in ${convertWikiDirectory(directory)} page(s).`);
}

module.exports = { convertMarkdownLinks, convertWikiDirectory };
