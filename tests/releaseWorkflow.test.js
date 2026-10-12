'use strict';

// Regression coverage for the Windows release/updater-metadata pipeline.
// Covers the validator logic against fixture dist directories plus textual
// invariants of .github/workflows/release.yml. The validator itself runs
// against the real dist/ output during release builds.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { verifyReleaseUpdaterMetadata } = require('../tools/verify-release-updater-metadata');

const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'release.yml');

function workflowText() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8');
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-release-'));
  const installerName = 'Soterios-Setup-9.9.9.exe';
  const installerPath = path.join(dir, installerName);
  const bytes = Buffer.from('fake-installer-bytes-0123456789');
  fs.writeFileSync(installerPath, bytes);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  fs.writeFileSync(`${installerPath}.blockmap`, '<blockmap/>');
  const manifest =
    'version: 9.9.9\n' +
    'files:\n' +
    `  - url: ${installerName}\n` +
    `    sha512: ${sha512}\n` +
    `    size: ${bytes.length}\n` +
    `path: ${installerName}\n` +
    `sha512: ${sha512}\n` +
    "releaseDate: '2026-01-01T00:00:00.000Z'\n";
  fs.writeFileSync(path.join(dir, 'latest.yml'), manifest);
  return { dir, installerName, bytes, sha512 };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('release updater metadata validator', () => {
  it('accepts a corresponding installer and metadata set', () => {
    const fixture = makeFixture();
    try {
      const result = verifyReleaseUpdaterMetadata({ distDir: fixture.dir, packageVersion: '9.9.9' });
      assert.equal(result.ok, true);
      assert.equal(result.version, '9.9.9');
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0].file, fixture.installerName);
    } finally {
      cleanup(fixture.dir);
    }
  });

  it('fails when latest.yml is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soterios-release-'));
    try {
      assert.throws(() => verifyReleaseUpdaterMetadata({ distDir: dir, packageVersion: '9.9.9' }), /latest\.yml is missing/);
    } finally {
      cleanup(dir);
    }
  });

  it('fails on version, size, hash, and filename mismatches', () => {
    const fixture = makeFixture();
    try {
      const manifestPath = path.join(fixture.dir, 'latest.yml');
      const original = fs.readFileSync(manifestPath, 'utf8');
      assert.throws(
        () => verifyReleaseUpdaterMetadata({ distDir: fixture.dir, packageVersion: '9.9.8' }),
        /does not match package version/
      );
      fs.writeFileSync(manifestPath, original.replace(`size: ${fixture.bytes.length}`, 'size: 1'));
      assert.throws(() => verifyReleaseUpdaterMetadata({ distDir: fixture.dir, packageVersion: '9.9.9' }), /size/);
      fs.writeFileSync(manifestPath, original.split(fixture.installerName).join('Soterios-Setup-9.9.9-RENAMED.exe'));
      assert.throws(() => verifyReleaseUpdaterMetadata({ distDir: fixture.dir, packageVersion: '9.9.9' }), /missing installer/);
      fs.writeFileSync(manifestPath, original.replace(fixture.sha512, 'A'.repeat(88)));
      assert.throws(() => verifyReleaseUpdaterMetadata({ distDir: fixture.dir, packageVersion: '9.9.9' }), /sha512/);
    } finally {
      cleanup(fixture.dir);
    }
  });

  it('fails when the required blockmap is missing', () => {
    const fixture = makeFixture();
    try {
      fs.rmSync(path.join(fixture.dir, `${fixture.installerName}.blockmap`));
      assert.throws(() => verifyReleaseUpdaterMetadata({ distDir: fixture.dir, packageVersion: '9.9.9' }), /blockmap/);
    } finally {
      cleanup(fixture.dir);
    }
  });

  it('fails on malformed and truncated metadata instead of passing', () => {
    const fixture = makeFixture();
    try {
      const manifestPath = path.join(fixture.dir, 'latest.yml');
      fs.writeFileSync(manifestPath, 'version: 9.9.9\nfiles: []\nnot yaml at all {{{');
      assert.throws(() => verifyReleaseUpdaterMetadata({ distDir: fixture.dir, packageVersion: '9.9.9' }), /latest\.yml/);
      fs.writeFileSync(manifestPath, 'version: 9.9.9\nfiles:\n');
      assert.throws(() => verifyReleaseUpdaterMetadata({ distDir: fixture.dir, packageVersion: '9.9.9' }), /latest\.yml|no installer|lists no/);
    } finally {
      cleanup(fixture.dir);
    }
  });
});

describe('release workflow updater invariants', () => {
  it('publishes latest.yml and blockmaps in both the workflow artifact and the GitHub Release', () => {
    const text = workflowText();
    const uploadIndex = text.indexOf('Upload installer artifact');
    assert.ok(uploadIndex >= 0, 'upload step must exist');
    const uploadSection = text.slice(uploadIndex, uploadIndex + 1200);
    assert.ok(uploadSection.includes('dist/latest.yml'), 'artifact upload must include latest.yml');
    assert.ok(uploadSection.includes('dist/*.blockmap'), 'artifact upload must include blockmaps');
    const releaseIndex = text.indexOf('gh release create');
    assert.ok(releaseIndex >= 0, 'release creation must exist');
    const releaseSection = text.slice(releaseIndex, releaseIndex + 1200);
    assert.ok(releaseSection.includes('dist/latest.yml'), 'GitHub Release must include latest.yml');
    assert.ok(releaseSection.includes('dist/*.blockmap'), 'GitHub Release must include blockmaps');
    assert.ok(releaseSection.includes('--verify-tag'), 'release creation must verify the tag');
  });

  it('validates updater metadata after the build and before any upload', () => {
    const text = workflowText();
    const validatorIndex = text.indexOf('verify-release-updater-metadata');
    const uploadIndex = text.indexOf('Upload installer artifact');
    const buildIndex = text.indexOf('npm run dist:win');
    assert.ok(validatorIndex > buildIndex, 'validation must run after the Windows build');
    assert.ok(uploadIndex > validatorIndex, 'upload must run after validation');
  });

  it('guards tag/version consistency on the release path without breaking manual builds', () => {
    const text = workflowText();
    const guardIndex = text.indexOf('Verify release tag matches package version');
    assert.ok(guardIndex >= 0, 'tag/version guard step must exist');
    const guardSection = text.slice(guardIndex, guardIndex + 1200);
    assert.ok(guardSection.includes("startsWith(github.ref, 'refs/tags/')"), 'guard must apply to tag runs');
    assert.ok(guardSection.includes('package.json'), 'guard must read the package version');
    assert.ok(guardSection.includes('RELEASE_TAG'), 'guard must compare the actual tag');
    assert.ok(guardSection.includes('exit 1'), 'guard must fail the job on mismatch');
    const releaseIndex = text.indexOf('Create GitHub Release');
    const releaseSection = text.slice(releaseIndex, releaseIndex + 600);
    assert.ok(releaseSection.includes("startsWith(github.ref, 'refs/tags/')"), 'release creation must stay tag-gated');
  });

  it('has no pull_request-triggered publishing path', () => {
    const text = workflowText();
    assert.ok(!text.includes('pull_request'), 'release workflow must not run on pull requests');
  });
});
