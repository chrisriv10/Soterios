'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const METHODS = {
  simple: {
    id: 'simple',
    name: 'Simple (1-pass)',
    passes: [{ type: 'random' }]
  },
  dod: {
    id: 'dod',
    name: 'DoD 5220.22-M (3-pass)',
    passes: [{ type: 'zeros' }, { type: 'ones' }, { type: 'random' }]
  },
  schneier: {
    id: 'schneier',
    name: 'Schneier (7-pass)',
    passes: [
      { type: 'ones' },
      { type: 'zeros' },
      { type: 'random' },
      { type: 'random' },
      { type: 'random' },
      { type: 'random' },
      { type: 'random' }
    ]
  },
  gutmann: {
    id: 'gutmann',
    name: 'Gutmann (35-pass)',
    passes: Array.from({ length: 35 }, (_, i) => (
      i < 4 || i >= 31 ? { type: 'random' } : { type: 'pattern', byte: (i * 17) & 0xff }
    ))
  }
};

const CHUNK = 1024 * 1024;

function listFilesRecursive(targetPath, out = []) {
  const st = fs.statSync(targetPath);
  if (st.isFile()) {
    out.push(targetPath);
    return out;
  }
  if (!st.isDirectory()) return out;
  for (const name of fs.readdirSync(targetPath)) {
    listFilesRecursive(path.join(targetPath, name), out);
  }
  return out;
}

async function overwriteFile(filePath, methodId, onProgress) {
  const method = METHODS[methodId] || METHODS.simple;
  const st = await fsp.stat(filePath);
  const size = st.size;
  const fd = await fsp.open(filePath, 'r+');
  try {
    const totalPasses = method.passes.length;
    for (let p = 0; p < totalPasses; p++) {
      const pass = method.passes[p];
      let written = 0;
      while (written < size) {
        const len = Math.min(CHUNK, size - written);
        let buf;
        if (pass.type === 'zeros') buf = Buffer.alloc(len, 0);
        else if (pass.type === 'ones') buf = Buffer.alloc(len, 0xff);
        else if (pass.type === 'pattern') buf = Buffer.alloc(len, pass.byte & 0xff);
        else buf = crypto.randomBytes(len);
        await fd.write(buf, 0, len, written);
        written += len;
        if (onProgress) {
          const pct = ((p + written / size) / totalPasses) * 100;
          onProgress({ filePath, pass: p + 1, totalPasses, pct: Math.min(100, pct) });
        }
      }
      await fd.sync();
    }
  } finally {
    await fd.close();
  }
  await fsp.unlink(filePath);
}

async function shredTargets({ targets, method = 'dod', recursive = true, dryRun = false, confirm = false, onProgress }) {
  if (!Array.isArray(targets) || !targets.length) {
    return { success: false, error: 'No targets provided.' };
  }
  if (!METHODS[method]) {
    return { success: false, error: `Unknown shred method: ${method}` };
  }
  if (!dryRun && !confirm) {
    return { success: false, error: 'Confirmation required before shredding. Pass confirm: true (or use dryRun).' };
  }

  const files = [];
  const errors = [];
  for (const target of targets) {
    try {
      if (!fs.existsSync(target)) {
        errors.push({ path: target, error: 'Path not found' });
        continue;
      }
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        if (!recursive) {
          errors.push({ path: target, error: 'Directory shredding requires recursive: true' });
          continue;
        }
        listFilesRecursive(target, files);
      } else if (st.isFile()) {
        files.push(target);
      }
    } catch (e) {
      errors.push({ path: target, error: e.message || String(e) });
    }
  }

  const uniqueFiles = [...new Set(files)];
  const methodMeta = METHODS[method];
  const estimatedBytes = uniqueFiles.reduce((sum, f) => {
    try { return sum + fs.statSync(f).size * methodMeta.passes.length; } catch (_) { return sum; }
  }, 0);

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      method: methodMeta.id,
      methodName: methodMeta.name,
      fileCount: uniqueFiles.length,
      files: uniqueFiles,
      estimatedOverwriteBytes: estimatedBytes,
      errors
    };
  }

  const shredded = [];
  for (const filePath of uniqueFiles) {
    try {
      await overwriteFile(filePath, method, onProgress);
      shredded.push(filePath);
    } catch (e) {
      errors.push({ path: filePath, error: e.message || String(e) });
    }
  }

  // Remove emptied directories depth-first for recursive folder shreds.
  for (const target of targets) {
    try {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    } catch (e) {
      errors.push({ path: target, error: e.message || String(e) });
    }
  }

  return {
    success: errors.length === 0,
    dryRun: false,
    method: methodMeta.id,
    methodName: methodMeta.name,
    shredded,
    fileCount: shredded.length,
    estimatedOverwriteBytes: estimatedBytes,
    errors
  };
}

module.exports = [
  {
    id: 'file-shredder-methods',
    name: 'List File Shredder Methods',
    description: 'List secure overwrite methods available for the file shredder.',
    category: 'Privacy',
    icon: 'fa-eraser',
    async run() {
      return {
        methods: Object.values(METHODS).map((m) => ({
          id: m.id,
          name: m.name,
          passes: m.passes.length
        }))
      };
    }
  },
  {
    id: 'file-shredder',
    name: 'Secure File Shredder',
    description: 'Permanently overwrite and delete files/folders (DoD, Schneier, Gutmann, or simple). Supports dry-run.',
    category: 'Privacy',
    icon: 'fa-eraser',
    async run(args = {}, onProgress) {
      return shredTargets({
        targets: args.targets || (args.path ? [args.path] : []),
        method: args.method || 'dod',
        recursive: args.recursive !== false,
        dryRun: !!args.dryRun,
        confirm: !!args.confirm,
        onProgress
      });
    }
  }
];

module.exports.helpers = { METHODS, shredTargets, listFilesRecursive };
