const fs = require('fs');
const path = require('path');
const os = require('os');
const { NotFoundError } = require('../utils/errors');

/**
 * Returns the directory where scan report JSON/HTML files are stored.
 *
 * @returns {string} Absolute path to the scan-reports directory.
 */
function scanReportsDir() {
  const dir = path.join(os.homedir(), '.soterios', 'scan-reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Returns the directory where security report exports are stored.
 *
 * @returns {string} Absolute path to the security reports directory.
 */
function securityReportsDir() {
  return path.join(os.homedir(), '.soterios', 'reports');
}

/**
 * Determines whether `filePath` resides inside `rootDir`.
 *
 * @param {string} filePath - Path to test.
 * @param {string} rootDir - Root directory that `filePath` must be inside.
 * @returns {boolean} True when `filePath` is inside `rootDir`.
 */
function isPathInsideDir(filePath, rootDir) {
  if (!filePath || !rootDir) return false;
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  const relative = path.relative(root, resolved);
  if (relative === '') return true;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Checks whether a path is inside the scan-reports directory.
 *
 * @param {string} filePath - Path to test.
 * @returns {boolean}
 */
function isPathInScanReportsDir(filePath) {
  return isPathInsideDir(filePath, scanReportsDir());
}

/**
 * Checks whether a path is inside an allowed report export directory.
 *
 * @param {string} filePath - Path to test.
 * @returns {boolean}
 */
function isPathInAllowedReportDir(filePath) {
  return isPathInScanReportsDir(filePath) || isPathInsideDir(filePath, securityReportsDir());
}

/**
 * Escapes a value for safe inclusion in a CSV field.
 *
 * Prefixes values starting with `=`, `+`, `-`, or `@` with a single quote
 * to prevent formula injection. Wraps values containing quotes, commas,
 * or newlines in double quotes and escapes internal double quotes.
 *
 * @param {*} value - Value to escape (converted to string).
 * @returns {string} CSV-safe field value.
 */
function csvEscape(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Determines whether a threat entry was successfully quarantined.
 *
 * A threat is considered quarantined when either its `quarantined` flag
 * is explicitly `true` or the scan report does not contain a quarantine
 * failure entry matching the threat's path.
 *
 * @param {Object} threat - Threat object from the scan report.
 * @param {Object} report - Full scan report object.
 * @returns {boolean}
 */
function isThreatQuarantined(threat, report) {
  if (typeof threat.quarantined === 'boolean') return threat.quarantined;
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  const threatPath = threat.path || '';
  return !errors.some((entry) => {
    const text = String(entry);
    return text.includes(threatPath) && /failed to quarantine/i.test(text);
  });
}

/**
 * Converts scan report threats to a CSV string.
 *
 * @param {Object} report - Scan report containing a `threats` array.
 * @returns {string} CSV content with header row.
 */
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

/**
 * Converts a security report object to CSV format.
 *
 * Emits overview, recommendations, and system snapshot sections.
 *
 * @param {Object} report - Security report object.
 * @returns {string} CSV content.
 */
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

/**
 * Derives a PDF output path from an HTML report path.
 *
 * @param {string} htmlPath - HTML report file path.
 * @returns {string} Corresponding PDF file path.
 */
function pdfPathForHtml(htmlPath) {
  return String(htmlPath).replace(/\.html$/i, '.pdf');
}

/**
 * Derives a CSV output path from a JSON report path.
 *
 * @param {string} jsonPath - JSON report file path.
 * @returns {string} Corresponding CSV file path.
 */
function csvPathForJson(jsonPath) {
  return String(jsonPath).replace(/\.json$/i, '.csv');
}

// Guards against writing through a symlink/hardlink that an attacker may
// have pre-created at the derived export destination. Export paths are
// timestamp-derived, so they should never need to overwrite an existing
// file. Use atomic open flags to avoid TOCTOU: O_EXCL for exclusive
// create, O_NOFOLLOW on POSIX to refuse symlinks at open time.
/**
 * Writes data to a file path using exclusive-create, no-follow flags.
 *
 * On Windows, uses `O_EXCL | O_TRUNC`. On POSIX, additionally uses
 * `O_NOFOLLOW` to refuse symlinks at open time. This guards against
 * writing through a symlink or hardlink that an attacker may have
 * pre-created at the export destination.
 *
 * @param {string} destPath - Destination file path.
 * @param {string|Buffer} data - Content to write.
 * @param {string} [encoding] - Encoding when `data` is a string.
 * @throws {Error} If the destination already exists or cannot be written safely.
 */
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

/**
 * Render an HTML report to PDF using Electron's `printToPDF`.
 *
 * @param {string} htmlPath - Path to the HTML report file.
 * @returns {Promise<string>} Path to the generated PDF file.
 * @throws {Error} If the HTML file does not exist or PDF generation fails.
 */
async function generatePdfFromHtml(htmlPath) {
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    throw new NotFoundError('Report HTML file not found.');
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
