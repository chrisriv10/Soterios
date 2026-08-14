'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const viewer = require('../src/tools/processViewer');
const { makeRisk } = require('../src/security/riskEngine');

const baseProc = {
  name: 'powershell.exe',
  path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  cmd: 'powershell.exe -w hidden'
};

describe('processViewer processSignals lineage checks', () => {
  it('flags a script host launched directly by an Office or PDF app', () => {
    const signals = viewer.processSignals(baseProc, false, 'WINWORD.EXE');
    const hit = signals.find((s) => /execution chain/i.test(s.message));
    assert.ok(hit, 'lineage signal present');
    assert.equal(hit.points, 55);
  });

  it('covers all Office/PDF parents and script-host children', () => {
    const parents = ['winword.exe', 'excel.exe', 'powerpnt.exe', 'outlook.exe', 'mspub.exe', 'visio.exe', 'acrord32.exe', 'acrobat.exe', 'foxitreader.exe'];
    const hosts = ['cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe', 'regsvr32.exe', 'rundll32.exe', 'certutil.exe', 'bitsadmin.exe'];
    for (const parent of parents) {
      for (const child of hosts) {
        const signals = viewer.processSignals({ ...baseProc, name: child }, false, parent);
        assert.ok(signals.some((s) => /execution chain/i.test(s.message)), `${parent} -> ${child}`);
      }
    }
  });

  it('does not flag a script host launched by an ordinary parent', () => {
    const signals = viewer.processSignals(baseProc, false, 'explorer.exe');
    assert.equal(signals.some((s) => /execution chain/i.test(s.message)), false);
  });

  it('does not flag a non-script-host child of an Office app', () => {
    const signals = viewer.processSignals({ ...baseProc, name: 'notepad.exe' }, false, 'winword.exe');
    assert.equal(signals.some((s) => /execution chain/i.test(s.message)), false);
  });

  it('does not flag when the parent could not be resolved', () => {
    const signals = viewer.processSignals(baseProc, false, null);
    assert.equal(signals.some((s) => /execution chain/i.test(s.message)), false);
  });

  it('raises lineage hits to medium risk', () => {
    const risk = makeRisk(viewer.processSignals(baseProc, false, 'WINWORD.EXE'));
    assert.equal(risk.level, 'medium');
    assert.ok(risk.score >= 55);
  });
});

describe('processViewer processSignals svchost integrity', () => {
  const svchost = {
    name: 'svchost.exe',
    path: 'C:\\Windows\\System32\\svchost.exe',
    cmd: 'C:\\Windows\\System32\\svchost.exe'
  };

  it('flags svchost.exe whose parent is not services.exe', () => {
    const signals = viewer.processSignals(svchost, false, 'explorer.exe');
    const hit = signals.find((s) => /process hollowing/i.test(s.message));
    assert.ok(hit, 'hollowing signal present');
    assert.equal(hit.points, 50);
  });

  it('does not flag svchost.exe under services.exe', () => {
    const signals = viewer.processSignals(svchost, false, 'services.exe');
    assert.equal(signals.some((s) => /process hollowing/i.test(s.message)), false);
  });

  it('does not flag svchost.exe with case-variant parent names', () => {
    const signals = viewer.processSignals(svchost, false, 'SERVICES.EXE');
    assert.equal(signals.some((s) => /process hollowing/i.test(s.message)), false);
  });

  it('does not flag svchost.exe when the parent could not be resolved', () => {
    const signals = viewer.processSignals(svchost, false, null);
    assert.equal(signals.some((s) => /process hollowing/i.test(s.message)), false);
  });

  it('does not flag other protected system names with unexpected parents', () => {
    for (const name of ['lsass.exe', 'explorer.exe', 'winlogon.exe', 'csrss.exe']) {
      const signals = viewer.processSignals({ ...svchost, name }, false, 'notepad.exe');
      assert.equal(signals.some((s) => /process hollowing/i.test(s.message)), false, name);
    }
  });
});

describe('processViewer processSignals trust gate', () => {
  it('returns no signals for trusted processes even with suspicious lineage', () => {
    const signals = viewer.processSignals(baseProc, true, 'WINWORD.EXE');
    assert.equal(signals.length, 0);
  });
});
