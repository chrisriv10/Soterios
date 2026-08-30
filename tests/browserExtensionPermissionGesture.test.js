'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDist = path.join(__dirname, '..', 'browser-extension', 'dist', 'chromium');

describe('browser extension permission prompts', () => {
  it('starts onboarding permission requests directly from the confirm click', () => {
    const onboarding = fs.readFileSync(path.join(extensionDist, 'onboarding.js'), 'utf8');
    assert.match(onboarding, /getElementById\("confirm"\)\.addEventListener\("click", \(\) =>/);
    assert.doesNotMatch(onboarding, /getElementById\("confirm"\)\.addEventListener\("click", async/);

    const request = onboarding.indexOf('chrome.permissions.request({ origins: requestedOrigins })');
    const disable = onboarding.indexOf('button.disabled = true;', request);
    assert.ok(request >= 0, 'onboarding should request the selected permissions');
    assert.ok(disable > request, 'the request must start before the click target is disabled');
  });

  it('starts the Settings continuous-access request directly from its click', () => {
    const options = fs.readFileSync(path.join(extensionDist, 'options.js'), 'utf8');
    assert.match(options, /getElementById\("grant-continuous"\)\.addEventListener\("click", \(\) =>/);
    assert.doesNotMatch(options, /getElementById\("grant-continuous"\)\.addEventListener\("click", async/);
    assert.ok(options.includes('chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] })'));
  });
});
