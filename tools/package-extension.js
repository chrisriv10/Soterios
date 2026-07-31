#!/usr/bin/env node
/**
 * Package Soterios Browser Extension
 * Creates a cross-platform zip archive excluding build artifacts
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const extDir = path.resolve(__dirname, '..', 'browser-extension');
const outputPath = path.resolve(__dirname, '..', 'soterios-extension.zip');

const excludePatterns = [
  '*.DS_Store',
  'node_modules',
  'icons/*.svg',
  'tools',
  'package.json',
  'package-lock.json'
];

function shouldExclude(filePath) {
  const relativePath = path.relative(extDir, filePath);
  
  for (const pattern of excludePatterns) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(path.basename(relativePath)) || regex.test(relativePath)) {
        return true;
      }
    } else if (relativePath.startsWith(pattern) || relativePath === pattern) {
      return true;
    }
  }
  
  return false;
}

function addDirectoryToZip(zip, dirPath, basePath) {
  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);
    
    if (shouldExclude(fullPath)) {
      continue;
    }
    
    if (stat.isDirectory()) {
      addDirectoryToZip(zip, fullPath, basePath);
    } else if (stat.isFile()) {
      const relativePath = path.relative(basePath, fullPath);
      zip.addLocalFile(fullPath, path.dirname(relativePath));
    }
  }
}

function main() {
  if (!fs.existsSync(extDir)) {
    console.error('browser-extension directory not found');
    process.exit(1);
  }

  console.log('Creating extension package...');
  
  const zip = new AdmZip();
  addDirectoryToZip(zip, extDir, extDir);
  
  zip.writeZip(outputPath);
  console.log(`Extension packaged to: ${outputPath}`);
}

main();
