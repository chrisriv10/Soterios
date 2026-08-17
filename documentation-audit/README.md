# Documentation Audit Report

This directory contains the complete documentation coverage audit for the Soterios repository.

## Files

| File | Description |
|------|-------------|
| `SUMMARY.md` | Executive summary with key metrics and findings |
| `COVERAGE.md` | Detailed coverage breakdown by directory and file |
| `MISSING.md` | Complete inventory of undocumented code elements |
| `QUALITY.md` | Documentation quality assessment |
| `FILES.md` | File-level coverage ranking (best and worst) |
| `DIRECTORIES.md` | Directory-level coverage ranking |
| `LANGUAGES.md` | Language-specific coverage details |
| `coverage.json` | Machine-readable JSON results |
| `missing-symbols.txt` | Plain-text list of missing symbols |

## Quick Stats

- **Overall coverage:** 100%
- **Public API coverage:** 100%
- **Adequate documentation:** 94.5%
- **Total missing:** 0 items
- **Critical missing:** 0
- **High missing:** 0

## Methodology

- **Parser:** @babel/parser (AST-based)
- **Scope:** All `.js` files in the repository excluding `node_modules`, `build`, `dist`, `.opencode`, `assets/clamav`, `tests`, `tools`, `browser-extension`, and `.tmp-user-data`
- **Exclusions:** Tests, tools, and browser-extension analyzed separately from production code
- **Public API detection:** Based on `module.exports` patterns and `window.Pages` assignments
- **Quality assessment:** Heuristic-based evaluation of JSDoc completeness

See `SUMMARY.md` for the full report.
