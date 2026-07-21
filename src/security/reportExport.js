const fs = require('fs');
const path = require('path');
const os = require('os');

function scanReportsDir() {
  const dir = path.join(os.homedir(), '.soterios', 'scan-reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function securityReportsDir() {
  return path.join(os.homedir(), '.soterios', 'reports');
}

function isPathInsideDir(filePath, rootDir) {
  if (!filePath || !rootDir) return false;
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  const relative = path.relative(root, resolved);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isPathInScanReportsDir(filePath) {
  return isPathInsideDir(filePath, scanReportsDir());
}

function isPathInAllowedReportDir(filePath) {
  return isPathInScanReportsDir(filePath) || isPathInsideDir(filePath, securityReportsDir());
}

function csvEscape(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isThreatQuarantined(threat, report) {
  if (typeof threat.quarantined === 'boolean') return threat.quarantined;
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  const threatPath = threat.path || '';
  return !errors.some((entry) => {
    const text = String(entry);
    return text.includes(threatPath) && /failed to quarantine/i.test(text);
  });
}

function threatsToCsv(report) {
  const threats = Array.isArray(report?.threats) ? report.threats : [];
  const lines = ['name,path,quarantined'];
  for (const threat of threats) {
    const quarantined = isThreatQuarantined(threat, report);
    lines.push([
      csvEscape(threat.name || ''),
      csvEscape(threat.path || ''),
      csvEscape(quarantined)
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

function securityReportToCsv(report) {
  const lines = [];
  
  // Overview section
  lines.push(csvEscape('=== OVERVIEW ==='));
  const overview = report.overview || {};
  lines.push(['score', 'level', 'generated_at'].join(','));
  lines.push([
    csvEscape(overview.score ?? ''),
    csvEscape(overview.level ?? ''),
    csvEscape(report.generatedAt ?? '')
  ].join(','));
  lines.push('');
  
  // Recommendations section
  lines.push(csvEscape('=== RECOMMENDATIONS ==='));
  const recommendations = report.recommendations || overview.recommendations || [];
  lines.push(['level', 'title', 'detail'].join(','));
  for (const rec of recommendations) {
    lines.push([
      csvEscape(rec.level ?? ''),
      csvEscape(rec.title ?? ''),
      csvEscape(rec.detail ?? '')
    ].join(','));
  }
  lines.push('');
  
  // System snapshot section
  lines.push(csvEscape('=== SYSTEM SNAPSHOT ==='));
  const system = report.system || {};
  const snapshotEntries = Object.entries(system);
  lines.push(['category', 'key', 'value'].join(','));
  for (const [category, data] of snapshotEntries) {
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        lines.push([
          csvEscape(category),
          csvEscape(key),
          csvEscape(String(value ?? ''))
        ].join(','));
      }
    }
  }
  
  return lines.join('\n') + '\n';
}

function pdfPathForHtml(htmlPath) {
  return String(htmlPath).replace(/\.html$/i, '.pdf');
}

function csvPathForJson(jsonPath) {
  return String(jsonPath).replace(/\.json$/i, '.csv');
}

// Guards against writing through a symlink/hardlink that an attacker may
// have pre-created at the derived export destination. Export paths are
// timestamp-derived, so they should never need to overwrite an existing
// file. Use atomic open flags to avoid TOCTOU: O_EXCL for exclusive
// create, O_NOFOLLOW on POSIX to refuse symlinks at open time.
function safeWriteFileSync(destPath, data, encoding) {
  const isWin = process.platform === 'win32';
  const flags = isWin
    ? fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_TRUNC
    : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  
  const fd = fs.openSync(destPath, flags);
  try {
    fs.writeSync(fd, encoding ? Buffer.from(data, encoding) : Buffer.from(data));
  } finally {
    fs.closeSync(fd);
  }
}

async function generatePdfFromHtml(htmlPath) {
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    throw new Error('Report HTML file not found.');
  }

  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  try {
    await win.loadFile(htmlPath);
    const pdfBuffer = await win.webContents.printToPDF({ printBackground: true });
    const pdfPath = pdfPathForHtml(htmlPath);
    safeWriteFileSync(pdfPath, pdfBuffer);
    return pdfPath;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = {
  scanReportsDir,
  securityReportsDir,
  isPathInsideDir,
  isPathInScanReportsDir,
  isPathInAllowedReportDir,
  csvEscape,
  isThreatQuarantined,
  safeWriteFileSync,
  threatsToCsv,
  securityReportToCsv,
  pdfPathForHtml,
  csvPathForJson,
  generatePdfFromHtml
};
