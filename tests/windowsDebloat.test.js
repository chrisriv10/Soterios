'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');

const catalog = require('../src/scripts/safeScripts/windowsDebloatCatalog');
const debloat = require('../src/scripts/safeScripts/windowsDebloat');

function appRecord(overrides = {}) {
  return {
    Name: 'Solitaire',
    PackageFullName: 'Microsoft.MicrosoftSolitaireCollection_4.12.3171.0_x64__8wekyb3d8bbwe',
    PackageFamilyName: 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe',
    Version: '4.12.3171.0',
    Publisher: 'CN=Microsoft Corporation',
    Architecture: 'X64',
    InstallLocation: 'C:\\Program Files\\WindowsApps\\Solitaire',
    IsFramework: false,
    IsResourcePackage: false,
    IsBundle: false,
    NonRemovable: false,
    Status: 'Ok',
    ...overrides
  };
}

function discoveryJson(records) {
  const rows = Array.isArray(records) ? records : [records];
  const body = rows.length === 1 ? JSON.stringify(rows[0]) : JSON.stringify(rows);
  return `${body}\n${debloat.DISCOVERY_OK_MARKER}\n`;
}

describe('windowsDebloat catalog', () => {
  it('validates the bundled catalog with unique ids and known levels', () => {
    assert.equal(catalog.validateCatalog(), true);
    const entries = catalog.getCatalog();
    assert.ok(entries.length >= 10);
    assert.ok(entries.some((entry) => entry.recommendation === 'recommended'));
    assert.ok(entries.some((entry) => entry.recommendation === 'optional'));
    assert.ok(entries.some((entry) => entry.recommendation === 'protected'));
  });

  it('rejects duplicate catalog ids', () => {
    const entries = catalog.getCatalog();
    assert.throws(() => catalog.validateCatalog([...entries, { ...entries[0] }]), /duplicate/i);
  });

  it('matches family names case-insensitively and flags protected families', () => {
    assert.equal(catalog.findEntry('microsoft.microsoftsolitairecollection_8wekyb3d8bbwe').recommendation, 'recommended');
    assert.equal(catalog.findEntry('No.Such.Family_x'), null);
    assert.equal(catalog.isProtectedFamily('Microsoft.VCLibs.140.00_8wekyb3d8bbwe'), true);
    assert.equal(catalog.isProtectedFamily('Microsoft.WindowsStore_8wekyb3d8bbwe'), false);
    assert.equal(catalog.isProtectedFamily(null), true);
  });
});

describe('windowsDebloat platform guard', () => {
  let realPlatform;
  beforeEach(() => {
    realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });
  afterEach(() => {
    if (realPlatform) Object.defineProperty(process, 'platform', realPlatform);
  });

  it('returns unsupported off Windows without spawning PowerShell', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    let spawned = 0;
    const realExec = childProcess.execFile;
    childProcess.execFile = () => { spawned += 1; };
    try {
      const result = await debloat({ mode: 'analyze' });
      assert.equal(result.supported, false);
      assert.ok(result.message);
      assert.equal(spawned, 0);
    } finally {
      childProcess.execFile = realExec;
    }
  });
});

describe('windowsDebloat analyze', () => {
  let realExec;
  let realPlatform;
  let spawned;
  let scriptSources;

  beforeEach(() => {
    realExec = childProcess.execFile;
    realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    spawned = 0;
    scriptSources = [];
    childProcess.execFile = (file, args, options, callback) => {
      spawned += 1;
      scriptSources.push({ file, args, options });
      const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
      if (/Get-AppxPackage/.test(script)) {
        callback(null, discoveryJson([
          appRecord(),
          appRecord({
            Name: 'Store', PackageFullName: 'Microsoft.WindowsStore_22501.0.0.0_x64__8wekyb3d8bbwe',
            PackageFamilyName: 'Microsoft.WindowsStore_8wekyb3d8bbwe'
          }),
          appRecord({
            Name: 'VCLibs', PackageFullName: 'Microsoft.VCLibs.140.00_14.0.0.0_x64__8wekyb3d8bbwe',
            PackageFamilyName: 'Microsoft.VCLibs.140.00_8wekyb3d8bbwe', IsFramework: true
          })
        ]), '');
        return {};
      }
      callback(new Error(`unexpected PowerShell invocation: ${script.slice(0, 80)}`), '', '');
      return {};
    };
  });

  afterEach(() => {
    childProcess.execFile = realExec;
    if (realPlatform) Object.defineProperty(process, 'platform', realPlatform);
  });

  it('classifies installed packages without mutating', async () => {
    const result = await debloat({ mode: 'analyze' });
    assert.equal(result.supported, true);
    assert.equal(result.counts.installed, 3);
    assert.equal(result.counts.recommended, 1);
    assert.equal(result.counts.protected, 2);
    const solitaire = result.packages.find((pkg) => pkg.catalogId === 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe');
    assert.equal(solitaire.canRemove, true);
    assert.equal(solitaire.recommendation, 'recommended');
    const store = result.packages.find((pkg) => pkg.catalogId === 'Microsoft.WindowsStore_8wekyb3d8bbwe');
    assert.equal(store.canRemove, false);
    const runtime = result.packages.find((pkg) => pkg.packageFamilyName.includes('VCLibs'));
    assert.equal(runtime.canRemove, false);
    assert.equal(spawned, 1);
  });

  it('treats framework, NonRemovable, and failed-status packages as protected', () => {
    const framework = debloat.classifyPackage(debloat.normalizePackage(appRecord({ IsFramework: true })));
    assert.equal(framework.canRemove, false);
    const resource = debloat.classifyPackage(debloat.normalizePackage(appRecord({ IsResourcePackage: true })));
    assert.equal(resource.canRemove, false);
    const locked = debloat.classifyPackage(debloat.normalizePackage(appRecord({ NonRemovable: true })));
    assert.equal(locked.canRemove, false);
    assert.match(locked.reason, /NonRemovable/);
    const failed = debloat.classifyPackage(debloat.normalizePackage(appRecord({ Status: 'Staged' })));
    assert.equal(failed.canRemove, false);
  });

  it('marks uncataloged packages as not removable with a reason', () => {
    const unknown = debloat.classifyPackage(debloat.normalizePackage(appRecord({
      Name: 'SomethingElse', PackageFullName: 'Contoso.SomethingElse_1.0.0.0_x64__abcdef123456',
      PackageFamilyName: 'Contoso.SomethingElse_abcdef123456'
    })));
    assert.equal(unknown.canRemove, false);
    assert.equal(unknown.recommendation, 'protected');
    assert.equal(unknown.uncataloged, true);
    assert.ok(unknown.reason);
  });

  it('rejects malformed metadata records', () => {
    assert.equal(debloat.normalizePackage(null), null);
    assert.equal(debloat.normalizePackage({ Name: 'NoIdentity' }), null);
  });

  it('blocks removal when safety metadata is missing, even for cataloged families', () => {
    for (const field of ['IsFramework', 'IsResourcePackage', 'IsBundle', 'NonRemovable', 'Status']) {
      const raw = appRecord();
      delete raw[field];
      const verdict = debloat.classifyPackage(debloat.normalizePackage(raw));
      assert.equal(verdict.canRemove, false, `missing ${field} must block removal`);
      assert.equal(verdict.recommendation, 'protected');
      assert.match(verdict.reason, /Incomplete or invalid AppX safety metadata/);
    }
  });

  it('blocks removal for invalid boolean and status metadata shapes', () => {
    for (const overrides of [
      { IsFramework: 1 }, { IsFramework: 'yes' }, { IsFramework: null },
      { IsResourcePackage: 0 }, { NonRemovable: 'false' }, { IsBundle: {} },
      { Status: 42 }, { Status: null }, { Status: '' }, { Status: {} }
    ]) {
      const verdict = debloat.classifyPackage(debloat.normalizePackage(appRecord(overrides)));
      assert.equal(verdict.canRemove, false, `must block removal for ${JSON.stringify(overrides)}`);
      assert.match(verdict.reason, /Incomplete or invalid AppX safety metadata/);
    }
  });

  it('treats bundles as explicitly protected', () => {
    const bundled = debloat.classifyPackage(debloat.normalizePackage(appRecord({ IsBundle: true })));
    assert.equal(bundled.canRemove, false);
    assert.equal(bundled.recommendation, 'protected');
    assert.match(bundled.reason, /Bundle/);
  });

  it('treats duplicate installed family identities as ambiguous and protected', () => {
    const first = debloat.normalizePackage(appRecord());
    const second = debloat.normalizePackage(appRecord({
      PackageFullName: 'Microsoft.MicrosoftSolitaireCollection_9.9.9.9_x64__8wekyb3d8bbwe'
    }));
    const ambiguous = new Set([first.packageFamilyName.toLowerCase()]);
    for (const pkg of [first, second]) {
      const verdict = debloat.classifyPackage(pkg, { ambiguousFamilies: ambiguous });
      assert.equal(verdict.canRemove, false);
      assert.equal(verdict.recommendation, 'protected');
      assert.match(verdict.reason, /ambiguous/);
    }
    assert.equal(debloat.classifyPackage(first).canRemove, true);
  });

  it('classifies the media player entries as optional, not recommended', () => {
    assert.equal(catalog.findEntry('Microsoft.ZuneMusic_8wekyb3d8bbwe').recommendation, 'optional');
    assert.match(catalog.findEntry('Microsoft.ZuneMusic_8wekyb3d8bbwe').name, /Windows Media Player/);
    assert.equal(catalog.findEntry('Microsoft.ZuneVideo_8wekyb3d8bbwe').recommendation, 'optional');
    assert.match(catalog.findEntry('Microsoft.ZuneVideo_8wekyb3d8bbwe').name, /Movies & TV/);
  });

  it('uses the current Teams identity and drops the obsolete one', () => {
    assert.equal(catalog.findEntry('MSTeams_8wekyb3d8bbwe').recommendation, 'optional');
    assert.match(catalog.findEntry('MSTeams_8wekyb3d8bbwe').name, /Microsoft Teams/);
    assert.equal(catalog.findEntry('MicrosoftTeams_8wekyb3d8bbwe'), null);
  });

  it('labels the Skype entry as legacy without changing its identity', () => {
    const skype = catalog.findEntry('Microsoft.SkypeApp_8wekyb3d8bbwe');
    assert.match(skype.name, /legacy/i);
    assert.match(skype.description, /[Ll]egacy/);
    assert.equal(skype.recommendation, 'recommended');
  });

  it('keeps PowerShell nulls and missing keys unknown through discovery', async () => {
    const outerExec = childProcess.execFile;
    childProcess.execFile = (file, args, options, callback) => {
      // PowerShell-shaped output: explicit nulls and omitted keys, exactly
      // as ConvertTo-Json would serialize them.
      const raw = {
        Name: 'Solitaire',
        PackageFullName: 'Microsoft.MicrosoftSolitaireCollection_4.12.3171.0_x64__8wekyb3d8bbwe',
        PackageFamilyName: 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe',
        Version: '4.12.3171.0',
        IsFramework: null,
        IsResourcePackage: false,
        IsBundle: false,
        Status: 'Ok'
      };
      callback(null, `${JSON.stringify(raw)}\n${debloat.DISCOVERY_OK_MARKER}\n`, '');
      return {};
    };
    try {
      const result = await debloat({ mode: 'analyze' });
      assert.equal(result.packages.length, 1);
      assert.equal(result.packages[0].canRemove, false);
      assert.match(result.packages[0].reason, /Incomplete or invalid AppX safety metadata/);
    } finally {
      childProcess.execFile = outerExec;
    }
  });

  it('rejects truncated discovery output instead of reporting empty', async () => {
    const outerExec = childProcess.execFile;
    childProcess.execFile = (file, args, options, callback) => {
      callback(null, discoveryJson([appRecord()]).split(`\n${debloat.DISCOVERY_OK_MARKER}`)[0], '');
      return {};
    };
    try {
      await assert.rejects(debloat({ mode: 'analyze' }), /did not complete/);
    } finally {
      childProcess.execFile = outerExec;
    }
  });

  it('returns an empty inventory when PowerShell emits no output', async () => {
    const outerExec = childProcess.execFile;
    childProcess.execFile = (file, args, options, callback) => {
      callback(null, `${debloat.DISCOVERY_OK_MARKER}\n`, '');
      return {};
    };
    try {
      const result = await debloat({ mode: 'analyze' });
      assert.equal(result.supported, true);
      assert.equal(result.counts.installed, 0);
      assert.deepEqual(result.packages, []);
    } finally {
      childProcess.execFile = outerExec;
    }
  });
});

describe('windowsDebloat selection validation', () => {
  it('accepts known removable ids and dedupes deterministically', () => {
    assert.deepEqual(
      debloat.validateSelections(['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe', 'microsoft.microsoftsolitairecollection_8wekyb3d8bbwe'.toUpperCase(), 'Microsoft.YourPhone_8wekyb3d8bbwe']),
      ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe', 'Microsoft.YourPhone_8wekyb3d8bbwe']
    );
  });

  it('rejects arbitrary, unknown, protected, empty, and oversized selections', () => {
    assert.throws(() => debloat.validateSelections(['Microsoft.WindowsStore_8wekyb3d8bbwe; Remove-Item C:\\']), /Unknown package/);
    assert.throws(() => debloat.validateSelections(['No.Such.Family_x']), /Unknown package/);
    assert.throws(() => debloat.validateSelections(['Microsoft.WindowsStore_8wekyb3d8bbwe']), /protected/);
    assert.throws(() => debloat.validateSelections([]), /at least one/);
    assert.throws(() => debloat.validateSelections('not-an-array'), /at least one/);
    assert.throws(() => debloat.validateSelections([null]), /Invalid package selection/);
    assert.throws(() => debloat.validateSelections(new Array(101).fill('Microsoft.People_8wekyb3d8bbwe')), /at most/);
  });

  it('rejects oversized selection ids and full names', () => {
    assert.throws(() => debloat.validateSelections([`Microsoft.People_8wekyb3d8bbwe${'x'.repeat(300)}`]), /Invalid package selection/);
    assert.throws(() => debloat.validateFullName(`Microsoft.SkypeApp_1.0.0.0_x64__8wekyb3d8bbwe${'x'.repeat(600)}`), /unexpected identity/);
  });

  it('rejects unexpected PackageFullName shapes', () => {
    assert.throws(() => debloat.validateFullName('Microsoft.Solitaire; Remove-Item C:\\'), /unexpected identity/);
    assert.throws(() => debloat.validateFullName('just-a-name'), /unexpected identity/);
    assert.equal(
      debloat.validateFullName('Microsoft.MicrosoftSolitaireCollection_4.12.3171.0_x64__8wekyb3d8bbwe'),
      'Microsoft.MicrosoftSolitaireCollection_4.12.3171.0_x64__8wekyb3d8bbwe'
    );
  });
});

describe('windowsDebloat PowerShell safety', () => {
  it('uses fixed encoded scripts with no shell and no AllUsers/provisioning surface', () => {
    for (const script of [debloat.DISCOVERY_SCRIPT, debloat.REMOVAL_SCRIPT]) {
      const launch = debloat.launchFor(script);
      assert.equal(launch.file, 'powershell.exe');
      assert.deepEqual(launch.args.slice(0, 2), ['-NoProfile', '-NonInteractive']);
      assert.ok(launch.args.includes('-EncodedCommand'));
      assert.ok(!/-AllUsers/.test(script));
      assert.ok(!/Remove-AppxProvisionedPackage/.test(script));
      assert.ok(!/Remove-AppxPackage.*\*|\*/.test(script.replace('Remove-AppxPackage', '')));
    }
    assert.ok(!/Remove-AppxPackage/.test(debloat.DISCOVERY_SCRIPT));
    assert.match(debloat.REMOVAL_SCRIPT, /\$env:SOTERIOS_DEBLOAT_FULLNAME/);
  });
});

describe('windowsDebloat remove flow', () => {
  let realExec;
  let realPlatform;
  const removedFullNames = [];
  const metadataOverrides = {};
  let discoveryCalls = 0;
  let removalCalls = 0;

  const SOLITAIRE = appRecord();
  const SKYPE = appRecord({
    Name: 'Skype', PackageFullName: 'Microsoft.SkypeApp_15.100.0.0_x64__8wekyb3d8bbwe',
    PackageFamilyName: 'Microsoft.SkypeApp_8wekyb3d8bbwe'
  });

  beforeEach(() => {
    realExec = childProcess.execFile;
    realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    removedFullNames.length = 0;
    for (const key of Object.keys(metadataOverrides)) delete metadataOverrides[key];
    discoveryCalls = 0;
    removalCalls = 0;
    childProcess.execFile = (file, args, options, callback) => {
      const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
      if (/Get-AppxPackage/.test(script)) {
        discoveryCalls += 1;
        const live = [SOLITAIRE, SKYPE]
          .filter((app) => !removedFullNames.includes(app.PackageFullName))
          .map((app) => ({ ...app, ...(metadataOverrides[app.PackageFamilyName] || {}) }));
        callback(null, discoveryJson(live.length ? live : []), '');
        return {};
      }
      if (/Remove-AppxPackage/.test(script)) {
        removalCalls += 1;
        const fullName = options.env[debloat.FULLNAME_ENV_VAR];
        assert.ok(fullName && !/[;*"']/.test(fullName), 'package value travels as data');
        if (fullName === SKYPE.PackageFullName) {
          callback(new Error('Deployment failed'), '', 'error 0x80073CF6');
          return {};
        }
        removedFullNames.push(fullName);
        callback(null, 'SOTERIOS_DEBLOAT_REMOVED', '');
        return {};
      }
      callback(new Error('unexpected invocation'), '', '');
      return {};
    };
  });

  afterEach(() => {
    childProcess.execFile = realExec;
    if (realPlatform) Object.defineProperty(process, 'platform', realPlatform);
  });

  it('requires explicit confirmation', async () => {
    await assert.rejects(
      debloat({ mode: 'remove', selections: ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'] }),
      /explicit confirmation/
    );
  });

  it('removes, reports a sibling failure, and verifies with rescan', async () => {
    const result = await debloat({
      mode: 'remove',
      confirmed: true,
      selections: ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe', 'Microsoft.SkypeApp_8wekyb3d8bbwe'],
      preview: { 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe': SOLITAIRE.PackageFullName, 'Microsoft.SkypeApp_8wekyb3d8bbwe': SKYPE.PackageFullName }
    });
    assert.equal(result.mode, 'remove');
    assert.deepEqual(result.selected, ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe', 'Microsoft.SkypeApp_8wekyb3d8bbwe']);
    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0].id, 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe');
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, 'Microsoft.SkypeApp_8wekyb3d8bbwe');
    assert.ok(result.failed[0].error);
    assert.equal(result.rescan.removedCount, 1);
    assert.ok(!result.rescan.remaining.includes(SOLITAIRE.PackageFullName));
    assert.ok(discoveryCalls >= 3, 'per-package revalidation plus post-removal rescan');
  });

  it('skips packages that vanished or changed since preview', async () => {
    removedFullNames.push(SOLITAIRE.PackageFullName);
    const gone = await debloat({
      mode: 'remove',
      confirmed: true,
      selections: ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'],
      preview: { 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe': SOLITAIRE.PackageFullName }
    });
    assert.equal(gone.removed.length, 0);
    assert.equal(gone.skipped.length, 1);
    assert.match(gone.skipped[0].reason, /no longer installed/);

    const changed = await debloat({
      mode: 'remove',
      confirmed: true,
      selections: ['Microsoft.SkypeApp_8wekyb3d8bbwe'],
      preview: { 'Microsoft.SkypeApp_8wekyb3d8bbwe': 'Microsoft.SkypeApp_0.0.0.0_x64__8wekyb3d8bbwe' }
    });
    assert.equal(changed.removed.length, 0);
    assert.match(changed.skipped[0].reason, /changed since preview/);
  });

  it('skips packages that became protected before removal', async () => {
    metadataOverrides['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'] = { NonRemovable: true };
    const result = await debloat({
      mode: 'remove',
      confirmed: true,
      selections: ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'],
      preview: { 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe': SOLITAIRE.PackageFullName }
    });
    assert.equal(result.removed.length, 0);
    assert.equal(result.failed.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /NonRemovable/);
  });

  it('never invokes removal when metadata turns NonRemovable after preview', async () => {
    const preview = await debloat({ mode: 'analyze' });
    const solitaire = preview.packages.find((pkg) => pkg.catalogId === 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe');
    assert.equal(solitaire.canRemove, true, 'removable during the initial state');
    metadataOverrides['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'] = { NonRemovable: true };
    const result = await debloat({
      mode: 'remove',
      confirmed: true,
      selections: ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'],
      preview: { 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe': SOLITAIRE.PackageFullName }
    });
    assert.equal(result.removed.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /NonRemovable/);
    assert.equal(removalCalls, 0, 'Remove-AppxPackage must never run after the transition');
  });

  it('never invokes removal when metadata turns bundled after preview', async () => {
    metadataOverrides['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'] = { IsBundle: true };
    const result = await debloat({
      mode: 'remove',
      confirmed: true,
      selections: ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'],
      preview: { 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe': SOLITAIRE.PackageFullName }
    });
    assert.equal(result.removed.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /Bundle/);
    assert.equal(removalCalls, 0, 'Remove-AppxPackage must never run after the transition');
  });

  it('revalidates each package independently between sibling removals', async () => {
    const outerExec = childProcess.execFile;
    const SOL = appRecord();
    const SKY = appRecord({
      Name: 'Skype', PackageFullName: 'Microsoft.SkypeApp_15.100.0.0_x64__8wekyb3d8bbwe',
      PackageFamilyName: 'Microsoft.SkypeApp_8wekyb3d8bbwe'
    });
    let removalsSeen = 0;
    const goneFullNames = [];
    childProcess.execFile = (file, args, options, callback) => {
      const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
      if (/Get-AppxPackage/.test(script)) {
        const live = [SOL, SKY]
          .filter((app) => !goneFullNames.includes(app.PackageFullName))
          .map((app) => {
          // External change lands while the first removal executes: the
          // second package becomes NonRemovable before its own gating.
          if (app.PackageFamilyName === SKY.PackageFamilyName && removalsSeen > 0) {
            return { ...app, NonRemovable: true };
          }
          return { ...app };
        });
        callback(null, discoveryJson(live), '');
        return {};
      }
      if (/Remove-AppxPackage/.test(script)) {
        removalsSeen += 1;
        goneFullNames.push(options.env[debloat.FULLNAME_ENV_VAR]);
        callback(null, 'SOTERIOS_DEBLOAT_REMOVED', '');
        return {};
      }
      callback(new Error('unexpected invocation'), '', '');
      return {};
    };
    try {
      const result = await debloat({
        mode: 'remove',
        confirmed: true,
        selections: [
          'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe',
          'Microsoft.SkypeApp_8wekyb3d8bbwe'
        ],
        preview: {
          'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe': SOL.PackageFullName,
          'Microsoft.SkypeApp_8wekyb3d8bbwe': SKY.PackageFullName
        }
      });
      assert.equal(result.removed.length, 1);
      assert.equal(result.removed[0].id, 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe');
      assert.equal(result.skipped.length, 1);
      assert.equal(result.skipped[0].id, 'Microsoft.SkypeApp_8wekyb3d8bbwe');
      assert.match(result.skipped[0].reason, /NonRemovable/);
      assert.equal(removalsSeen, 1, 'only the still-removable package reaches Remove-AppxPackage');
    } finally {
      childProcess.execFile = outerExec;
    }
  });

  it('requires a valid preview identity for every selected package', async () => {
    const id = 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe';
    const cases = [
      ['no preview object', undefined],
      ['empty preview', {}],
      ['missing entry', { 'Microsoft.SkypeApp_8wekyb3d8bbwe': 'Microsoft.SkypeApp_15.100.0.0_x64__8wekyb3d8bbwe' }],
      ['non-string entry', { [id]: 42 }],
      ['empty-string entry', { [id]: '' }],
      ['differently keyed entry', { [id.toLowerCase()]: SOLITAIRE.PackageFullName }]
    ];
    for (const [name, preview] of cases) {
      const args = { mode: 'remove', confirmed: true, selections: [id] };
      if (preview !== undefined) args.preview = preview;
      const result = await debloat(args);
      assert.equal(result.removed.length, 0, name);
      assert.equal(result.skipped.length, 1, name);
      assert.match(result.skipped[0].reason, /preview identity/, name);
    }
    assert.equal(removalCalls, 0, 'Remove-AppxPackage must never run without a valid preview');
  });

  it('never invokes removal for an ambiguous duplicate family', async () => {
    let removalAttempts = 0;
    const outerExec = childProcess.execFile;
    childProcess.execFile = (file, args, options, callback) => {
      const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
      if (/Remove-AppxPackage/.test(script)) {
        removalAttempts += 1;
        callback(null, 'SOTERIOS_DEBLOAT_REMOVED', '');
        return {};
      }
      if (/Get-AppxPackage/.test(script)) {
        const twin = appRecord({ PackageFullName: 'Microsoft.MicrosoftSolitaireCollection_9.9.9.9_x64__8wekyb3d8bbwe' });
        const other = appRecord({
          Name: 'Skype', PackageFullName: 'Microsoft.SkypeApp_15.100.0.0_x64__8wekyb3d8bbwe',
          PackageFamilyName: 'Microsoft.SkypeApp_8wekyb3d8bbwe'
        });
        const payload = [twin, appRecord(), other].map((row) => JSON.stringify(row)).join(',');
        callback(null, `[${payload}]\n${debloat.DISCOVERY_OK_MARKER}\n`, '');
        return {};
      }
      callback(new Error('unexpected invocation'), '', '');
      return {};
    };
    try {
      const analyze = await debloat({ mode: 'analyze' });
      const solitaire = analyze.packages.filter((pkg) => pkg.catalogId === 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe');
      assert.equal(solitaire.length, 2);
      for (const pkg of solitaire) {
        assert.equal(pkg.canRemove, false);
        assert.match(pkg.reason, /ambiguous/);
      }
      const result = await debloat({
        mode: 'remove',
        confirmed: true,
        selections: ['Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'],
        preview: {}
      });
      assert.equal(result.removed.length, 0);
      assert.equal(result.skipped.length, 1);
      assert.match(result.skipped[0].reason, /share this family/);
      assert.equal(removalAttempts, 0, 'Remove-AppxPackage must never run for an ambiguous family');
    } finally {
      childProcess.execFile = outerExec;
    }
  });
});
