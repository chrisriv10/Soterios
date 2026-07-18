'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * File Shredder using DoD 5220.22-M Standard
 * Securely deletes files by overwriting with multiple patterns.
 * DoD 5220.22-M requires:
 * 1. Overwrite with zeros
 * 2. Overwrite with ones (0xFF)
 * 3. Overwrite with random pattern
 * 4. Verify overwrite
 */

const PROTECTED_PATHS = [
  process.env.ProgramData,
  process.env.WINDIR,
  path.join(process.env.USERPROFILE || '', 'AppData')
];

function isSafePath(filePath) {
  const normalized = path.win32.resolve(filePath).toLowerCase();
  
  for (const protectedPath of PROTECTED_PATHS) {
    if (protectedPath && normalized.startsWith(path.win32.resolve(protectedPath).toLowerCase())) {
      return false;
    }
  }
  
  return true;
}

function overwriteWithPattern(filePath, pattern) {
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  const chunkSize = 64 * 1024; // 64KB chunks
  
  const fd = fs.openSync(filePath, 'r+');
  
  try {
    let offset = 0;
    while (offset < fileSize) {
      const remaining = fileSize - offset;
      const writeSize = Math.min(chunkSize, remaining);
      
      const buffer = Buffer.alloc(writeSize);
      if (pattern === 'zeros') {
        buffer.fill(0x00);
      } else if (pattern === 'ones') {
        buffer.fill(0xFF);
      } else if (pattern === 'random') {
        crypto.randomFillSync(buffer);
      }
      
      fs.writeSync(fd, buffer, 0, writeSize, offset);
      offset += writeSize;
    }
    
    // Sync to ensure data is written to disk
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function verifyOverwrite(filePath, expectedPattern) {
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  const chunkSize = 64 * 1024;
  
  const fd = fs.openSync(filePath, 'r');
  
  try {
    let offset = 0;
    while (offset < fileSize) {
      const remaining = fileSize - offset;
      const readSize = Math.min(chunkSize, remaining);
      
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, offset);
      
      // Verify pattern
      for (let i = 0; i < buffer.length; i++) {
        if (expectedPattern === 'zeros' && buffer[i] !== 0x00) {
          return false;
        }
        if (expectedPattern === 'ones' && buffer[i] !== 0xFF) {
          return false;
        }
        // Random pattern can't be verified, so skip
      }
      
      offset += readSize;
    }
  } finally {
    fs.closeSync(fd);
  }
  
  return true;
}

async function shredFile(filePath, passes = 3) {
  if (!isSafePath(filePath)) {
    return { success: false, error: 'Path is not safe for shredding' };
  }
  
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'File does not exist' };
  }
  
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    return { success: false, error: 'Path is not a file' };
  }
  
  const fileSize = stats.size;
  
  try {
    // DoD 5220.22-M standard passes
    const patterns = ['zeros', 'ones', 'random'];
    
    for (let i = 0; i < passes; i++) {
      const pattern = patterns[i % patterns.length];
      overwriteWithPattern(filePath, pattern);
      
      // Verify for deterministic patterns
      if (pattern !== 'random') {
        const verified = verifyOverwrite(filePath, pattern);
        if (!verified) {
          return { success: false, error: `Verification failed on pass ${i + 1}` };
        }
      }
    }
    
    // Rename file to random name before deletion (prevents recovery by filename)
    const dir = path.dirname(filePath);
    const randomName = crypto.randomBytes(16).toString('hex');
    const randomPath = path.join(dir, randomName);
    fs.renameSync(filePath, randomPath);
    
    // Delete the file
    fs.unlinkSync(randomPath);
    
    return {
      success: true,
      originalPath: filePath,
      sizeBytes: fileSize,
      passes: passes
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      originalPath: filePath
    };
  }
}

async function shredFiles(filePaths, passes = 3) {
  const results = [];
  
  for (const filePath of filePaths) {
    const result = await shredFile(filePath, passes);
    results.push(result);
  }
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  return {
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    results,
    totalBytesShredded: successful.reduce((sum, r) => sum + (r.sizeBytes || 0), 0)
  };
}

module.exports = async function fileShredder(args = {}) {
  const { filePaths, passes = 3 } = args;
  
  if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    return {
      success: false,
      error: 'No file paths provided for shredding'
    };
  }
  
  if (filePaths.length === 1) {
    return await shredFile(filePaths[0], passes);
  }
  
  return await shredFiles(filePaths, passes);
};
