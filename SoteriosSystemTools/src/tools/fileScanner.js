const fs = require('fs');
const { loadSignatureDB, scanFile, walkDirectory, quarantineFile } = require('../av/scanner');

module.exports = [
  {
    id: 'file-scanner',
    name: 'File Scanner',
    description: 'Scan a folder against the local signature database and run heuristics.',
    category: 'Security',
    icon: 'search',
    run: async (args, ctx) => {
      const targetPath = args && args.path;
      if (!targetPath || !fs.existsSync(targetPath)) {
        throw new Error('A valid folder path is required');
      }

      const signatures = loadSignatureDB();
      const filesToScan = [];
      walkDirectory(targetPath, (f) => filesToScan.push(f));

      const results = [];
      let scanned = 0;

      for (const file of filesToScan) {
        const result = await scanFile(file, signatures);
        results.push(result);
        scanned++;
        if (ctx && ctx.sendProgress) {
          ctx.sendProgress({
            scanned,
            total: filesToScan.length,
            currentFile: file
          });
        }
      }

      const summary = {
        totalScanned: results.length,
        clean: results.filter((r) => r.status === 'clean').length,
        suspicious: results.filter((r) => r.status === 'suspicious').length,
        matches: results.filter((r) => r.status === 'match').length,
        errors: results.filter((r) => r.status === 'error').length
      };

      return { summary, results };
    }
  },
  {
    id: 'quarantine-file',
    name: 'Quarantine File',
    description: 'Move a flagged file to the local quarantine folder.',
    category: 'Security',
    icon: 'archive',
    run: async (args) => {
      const targetPath = args && args.path;
      if (!targetPath || !fs.existsSync(targetPath)) {
        throw new Error('A valid file path is required');
      }
      const dest = quarantineFile(targetPath);
      return { quarantinedTo: dest };
    }
  }
];
