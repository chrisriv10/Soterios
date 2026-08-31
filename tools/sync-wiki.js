#!/usr/bin/env node
/**
 * Sync docs/wiki to GitHub .wiki repository
 * 
 * This script copies markdown files from docs/wiki to the .wiki repository,
 * converting internal links from .md to no extension format.
 * 
 * GitHub wikis don't use .md extensions in their URLs, so links like
 * [Installation](Installation.md) need to become [Installation](Installation)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { convertMarkdownLinks, convertWikiDirectory } = require('./convert-wiki-links');

const SOURCE_DIR = path.join(__dirname, '..', 'docs', 'wiki');
const WIKI_REPO_DIR = path.join(__dirname, '..', '.wiki');

// Configuration: set this to your wiki repository URL if not already cloned
const WIKI_REPO_URL = 'https://github.com/chrisriv10/Soterios.wiki.git';

function ensureWikiRepo() {
  if (!fs.existsSync(WIKI_REPO_DIR)) {
    console.log('Cloning wiki repository...');
    try {
      // Use an argument array to avoid shell injection.
      execFileSync('git', ['clone', WIKI_REPO_URL, WIKI_REPO_DIR], { stdio: 'inherit' });
    } catch (error) {
      console.error('Failed to clone wiki repository:', error.message);
      process.exit(1);
    }
  }
}

function syncWiki() {
  console.log('Syncing wiki files...');

  // Ensure wiki repo exists
  ensureWikiRepo();

  // Read all markdown files from source
  const files = fs.readdirSync(SOURCE_DIR)
    .filter(file => file.endsWith('.md'));

  console.log(`Found ${files.length} markdown files to sync`);

  // Process each file
  files.forEach(file => {
    const sourcePath = path.join(SOURCE_DIR, file);
    const targetPath = path.join(WIKI_REPO_DIR, file);

    // Read source content
    const content = fs.readFileSync(sourcePath, 'utf8');

    // Write to wiki repo
    fs.writeFileSync(targetPath, content, 'utf8');
    console.log(`  ✓ ${file}`);
  });

  // GitHub Wiki page URLs omit the .md suffix. Keep the source links
  // repository-friendly, and normalize only the copied wiki pages.
  convertWikiDirectory(WIKI_REPO_DIR);

  // Commit and push
  console.log('\nCommitting changes to wiki repository...');
  try {
    execFileSync('git', ['add', '.'], { cwd: WIKI_REPO_DIR, stdio: 'inherit' });
    
    // Check if there are changes to commit
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: WIKI_REPO_DIR, encoding: 'utf8' });
    
    if (status.trim()) {
      execFileSync('git', ['commit', '-m', 'Sync wiki from docs/wiki'], { cwd: WIKI_REPO_DIR, stdio: 'inherit' });
      console.log('Pushing to GitHub...');
      execFileSync('git', ['push', 'origin', 'master'], { cwd: WIKI_REPO_DIR, stdio: 'inherit' });
      console.log('✓ Wiki synced successfully!');
    } else {
      console.log('No changes to commit.');
    }
  } catch (error) {
    console.error('Failed to commit/push changes:', error.message);
    process.exit(1);
  }
}

if (require.main === module) syncWiki();

module.exports = { convertMarkdownLinks, syncWiki };
