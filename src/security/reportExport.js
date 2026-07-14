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
  const s = String(value ?? '');
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

function pdfPathForHtml(htmlPath) {
  return String(htmlPath).replace(/\.html$/i, '.pdf');
}

function csvPathForJson(jsonPath) {
  return String(jsonPath).replace(/\.json$/i, '.csv');
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
    fs.writeFileSync(pdfPath, pdfBuffer);
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
  threatsToCsv,
  pdfPathForHtml,
  csvPathForJson,
  generatePdfFromHtml
};
