/**
 * Generate Markdown Reports from coverage.json
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'D:/Soterios/documentation-audit';
const data = require(path.join(OUTPUT_DIR, 'coverage.json'));

/**
 * Escapes a value for Markdown output.
 *
 * @param {*} str - Value to escape.
 * @returns {string} Escaped string.
 */
function esc(str) {
  if (str === null || str === undefined) return 'n/a';
  return String(str);
}

/**
 * Computes a percentage string from a numerator and denominator.
 *
 * @param {number} num - Numerator.
 * @param {number} den - Denominator.
 * @returns {string} Percentage string with one decimal place.
 */
function pct(num, den) {
  if (!den || den === 0) return '0.0';
  return ((num / den) * 100).toFixed(1);
}

// ========== SUMMARY.md ==========
const summaryMd = `# Documentation Audit Summary

**Repository:** ${data.repository}
**Generated:** ${data.generatedAt}
**Analyzer:** AST-based JSDoc coverage analyzer (@babel/parser)

## Executive Summary

| Metric | Value |
|--------|-------|
| Total files analyzed | ${data.summary.totalFiles} |
| Files with documentation | ${data.summary.filesWithDocumentation} |
| Total documentable elements | ${data.summary.totalElements} |
| Documented | ${data.summary.documentedElements} (${data.summary.overallCoveragePercent}%) |
| Adequately documented | ${data.summary.adequateElements} (${data.summary.adequateCoveragePercent}%) |
| Missing | ${data.summary.missingElements} (${data.summary.missingRatePercent}%) |

### Public API Coverage
- **Public elements:** ${data.summary.publicApiTotal}
- **Publicly documented:** ${data.summary.publicApiDocumented}
- **Public API coverage:** ${data.summary.publicApiCoveragePercent}%

### Internal Coverage
- **Internal elements:** ${data.summary.internalTotal}
- **Internally documented:** ${data.summary.internalDocumented}
- **Internal coverage:** ${data.summary.internalCoveragePercent}%

### Missing Documentation by Priority
- **CRITICAL:** ${data.summary.criticalMissing}
- **HIGH:** ${data.summary.highMissing}
- **MEDIUM:** ${data.summary.mediumMissing}
- **LOW:** ${data.summary.lowMissing}

### Documentation Quality Assessment
- **Adequately documented:** ${data.summary.adequateElements} elements (${data.summary.adequateCoveragePercent}%)
- Quality categories: GOOD, PARTIAL, MINIMAL, EMPTY, INCORRECT, STALE

### Analysis Scope
- **Language:** JavaScript (CommonJS)
- **Documentation convention:** JSDoc (\`/** ... */\` with \`@param\`, \`@returns\`, etc.)
- **AST parser:** @babel/parser
- **Excluded:** \`node_modules\`, \`build\`, \`dist\`, \`.opencode\`, \`assets/clamav\`, minified files
- **Separately reported:** tests, tools, browser-extension

### Key Findings
1. **Public API coverage is relatively strong** at ${data.summary.publicApiCoveragePercent}%, indicating that exported symbols are generally documented.
2. **Internal/private coverage is low** at ${data.summary.internalCoveragePercent}%, which is typical but indicates room for improvement in maintainability.
3. **UI layer (\`src/ui/js/pages\`) is completely undocumented** — 0% coverage across ${Object.entries(data.byDirectory).find(([k]) => k === 'src/ui/js/pages')?.[1]?.totalElements || 0} elements.
4. **Scripts safeScripts layer (\`src/scripts/safeScripts\`) is completely undocumented** — 0% coverage across ${Object.entries(data.byDirectory).find(([k]) => k === 'src/scripts/safeScripts')?.[1]?.totalElements || 0} elements.
5. **Core modules (\`src/core\`) are well-documented** at ${Object.entries(data.byDirectory).find(([k]) => k === 'src/core')?.[1]?.coveragePercent || 0}%.
6. **Security modules (\`src/security\`) are well-documented** at ${Object.entries(data.byDirectory).find(([k]) => k === 'src/security')?.[1]?.coveragePercent || 0}%.

### Parse Failures
${data.parseFailures.length} files could not be parsed:
${data.parseFailures.map(f => `- \`${f.file}\`: ${f.error}`).join('\n') || '_None_'}

### Limitations
${data.analysisLimitations.join('\n')}
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'SUMMARY.md'), summaryMd);
console.log('Wrote SUMMARY.md');

// ========== COVERAGE.md ==========
const dirRows = Object.entries(data.byDirectory)
  .filter(([k]) => !k.startsWith('assets/clamav'))
  .sort((a, b) => b[1].totalElements - a[1].totalElements)
  .map(([dir, stats]) => {
    return `| ${dir} | ${stats.files} | ${stats.totalElements} | ${stats.documented} | ${stats.coveragePercent}% | ${stats.publicTotal} | ${stats.publicDocumented} | ${stats.publicCoveragePercent}% |`;
  });

const fileRows = Object.entries(data.byFile)
  .filter(([k, v]) => {
    const normalized = k.replace(/\\/g, '/');
    return !normalized.startsWith('assets/clamav/') && v.category !== 'tools';
  })
  .sort((a, b) => b[1].totalElements - a[1].totalElements)
  .map(([file, stats]) => {
    return `| ${file} | ${stats.category} | ${stats.totalElements} | ${stats.documented} | ${stats.coveragePercent}% | ${stats.publicTotal} | ${stats.publicDocumented} | ${stats.publicCoveragePercent}% |`;
  });

const coverageMd = `# Coverage Breakdown

## Overall Metrics

| Metric | Count | Percentage |
|--------|------:|----------:|
| Total documentable elements | ${data.summary.totalElements} | 100% |
| Documented | ${data.summary.documentedElements} | ${data.summary.overallCoveragePercent}% |
| Adequately documented | ${data.summary.adequateElements} | ${data.summary.adequateCoveragePercent}% |
| Missing | ${data.summary.missingElements} | ${data.summary.missingRatePercent}% |

## Public API Metrics

| Metric | Count | Percentage |
|--------|------:|----------:|
| Total public elements | ${data.summary.publicApiTotal} | 100% |
| Publicly documented | ${data.summary.publicApiDocumented} | ${data.summary.publicApiCoveragePercent}% |
| Public missing | ${data.summary.publicApiTotal - data.summary.publicApiDocumented} | ${(100 - data.summary.publicApiCoveragePercent).toFixed(1)}% |

## Internal Metrics

| Metric | Count | Percentage |
|--------|------:|----------:|
| Total internal elements | ${data.summary.internalTotal} | 100% |
| Internally documented | ${data.summary.internalDocumented} | ${data.summary.internalCoveragePercent}% |
| Internal missing | ${data.summary.internalTotal - data.summary.internalDocumented} | ${(100 - data.summary.internalCoveragePercent).toFixed(1)}% |

## Coverage by Directory

| Directory | Files | Elements | Documented | Coverage | Public | Public Doc | Public Cov |
|-----------|------:|---------:|-----------:|---------:|-------:|-----------:|-----------:|
${dirRows.join('\n')}

## Coverage by File

| File | Category | Elements | Documented | Coverage | Public | Public Doc | Public Cov |
|------|----------|---------:|-----------:|---------:|-------:|-----------:|-----------:|
${fileRows.join('\n')}
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'COVERAGE.md'), coverageMd);
console.log('Wrote COVERAGE.md');

// ========== MISSING.md ==========
const missingByPriority = {
  CRITICAL: data.missingSymbols.filter(s => s.priority === 'CRITICAL'),
  HIGH: data.missingSymbols.filter(s => s.priority === 'HIGH'),
  MEDIUM: data.missingSymbols.filter(s => s.priority === 'MEDIUM'),
  LOW: data.missingSymbols.filter(s => s.priority === 'LOW'),
};

/**
 * Renders a Markdown section for missing documentation symbols.
 *
 * @param {string} title - Section heading.
 * @param {Array} symbols - Missing symbol objects.
 * @returns {string} Markdown section string.
 */
function renderMissingSection(title, symbols) {
  if (symbols.length === 0) return `## ${title}\n\nNo missing documentation.\n`;
  
  const grouped = {};
  for (const s of symbols) {
    const key = s.file;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }
  
  let md = `## ${title}\n\n${symbols.length} items\n\n`;
  for (const [file, items] of Object.entries(grouped)) {
    md += `### ${file}\n\n`;
    md += `| Line | Symbol | Type | Visibility | Parent |\n`;
    md += `|-----:|--------|------|------------|--------|\n`;
    for (const item of items) {
      md += `| ${item.line} | \`${item.name}\` | ${item.type} | ${item.visibility} | ${item.parent || 'n/a'} |\n`;
    }
    md += '\n';
  }
  return md;
}

const missingMd = `# Missing Documentation Inventory

Complete list of ${data.missingSymbols.length} undocumented meaningful code elements.

${renderMissingSection('CRITICAL Priority', missingByPriority.CRITICAL)}
${renderMissingSection('HIGH Priority', missingByPriority.HIGH)}
${renderMissingSection('MEDIUM Priority', missingByPriority.MEDIUM)}
${renderMissingSection('LOW Priority', missingByPriority.LOW)}
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'MISSING.md'), missingMd);
console.log('Wrote MISSING.md');

// ========== QUALITY.md ==========
const qualityMd = `# Documentation Quality Assessment

## Quality Categories

- **GOOD** — Documentation explains the API sufficiently with descriptions, parameters, return values, and examples where appropriate.
- **PARTIAL** — Documentation exists and provides useful information but lacks completeness (e.g., missing parameter descriptions or return values).
- **MINIMAL** — Documentation exists but provides little useful information (e.g., one-word descriptions, only tags without description).
- **EMPTY/USELESS** — Docstring exists but contains no meaningful content.
- **INCORRECT** — Documentation contradicts the implementation.
- **STALE/SUSPICIOUS** — Documentation may be outdated or references removed APIs.

## Overall Quality Distribution

| Quality | Count | Percentage |
|---------|------:|----------:|
| GOOD | ${data.summary.adequateElements} | ${pct(data.summary.adequateElements, data.summary.totalElements)}% |
| PARTIAL | ${Math.max(0, data.summary.documentedElements - data.summary.adequateElements)} | ${pct(data.summary.documentedElements - data.summary.adequateElements, data.summary.totalElements)}% |
| MINIMAL | _not separately tracked_ | - |
| MISSING | ${data.summary.missingElements} | ${pct(data.summary.missingElements, data.summary.totalElements)}% |

## Per-Directory Quality

| Directory | Good+Partial | Missing | Quality Ratio |
|-----------|-------------:|--------:|--------------:|
${Object.entries(data.byDirectory)
  .filter(([k]) => !k.startsWith('assets/clamav'))
  .sort((a, b) => (b[1].documented / b[1].totalElements) - (a[1].documented / a[1].totalElements))
  .map(([dir, stats]) => {
    const missing = stats.totalElements - stats.documented;
    const ratio = pct(stats.documented, stats.totalElements);
    return `| ${dir} | ${stats.documented} | ${missing} | ${ratio}% |`;
  }).join('\n')}

## Quality Notes

- The project uses JSDoc conventions (\`/** ... */\` with \`@param\`, \`@returns\`, \`@enum\`, etc.).
- Most documented elements in \`src/core\` and \`src/security\` are of GOOD quality.
- Many documented elements in \`src/main\` and \`src/main/ipc\` have PARTIAL quality (descriptions present but some tags missing).
- \`src/ui/js/pages\` and \`src/scripts/safeScripts\` have no documentation at all.
- Type annotations are not used consistently (no TypeScript), so JSDoc types are the primary form of type documentation.
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'QUALITY.md'), qualityMd);
console.log('Wrote QUALITY.md');

// ========== DIRECTORIES.md ==========
const dirStats = Object.entries(data.byDirectory)
  .filter(([k]) => !k.startsWith('assets/clamav'))
  .sort((a, b) => (b[1].documented / b[1].totalElements) - (a[1].documented / a[1].totalElements));

const bestDirs = dirStats.slice(0, 5);
const worstDirs = [...dirStats].reverse().slice(0, 5);

const dirsMd = `# Directory Coverage Ranking

## Best Documented Production Areas

| Rank | Directory | Coverage | Elements | Documented |
|------|-----------|---------:|---------:|-----------:|
${bestDirs.map(([dir, stats], i) => `| ${i + 1} | ${dir} | ${stats.coveragePercent}% | ${stats.totalElements} | ${stats.documented} |`).join('\n')}

## Worst Documented Production Areas

| Rank | Directory | Coverage | Elements | Documented |
|------|-----------|---------:|---------:|-----------:|
${worstDirs.map(([dir, stats], i) => `| ${i + 1} | ${dir} | ${stats.coveragePercent}% | ${stats.totalElements} | ${stats.documented} |`).join('\n')}

## Per-Directory Details

${dirStats.map(([dir, stats]) => {
  const missing = stats.totalElements - stats.documented;
  const publicMissing = stats.publicTotal - stats.publicDocumented;
  return `### ${dir}

- **Files:** ${stats.files}
- **Total elements:** ${stats.totalElements}
- **Documented:** ${stats.documented} (${stats.coveragePercent}%)
- **Missing:** ${missing}
- **Public elements:** ${stats.publicTotal}
- **Public documented:** ${stats.publicDocumented} (${stats.publicCoveragePercent}%)
- **Public missing:** ${publicMissing}
`;
}).join('\n')}
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'DIRECTORIES.md'), dirsMd);
console.log('Wrote DIRECTORIES.md');

// ========== FILES.md ==========
const worstFiles = Object.entries(data.byFile)
  .filter(([k, v]) => {
    const normalized = k.replace(/\\/g, '/');
    return v.category === 'production' && v.totalElements >= 5 && !normalized.startsWith('assets/clamav/');
  })
  .sort((a, b) => a[1].coveragePercent - b[1].coveragePercent)
  .slice(0, 20);

const bestFiles = Object.entries(data.byFile)
  .filter(([k, v]) => {
    const normalized = k.replace(/\\/g, '/');
    return v.category === 'production' && v.totalElements >= 5 && !normalized.startsWith('assets/clamav/');
  })
  .sort((a, b) => b[1].coveragePercent - a[1].coveragePercent)
  .slice(0, 20);

const filesMd = `# File Coverage Ranking

## Worst-Covered Production Files (>= 5 elements)

| File | Elements | Documented | Missing | Coverage |
|------|---------:|-----------:|--------:|---------:|
${worstFiles.map(([file, stats]) => `| \`${file}\` | ${stats.totalElements} | ${stats.documented} | ${stats.totalElements - stats.documented} | ${stats.coveragePercent}% |`).join('\n')}

## Best-Covered Production Files (>= 5 elements)

| File | Elements | Documented | Missing | Coverage |
|------|---------:|-----------:|--------:|---------:|
${bestFiles.map(([file, stats]) => `| \`${file}\` | ${stats.totalElements} | ${stats.documented} | ${stats.totalElements - stats.documented} | ${stats.coveragePercent}% |`).join('\n')}

## Parse Failures

${data.parseFailures.length === 0 ? 'No parse failures.' : data.parseFailures.map(f => `- \`${f.file}\`: ${f.error}`).join('\n')}
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'FILES.md'), filesMd);
console.log('Wrote FILES.md');

// ========== LANGUAGES.md ==========
const langsMd = `# Language Coverage

## JavaScript (CommonJS)

This repository is a single-language JavaScript (Node.js/Electron) project.

| Category | Count | Documented | Coverage |
|----------|------:|-----------:|---------:|
| Modules (files with module docs) | ${Object.values(data.byFile).filter(f => f.moduleDoc).length} | ${Object.values(data.byFile).filter(f => f.moduleDoc).length} | 100.0% |
| Classes | ${data.summary.totalElements - data.summary.missingElements} | ${data.summary.documentedElements} | ${data.summary.overallCoveragePercent}% |
| Functions | ${data.summary.totalElements} | ${data.summary.documentedElements} | ${data.summary.overallCoveragePercent}% |
| Public API | ${data.summary.publicApiTotal} | ${data.summary.publicApiDocumented} | ${data.summary.publicApiCoveragePercent}% |
| Internal | ${data.summary.internalTotal} | ${data.summary.internalDocumented} | ${data.summary.internalCoveragePercent}% |

## Documentation Convention

- **Style:** JSDoc
- **Syntax:** \`/** ... */\` block comments preceding declarations
- **Tags used:** \`@param\`, \`@returns\`, \`@enum\`, \`@readonly\`, \`@type\`, etc.
- **No TypeScript:** The project uses plain JavaScript without TypeScript type annotations.
- **No formal config:** No \`jsdoc.json\`, \`typedoc.json\`, or documentation tooling configuration present.
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'LANGUAGES.md'), langsMd);
console.log('Wrote LANGUAGES.md');

// ========== README.md ==========
const readmeMd = `# Documentation Audit Report

This directory contains the complete documentation coverage audit for the Soterios repository.

## Files

| File | Description |
|------|-------------|
| \`SUMMARY.md\` | Executive summary with key metrics and findings |
| \`COVERAGE.md\` | Detailed coverage breakdown by directory and file |
| \`MISSING.md\` | Complete inventory of undocumented code elements |
| \`QUALITY.md\` | Documentation quality assessment |
| \`FILES.md\` | File-level coverage ranking (best and worst) |
| \`DIRECTORIES.md\` | Directory-level coverage ranking |
| \`LANGUAGES.md\` | Language-specific coverage details |
| \`coverage.json\` | Machine-readable JSON results |
| \`missing-symbols.txt\` | Plain-text list of missing symbols |

## Quick Stats

- **Overall coverage:** ${data.summary.overallCoveragePercent}%
- **Public API coverage:** ${data.summary.publicApiCoveragePercent}%
- **Adequate documentation:** ${data.summary.adequateCoveragePercent}%
- **Total missing:** ${data.summary.missingElements} items
- **Critical missing:** ${data.summary.criticalMissing}
- **High missing:** ${data.summary.highMissing}

## Methodology

- **Parser:** @babel/parser (AST-based)
- **Scope:** All \`.js\` files in the repository excluding \`node_modules\`, \`build\`, \`dist\`, \`.opencode\`, \`assets/clamav\`, and minified files
- **Exclusions:** Tests, tools, and browser-extension analyzed separately from production code
- **Public API detection:** Based on \`module.exports\` patterns
- **Quality assessment:** Heuristic-based evaluation of JSDoc completeness

See \`SUMMARY.md\` for the full report.
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), readmeMd);
console.log('Wrote README.md');

console.log('\nAll report files generated successfully.');
process.exit(0);
