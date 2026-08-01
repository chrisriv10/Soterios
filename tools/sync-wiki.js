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
const { execSync } = require('child_process');

const SOURCE_DIR = path.join(__dirname, '..', 'docs', 'wiki');
const WIKI_REPO_DIR = path.join(__dirname, '..', '.wiki');

// Configuration: set this to your wiki repository URL if not already cloned
const WIKI_REPO_URL = 'https://github.com/chrisriv10/Soterios.wiki.git';

function convertMarkdownLinks(content) {
  // Convert ](Something.md) to ](Something)
  // This regex matches markdown links with .md extension
  return content.replace(/\]\(([^)]+\.md)\)/g, (match, linkPath) => {
    const newPath = linkPath.replace(/\.md$/, '');
    return `](${newPath})`;
  });
}

function ensureWikiRepo() {
  if (!fs.existsSync(WIKI_REPO_DIR)) {
    console.log('Cloning wiki repository...');
    try {
      execSync(`git clone ${WIKI_REPO_URL} ${WIKI_REPO_DIR}`, { stdio: 'inherit' });
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

    // Convert links
    const convertedContent = convertMarkdownLinks(content);

    // Write to wiki repo
    fs.writeFileSync(targetPath, convertedContent, 'utf8');
    console.log(`  ✓ ${file}`);
  });

  // Commit and push
  console.log('\nCommitting changes to wiki repository...');
  try {
    execSync('git add .', { cwd: WIKI_REPO_DIR, stdio: 'inherit' });
    
    // Check if there are changes to commit
    const status = execSync('git status --porcelain', { cwd: WIKI_REPO_DIR, encoding: 'utf8' });
    
    if (status.trim()) {
      execSync('git commit -m "Sync wiki from docs/wiki"', { cwd: WIKI_REPO_DIR, stdio: 'inherit' });
      console.log('Pushing to GitHub...');
      execSync('git push origin master', { cwd: WIKI_REPO_DIR, stdio: 'inherit' });
      console.log('✓ Wiki synced successfully!');
    } else {
      console.log('No changes to commit.');
    }
  } catch (error) {
    console.error('Failed to commit/push changes:', error.message);
    process.exit(1);
  }
}

// Run the sync
syncWiki();
