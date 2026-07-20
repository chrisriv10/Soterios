'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
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

const USER_OWNED_ROOTS = [
  os.homedir(),
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
  process.env.ProgramFiles,
  process.env['ProgramFiles(x86)']
].filter(Boolean);

const PROTECTED_PATHS = [
  process.env.ProgramData,
  process.env.WINDIR,
  path.join(process.env.USERPROFILE || '', 'AppData')
];

function isPathInsideDir(filePath, rootDir) {
  if (!filePath || !rootDir) return false;
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  const relative = path.relative(root, resolved);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isSafePath(filePath) {
  const normalized = path.resolve(filePath);
  
  // Check if under protected paths
  for (const protectedPath of PROTECTED_PATHS) {
    if (protectedPath && isPathInsideDir(normalized, protectedPath)) {
      return false;
    }
  }
  
  // Check if under explicit user-owned roots
  for (const root of USER_OWNED_ROOTS) {
    if (isPathInsideDir(normalized, root)) {
      return true;
    }
  }
  
  return false;
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

function generateAndVerifyRandom(filePath, fileSize) {
  const chunkSize = 64 * 1024;
  const fd = fs.openSync(filePath, 'r+');
  
  try {
    let offset = 0;
    while (offset < fileSize) {
      const remaining = fileSize - offset;
      const writeSize = Math.min(chunkSize, remaining);
      
      // Generate random buffer
      const buffer = Buffer.alloc(writeSize);
      crypto.randomFillSync(buffer);
      
      // Write the random data
      fs.writeSync(fd, buffer, 0, writeSize, offset);
      
      // Verify by reading back
      const verifyBuffer = Buffer.alloc(writeSize);
      fs.readSync(fd, verifyBuffer, 0, writeSize, offset);
      
      // Compare byte by byte
      for (let i = 0; i < writeSize; i++) {
        if (buffer[i] !== verifyBuffer[i]) {
          return false;
        }
      }
      
      offset += writeSize;
    }
    
    // Sync to ensure data is written to disk
    fs.fsyncSync(fd);
    return true;
  } finally {
    fs.closeSync(fd);
  }
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
      
      // For random pattern, generate and verify the random data
      if (pattern === 'random') {
        const randomBuffer = await generateAndVerifyRandom(filePath, fileSize);
        if (!randomBuffer) {
          return { success: false, error: `Verification failed on pass ${i + 1} (random)` };
        }
      } else {
        overwriteWithPattern(filePath, pattern);
        
        // Verify for deterministic patterns
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
  
  // Validate passes parameter - must be exactly 3 (DoD 5220.22-M standard)
  if (!Number.isInteger(passes) || passes !== 3) {
    return {
      success: false,
      error: 'passes must be exactly 3'
    };
  }
  
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
