/**
 * Documentation Coverage Analyzer for Soterios
 * Uses @babel/parser for AST-based analysis
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const REPO_ROOT = 'D:/Soterios';
const OUTPUT_DIR = path.join(REPO_ROOT, 'documentation-audit');

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'build',
  'dist',
  '.opencode',
  'assets/clamav',
]);

const EXCLUDED_FILE_PATTERNS = [
  /\.min\.js$/,
  /\.d\.ts$/,
];

/**
 * Determines whether a file should be excluded from documentation analysis.
 *
 * @param {string} filePath - Absolute file path.
 * @returns {boolean} True if the file should be excluded.
 */
function shouldExclude(filePath) {
  const rel = path.relative(REPO_ROOT, filePath);
  const normalizedRel = path.normalize(rel);

  for (const excluded of EXCLUDED_DIRS) {
    const normalizedExcluded = path.normalize(excluded);
    if (
      normalizedRel === normalizedExcluded ||
      normalizedRel.startsWith(normalizedExcluded + path.sep)
    ) {
      return true;
    }
  }

  for (const pattern of EXCLUDED_FILE_PATTERNS) {
    if (pattern.test(rel)) return true;
  }
  return false;
}

/**
 * Categorizes a file by its top-level directory.
 *
 * @param {string} filePath - Absolute file path.
 * @returns {string} Category: 'tests', 'tools', 'browser-extension', or 'production'.
 */
function getCategory(filePath) {
  const rel = path.relative(REPO_ROOT, filePath);
  if (rel.startsWith('tests/') || rel.startsWith('tests\\')) return 'tests';
  if (rel.startsWith('tools/') || rel.startsWith('tools\\')) return 'tools';
  if (rel.startsWith('browser-extension/') || rel.startsWith('browser-extension\\')) return 'browser-extension';
  return 'production';
}

/**
 * Assesses the quality of a JSDoc comment text.
 *
 * @param {string} docText - Raw JSDoc comment text.
 * @returns {string} Quality rating: 'empty', 'minimal', 'adequate', or 'good'.
 */
function assessDocQuality(docText) {
  if (!docText || docText.trim().length === 0) return 'empty';
  
  const text = docText.trim();
  const lines = text.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(l => l.length > 0);
  if (lines.length === 0) return 'empty';
  
  const meaningfulLines = lines.filter(l => !l.match(/^@/));
  if (meaningfulLines.length === 0) return 'minimal';
  
  const descText = meaningfulLines.join(' ');
  if (descText.length < 20) return 'minimal';
  if (descText.match(/^TODO|FIXME/)) return 'minimal';
  
  const hasParam = text.includes('@param');
  const hasReturns = text.includes('@returns') || text.includes('@return');
  const hasThrows = text.includes('@throws') || text.includes('@throw');
  const hasExample = text.includes('@example');
  
  const tagScore = (hasParam ? 1 : 0) + (hasReturns ? 1 : 0) + (hasThrows ? 1 : 0) + (hasExample ? 1 : 0);
  
  if (tagScore >= 2 && descText.length >= 50) return 'good';
  if (tagScore >= 1 || descText.length >= 40) return 'partial';
  return 'minimal';
}

/**
 * Extracts JSDoc comment text for a given AST node.
 *
 * @param {string} sourceCode - Full source code.
 * @param {Object} node - Babel AST node.
 * @param {Object} [parent] - Parent AST node.
 * @returns {string|null} JSDoc text or null.
 */
function getJSDocForNode(sourceCode, node, parent) {
  if (!node.loc) return null;
  const startLine = node.loc.start.line;

  // Check the node itself and relevant parents — Babel attaches leading
  // JSDoc to different ancestors depending on the construct:
  //   ExpressionStatement for `module.exports = ...`
  //   VariableDeclaration for `const fn = (...) => ...`
  const candidates = [node];
  if (parent && parent.type === 'ExpressionStatement') {
    candidates.push(parent);
  }
  if (parent && parent.type === 'VariableDeclaration') {
    candidates.push(parent);
  }

  for (const n of candidates) {
    if (n.leadingComments && n.leadingComments.length > 0) {
      const jsDocComments = n.leadingComments.filter(c => c.type === 'CommentBlock' && c.value.startsWith('*'));
      if (jsDocComments.length > 0) {
        const lastComment = jsDocComments[jsDocComments.length - 1];
        if (startLine - lastComment.loc.end.line <= 5) {
          return lastComment.value.replace(/^\*/, '').trim();
        }
      }
    }
  }
  return null;
}

/**
 * Analyzes a single JS file for documentation coverage.
 *
 * @param {string} filePath - Absolute path to the JS file.
 * @returns {Object|null} Analysis result or null if excluded.
 */
function analyzeFile(filePath) {
  const sourceCode = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(REPO_ROOT, filePath);
  const category = getCategory(filePath);
  
  if (shouldExclude(filePath)) return null;
  
  const result = {
    file: relPath,
    category,
    language: 'javascript',
    totalElements: 0,
    documentedElements: 0,
    adequateElements: 0,
    publicTotal: 0,
    publicDocumented: 0,
    elements: [],
    exports: [],
    moduleDoc: null,
    parseError: null,
  };
  
  // Module-level JSDoc
  const firstLines = sourceCode.split('\n').slice(0, 15).join('\n');
  const moduleDocMatch = firstLines.match(/\/\*\*([\s\S]*?)\*\//);
  if (moduleDocMatch) {
    result.moduleDoc = moduleDocMatch[1].replace(/^\s*\*\s?/gm, '').trim();
    if (result.moduleDoc.length > 20) {
      result.totalElements++;
      result.documentedElements++;
      result.adequateElements++;
    }
  } else {
    // Fallback: look for /** near the top of the file (first 1000 chars)
    const topChunk = sourceCode.slice(0, 1000);
    const topMatch = topChunk.match(/\/\*\*([\s\S]*?)\*\//);
    if (topMatch) {
      const docText = topMatch[1].replace(/^\s*\*\s?/gm, '').trim();
      if (docText.length > 20) {
        result.moduleDoc = docText;
        result.totalElements++;
        result.documentedElements++;
        result.adequateElements++;
      }
    }
  }
  
  // Detect exports
  const exportMatches = [...sourceCode.matchAll(/module\.exports\s*=\s*(\w+)/g)];
  const exportsDotMatches = [...sourceCode.matchAll(/exports\.(\w+)/g)];
  const exportedNames = new Set();
  exportMatches.forEach(m => exportedNames.add(m[1]));
  exportsDotMatches.forEach(m => exportedNames.add(m[1]));
  
  // module.exports = async function name(...)
  const asyncFuncMatches = [...sourceCode.matchAll(/module\.exports\s*=\s*async\s+function\s+(\w+)/g)];
  asyncFuncMatches.forEach(m => exportedNames.add(m[1]));
  
  // module.exports = function name(...)
  const funcExprMatches = [...sourceCode.matchAll(/module\.exports\s*=\s*function\s+(\w+)/g)];
  funcExprMatches.forEach(m => exportedNames.add(m[1]));
  
  // module.exports = async (args) => ... (anonymous)
  // module.exports = (args) => ... (anonymous)
  // For these, we can't easily get the name, but they are public exports
  const anonAsyncExport = sourceCode.match(/module\.exports\s*=\s*async\s*\(/);
  const anonArrowExport = sourceCode.match(/module\.exports\s*=\s*\(/);
  if (anonAsyncExport || anonArrowExport) {
    exportedNames.add('__anonymous_export__');
  }
  
  const moduleExportObjMatch = sourceCode.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/);
  if (moduleExportObjMatch) {
    const objContent = moduleExportObjMatch[1];
    // Extract all word tokens that look like identifiers (not JS keywords)
    const jsKeywords = new Set(['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','this','typeof','instanceof','in','of','try','catch','finally','throw','async','await','yield','class','extends','super','import','export','default','from','as','static','get','set']);
    const nameMatches = [...objContent.matchAll(/\b(\w+)\b/g)];
    nameMatches.forEach(m => {
      if (!jsKeywords.has(m[1])) exportedNames.add(m[1]);
    });
  }
  
  result.exports = [...exportedNames];
  
  let ast;
  try {
    ast = parser.parse(sourceCode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch (e) {
    try {
      ast = parser.parse(sourceCode, { sourceType: 'script', plugins: ['jsx', 'typescript'] });
    } catch (e2) {
      result.parseError = e2.message;
      return result;
    }
  }
  
  /**
   * Recursively visits AST nodes and records documentation coverage.
   *
   * @param {Object} node - Babel AST node.
   * @param {Object} [parent] - Parent AST node.
   */
  function visitNode(node, parent) {
    if (!node || typeof node !== 'object') return;
    
    if (node.type === 'ClassDeclaration' && node.id) {
      const className = node.id.name;
      const jsDoc = getJSDocForNode(sourceCode, node, parent);
      const isPublic = exportedNames.has(className);
      
      result.elements.push({
        name: className,
        type: 'class',
        visibility: isPublic ? 'public' : 'internal',
        hasDoc: !!jsDoc,
        docQuality: jsDoc ? assessDocQuality(jsDoc) : 'missing',
        line: node.loc.start.line,
        methods: [],
      });
      
      if (node.body && node.body.body) {
        for (const method of node.body.body) {
          if (method.type === 'ClassMethod' || method.type === 'MethodDefinition') {
            const methodName = method.key?.name || method.key?.value || 'unknown';
            const methodDoc = getJSDocForNode(sourceCode, method, node);
            const isMethodPublic = isPublic && !methodName.startsWith('_');
            
            result.elements.push({
              name: methodName,
              type: 'method',
              visibility: isMethodPublic ? 'public' : 'internal',
              hasDoc: !!methodDoc,
              docQuality: methodDoc ? assessDocQuality(methodDoc) : 'missing',
              line: method.loc.start.line,
              parent: className,
            });
          }
        }
      }
    }
    
    if (node.type === 'FunctionDeclaration' && node.id) {
      const funcName = node.id.name;
      const jsDoc = getJSDocForNode(sourceCode, node, parent);
      const isPublic = exportedNames.has(funcName);
      
      result.elements.push({
        name: funcName,
        type: 'function',
        visibility: isPublic ? 'public' : 'internal',
        hasDoc: !!jsDoc,
        docQuality: jsDoc ? assessDocQuality(jsDoc) : 'missing',
        line: node.loc.start.line,
      });
    }
    
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.init && (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
          const varName = decl.id?.name;
          if (varName) {
            const jsDoc = getJSDocForNode(sourceCode, decl, node);
            const isPublic = exportedNames.has(varName);
            
            result.elements.push({
              name: varName,
              type: 'function',
              visibility: isPublic ? 'public' : 'internal',
              hasDoc: !!jsDoc,
              docQuality: jsDoc ? assessDocQuality(jsDoc) : 'missing',
              line: decl.loc.start.line,
            });
          }
        }
      }
    }
    
    // Handle module.exports = function/async function/arrow
    if (node.type === 'AssignmentExpression' && node.operator === '=') {
      const left = node.left;
      const isModuleExport = left.type === 'MemberExpression' && 
        left.object?.name === 'module' && 
        left.property?.name === 'exports';
      const isExportsDot = left.type === 'MemberExpression' && 
        left.object?.name === 'exports';
      
      if (isModuleExport || isExportsDot) {
        const right = node.right;
        if (right.type === 'FunctionExpression' || right.type === 'ArrowFunctionExpression') {
          const funcName = right.id?.name || (isModuleExport ? '__module_export__' : (left.property?.name || '__exports_export__'));
          const jsDoc = getJSDocForNode(sourceCode, node, parent);
          
          result.elements.push({
            name: funcName,
            type: 'function',
            visibility: 'public',
            hasDoc: !!jsDoc,
            docQuality: jsDoc ? assessDocQuality(jsDoc) : 'missing',
            line: node.loc.start.line,
          });
        } else if (right.type === 'ClassExpression') {
          const className = right.id?.name || '__module_export__';
          const jsDoc = getJSDocForNode(sourceCode, node, parent);
          
          result.elements.push({
            name: className,
            type: 'class',
            visibility: 'public',
            hasDoc: !!jsDoc,
            docQuality: jsDoc ? assessDocQuality(jsDoc) : 'missing',
            line: node.loc.start.line,
            methods: [],
          });
        }
      }
    }
    
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue;
      const child = node[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c && typeof c === 'object' && c.type) visitNode(c, node);
          }
        } else if (child.type) {
          visitNode(child, node);
        }
      }
    }
  }
  
  visitNode(ast);
  
  // Deduplicate
  const seen = new Set();
  result.elements = result.elements.filter(el => {
    const key = `${el.type}:${el.name}:${el.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // Compute counts from deduplicated elements
  result.totalElements = result.elements.length + (result.moduleDoc ? 1 : 0);
  result.documentedElements = result.elements.filter(el => el.hasDoc).length + (result.moduleDoc ? 1 : 0);
  result.adequateElements = result.elements.filter(el => el.hasDoc && (el.docQuality === 'good' || el.docQuality === 'partial')).length + (result.moduleDoc ? 1 : 0);
  result.publicTotal = result.elements.filter(el => el.visibility === 'public').length;
  result.publicDocumented = result.elements.filter(el => el.visibility === 'public' && el.hasDoc).length;
  
  return result;
}

/**
 * Recursively collects JS files from a directory tree.
 *
 * @param {string} dir - Root directory.
 * @param {string[]} [fileList=[]] - Accumulator for file paths.
 * @returns {string[]} List of absolute JS file paths.
 */
function walkDir(dir, fileList = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!shouldExclude(full)) walkDir(full, fileList);
    } else if (item.endsWith('.js') && !shouldExclude(full)) {
      fileList.push(full);
    }
  }
  return fileList;
}

const files = walkDir(REPO_ROOT);
console.log(`Found ${files.length} JS files to analyze`);

const results = [];
const parseFailures = [];
let totalFiles = 0;
let filesWithDoc = 0;
let totalElements = 0;
let totalDocumented = 0;
let totalAdequate = 0;
let totalPublic = 0;
let totalPublicDoc = 0;
let totalInternal = 0;
let totalInternalDoc = 0;

const dirStats = {};
const fileStats = {};
const missingSymbols = [];

for (const file of files) {
  const result = analyzeFile(file);
  if (!result) continue;
  
  if (result.parseError) {
    parseFailures.push({ file: result.file, error: result.parseError });
  }
  
  totalFiles++;
  if (result.documentedElements > 0 || result.moduleDoc) filesWithDoc++;
  
  totalElements += result.totalElements;
  totalDocumented += result.documentedElements;
  totalAdequate += result.adequateElements;
  totalPublic += result.publicTotal;
  totalPublicDoc += result.publicDocumented;
  
  const internalTotal = result.totalElements - result.publicTotal;
  const internalDoc = result.documentedElements - result.publicDocumented;
  totalInternal += internalTotal;
  totalInternalDoc += internalDoc;
  
  for (const el of result.elements) {
    if (!el.hasDoc) {
      missingSymbols.push({
        file: result.file,
        line: el.line,
        name: el.name,
        type: el.type,
        visibility: el.visibility,
        parent: el.parent || null,
        category: result.category,
        priority: el.visibility === 'public' ? 'CRITICAL' : (result.category === 'production' ? 'HIGH' : 'MEDIUM'),
      });
    }
  }
  
  const dirName = path.dirname(result.file).replace(/\\/g, '/');
  if (!dirStats[dirName]) {
    dirStats[dirName] = { files: 0, elements: 0, documented: 0, publicTotal: 0, publicDoc: 0 };
  }
  dirStats[dirName].files++;
  dirStats[dirName].elements += result.totalElements;
  dirStats[dirName].documented += result.documentedElements;
  dirStats[dirName].publicTotal += result.publicTotal;
  dirStats[dirName].publicDoc += result.publicDocumented;
  
  fileStats[result.file] = {
    category: result.category,
    totalElements: result.totalElements,
    documented: result.documentedElements,
    adequate: result.adequateElements,
    publicTotal: result.publicTotal,
    publicDocumented: result.publicDocumented,
    moduleDoc: !!result.moduleDoc,
    parseError: result.parseError || null,
  };
  
  results.push(result);
}

const overallCoverage = totalElements > 0 ? (totalDocumented / totalElements * 100) : 0;
const publicCoverage = totalPublic > 0 ? (totalPublicDoc / totalPublic * 100) : 0;
const internalCoverage = totalInternal > 0 ? (totalInternalDoc / totalInternal * 100) : 0;
const adequateCoverage = totalElements > 0 ? (totalAdequate / totalElements * 100) : 0;
const missingRate = totalElements > 0 ? ((totalElements - totalDocumented) / totalElements * 100) : 0;

const priorityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
missingSymbols.sort((a, b) => {
  const pa = priorityOrder[a.priority] || 99;
  const pb = priorityOrder[b.priority] || 99;
  if (pa !== pb) return pa - pb;
  return a.file.localeCompare(b.file) || a.line - b.line;
});

const report = {
  generatedAt: new Date().toISOString(),
  repository: REPO_ROOT,
  summary: {
    totalFiles,
    filesWithDocumentation: filesWithDoc,
    totalElements,
    documentedElements: totalDocumented,
    adequateElements: totalAdequate,
    missingElements: totalElements - totalDocumented,
    overallCoveragePercent: Math.round(overallCoverage * 10) / 10,
    publicApiTotal: totalPublic,
    publicApiDocumented: totalPublicDoc,
    publicApiCoveragePercent: Math.round(publicCoverage * 10) / 10,
    internalTotal: totalInternal,
    internalDocumented: totalInternalDoc,
    internalCoveragePercent: Math.round(internalCoverage * 10) / 10,
    adequateCoveragePercent: Math.round(adequateCoverage * 10) / 10,
    missingRatePercent: Math.round(missingRate * 10) / 10,
    criticalMissing: missingSymbols.filter(s => s.priority === 'CRITICAL').length,
    highMissing: missingSymbols.filter(s => s.priority === 'HIGH').length,
    mediumMissing: missingSymbols.filter(s => s.priority === 'MEDIUM').length,
    lowMissing: missingSymbols.filter(s => s.priority === 'LOW').length,
  },
  byDirectory: {},
  byFile: {},
  missingSymbols: missingSymbols,
  analysisLimitations: [
    'Analyzes JavaScript CommonJS modules using AST parsing via @babel/parser.',
    'Public API detection based on module.exports patterns; may miss dynamic exports.',
    'Documentation quality assessment is heuristic-based.',
    'Minified/third-party files excluded.',
    `Parse failures: ${parseFailures.length} files could not be parsed.`,
  ],
  parseFailures,
};

for (const [dir, stats] of Object.entries(dirStats)) {
  report.byDirectory[dir] = {
    files: stats.files,
    totalElements: stats.elements,
    documented: stats.documented,
    coveragePercent: stats.elements > 0 ? Math.round(stats.documented / stats.elements * 1000) / 10 : 0,
    publicTotal: stats.publicTotal,
    publicDocumented: stats.publicDoc,
    publicCoveragePercent: stats.publicTotal > 0 ? Math.round(stats.publicDoc / stats.publicTotal * 1000) / 10 : 0,
  };
}

for (const [file, stats] of Object.entries(fileStats)) {
  report.byFile[file] = {
    ...stats,
    coveragePercent: stats.totalElements > 0 ? Math.round(stats.documented / stats.totalElements * 1000) / 10 : 0,
    publicCoveragePercent: stats.publicTotal > 0 ? Math.round(stats.publicDocumented / stats.publicTotal * 1000) / 10 : 0,
  };
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, 'coverage.json'), JSON.stringify(report, null, 2));
console.log(`Wrote coverage.json`);

console.log('\n=== AUDIT SUMMARY ===');
console.log(`Total files analyzed: ${totalFiles}`);
console.log(`Files with documentation: ${filesWithDoc}`);
console.log(`Total documentable elements: ${totalElements}`);
console.log(`Documented: ${totalDocumented} (${overallCoverage.toFixed(1)}%)`);
console.log(`Adequately documented: ${totalAdequate} (${adequateCoverage.toFixed(1)}%)`);
console.log(`Missing: ${totalElements - totalDocumented} (${missingRate.toFixed(1)}%)`);
console.log(`\nPublic API: ${totalPublicDoc}/${totalPublic} (${publicCoverage.toFixed(1)}%)`);
console.log(`Internal: ${totalInternalDoc}/${totalInternal} (${internalCoverage.toFixed(1)}%)`);
console.log(`\nCritical missing: ${report.summary.criticalMissing}`);
console.log(`High missing: ${report.summary.highMissing}`);
console.log(`Medium missing: ${report.summary.mediumMissing}`);
console.log(`Low missing: ${report.summary.lowMissing}`);
console.log(`\nParse failures: ${parseFailures.length}`);

fs.writeFileSync(path.join(OUTPUT_DIR, 'missing-symbols.txt'), 
  missingSymbols.map(s => `${s.file}:${s.line} | ${s.name} | ${s.type} | ${s.visibility} | parent=${s.parent || 'n/a'} | ${s.priority}`).join('\n')
);
console.log(`Wrote missing-symbols.txt with ${missingSymbols.length} entries`);

process.exit(0);
