'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { RULE_VERSION, assessProcess } = require('../src/security/processRisk');

describe('commercial process risk rules', () => {
  it('reduces only suppressible static evidence for a trusted executable', () => {
    const proc = {
      name: 'utility.exe',
      path: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\utility.exe',
      signature: { status: 'Valid' },
    };
    const untrusted = assessProcess(proc, { trusted: false });
    const trusted = assessProcess(proc, { trusted: true });

    assert.ok(untrusted.score > trusted.score);
    assert.equal(trusted.evidence[0].trustReduced, true);
    assert.ok(trusted.score > 0, 'trust is evidence, not a blanket bypass');
  });

  it('never suppresses critical identity or signature findings', () => {
    const result = assessProcess({
      name: 'lsass.exe',
      path: 'C:\\Users\\Public\\lsass.exe',
      signature: { status: 'HashMismatch' },
    }, { parentName: 'explorer.exe', trusted: true });

    assert.equal(result.severity, 'high-concern');
    assert.ok(result.score >= 70);
    assert.ok(result.evidence.some((item) => item.id === 'system-process-path-mismatch' && !item.trustReduced));
    assert.ok(result.evidence.some((item) => item.id === 'invalid-signature' && !item.trustReduced));
  });

  it('reports explainable, versioned results without claiming a process is safe', () => {
    const result = assessProcess({
      name: 'notepad.exe',
      path: 'C:\\Windows\\System32\\notepad.exe',
      signature: { status: 'Valid' },
    });

    assert.equal(result.ruleVersion, RULE_VERSION);
    assert.equal(result.statusLabel, 'No concerns detected');
    assert.equal(/\bsafe\b/i.test(result.statusLabel), false);
    assert.ok(Number.isFinite(Date.parse(result.evaluatedAt)));
  });

  it('keeps high-confidence lineage findings even when the child is trusted', () => {
    const result = assessProcess({
      name: 'powershell.exe',
      path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      commandLine: 'powershell.exe -EncodedCommand ZQB2AGkAbAA=',
    }, { parentName: 'WINWORD.EXE', trusted: true });

    assert.ok(result.evidence.some((item) => item.id === 'document-script-chain' && !item.trustReduced));
    assert.ok(result.evidence.some((item) => item.id === 'powershell-obfuscation' && !item.trustReduced));
    assert.equal(result.severity, 'high-concern');
  });
});
