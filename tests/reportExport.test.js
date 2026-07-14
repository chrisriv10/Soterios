const fs = require('fs');
const os = require('os');
const path = require('path');

const mockPrintToPDF = jest.fn();
const mockLoadFile = jest.fn();
const mockDestroy = jest.fn();
const mockSetWindowOpenHandler = jest.fn();
const mockOn = jest.fn();

jest.mock('electron', () => ({
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: mockLoadFile,
    webContents: {
      printToPDF: mockPrintToPDF,
      setWindowOpenHandler: mockSetWindowOpenHandler,
      on: mockOn
    },
    destroy: mockDestroy,
    isDestroyed: jest.fn().mockReturnValue(false)
  }))
}));

const { BrowserWindow } = require('electron');
const {
  threatsToCsv,
  csvEscape,
  isThreatQuarantined,
  csvPathForJson,
  pdfPathForHtml,
  isPathInScanReportsDir,
  isPathInAllowedReportDir,
  generatePdfFromHtml
} = require('../src/security/reportExport');

describe('reportExport CSV', () => {
  test('serializes threat entries with expected columns', () => {
    const csv = threatsToCsv({
      status: 'completed',
      threats: [
        { name: 'Eicar-Test-Signature', path: 'C:\\temp\\eicar.com' }
      ],
      errors: []
    });

    expect(csv).toBe(
      'name,path,quarantined\n' +
      'Eicar-Test-Signature,C:\\temp\\eicar.com,true\n'
    );
  });

  test('exports header only for empty threat lists', () => {
    expect(threatsToCsv({ status: 'completed', threats: [], errors: [] }))
      .toBe('name,path,quarantined\n');
  });

  test('escapes commas and quotes in CSV values', () => {
    const csv = threatsToCsv({
      status: 'completed',
      threats: [{ name: 'Threat, "A"', path: 'C:\\dir\\file, test.exe' }],
      errors: []
    });

    expect(csv).toContain('"Threat, ""A"""');
    expect(csv).toContain('"C:\\dir\\file, test.exe"');
  });

  test('marks quarantined false when quarantine failed', () => {
    const quarantined = isThreatQuarantined(
      { name: 'Bad', path: 'C:\\infected.exe' },
      {
        status: 'completed',
        errors: ['Failed to quarantine C:\\infected.exe: access denied']
      }
    );

    expect(quarantined).toBe(false);
  });

  test('marks quarantined true on failed scan when quarantine succeeded', () => {
    const csv = threatsToCsv({
      status: 'failed',
      threats: [{ name: 'Bad', path: 'C:\\infected.exe' }],
      errors: ['Scan interrupted']
    });

    expect(csv).toContain('C:\\infected.exe,true');
  });

  test('derives export paths from report files', () => {
    expect(csvPathForJson('C:\\reports\\scan-quick-1.json')).toBe('C:\\reports\\scan-quick-1.csv');
    expect(pdfPathForHtml('C:\\reports\\scan-quick-1.html')).toBe('C:\\reports\\scan-quick-1.pdf');
  });

  test('validates scan report directory membership', () => {
    const dir = path.join(os.homedir(), '.soterios', 'scan-reports');
    const inside = path.join(dir, 'scan-quick-test.json');
    expect(isPathInScanReportsDir(inside)).toBe(true);
    expect(isPathInScanReportsDir('C:\\Windows\\System32\\evil.json')).toBe(false);
  });

  test('rejects sibling directories that share a prefix', () => {
    const evil = path.join(os.homedir(), '.soterios', 'scan-reports-evil', 'fake.json');
    expect(isPathInScanReportsDir(evil)).toBe(false);
    expect(isPathInAllowedReportDir(evil)).toBe(false);
  });

  test('allows security reports directory for openPath allowlist', () => {
    const inside = path.join(os.homedir(), '.soterios', 'reports', 'security-report.json');
    expect(isPathInAllowedReportDir(inside)).toBe(true);
  });
});

describe('reportExport PDF helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadFile.mockResolvedValue(undefined);
    mockPrintToPDF.mockResolvedValue(Buffer.from('%PDF-1.4'));
  });

  test('missing HTML report paths fail path validation', () => {
    expect(isPathInScanReportsDir('/tmp/not-a-report.html')).toBe(false);
  });

  test('csv can be written to scan reports directory', () => {
    const dir = path.join(os.homedir(), '.soterios', 'scan-reports');
    fs.mkdirSync(dir, { recursive: true });
    const jsonPath = path.join(dir, 'jest-export-test.json');
    const csvPath = csvPathForJson(jsonPath);
    const csv = threatsToCsv({ status: 'completed', threats: [], errors: [] });

    fs.writeFileSync(csvPath, csv, 'utf8');
    expect(fs.existsSync(csvPath)).toBe(true);
    expect(fs.readFileSync(csvPath, 'utf8')).toBe('name,path,quarantined\n');
    fs.unlinkSync(csvPath);
  });

  test('generatePdfFromHtml writes PDF beside HTML and returns path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-pdf-'));
    const htmlPath = path.join(dir, 'report.html');
    fs.writeFileSync(htmlPath, '<html><body>test</body></html>');

    const pdfPath = await generatePdfFromHtml(htmlPath);

    expect(pdfPath).toBe(pdfPathForHtml(htmlPath));
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(mockLoadFile).toHaveBeenCalledWith(htmlPath);
    expect(mockPrintToPDF).toHaveBeenCalledWith({ printBackground: true });
    expect(mockDestroy).toHaveBeenCalled();

    fs.unlinkSync(htmlPath);
    fs.unlinkSync(pdfPath);
    fs.rmdirSync(dir);
  });

  test('generatePdfFromHtml rejects missing HTML files', async () => {
    await expect(generatePdfFromHtml(path.join(os.tmpdir(), 'missing-soterios-report.html')))
      .rejects.toThrow('Report HTML file not found.');
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  test('generatePdfFromHtml hardens BrowserWindow webPreferences', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-pdf-'));
    const htmlPath = path.join(dir, 'report.html');
    fs.writeFileSync(htmlPath, '<html><body>test</body></html>');

    await generatePdfFromHtml(htmlPath);

    expect(BrowserWindow).toHaveBeenCalledWith({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false
      }
    });
    expect(mockSetWindowOpenHandler).toHaveBeenCalled();
    expect(mockOn).toHaveBeenCalledWith('will-navigate', expect.any(Function));

    fs.unlinkSync(htmlPath);
    fs.unlinkSync(pdfPathForHtml(htmlPath));
    fs.rmdirSync(dir);
  });
});
