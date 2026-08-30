'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const settingsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'settings.js'),
  'utf8'
);

describe('settings feature toggle grouping', () => {
  it('uses Feature Toggles for both feature cards', () => {
    assert.equal(
      (settingsSource.match(/<div class="panel-title" style="margin-bottom:16px;">\$\{escapeHtml\(t\('settings\.featureToggles'\)\)\}<\/div>/g) || []).length,
      2,
    );
    assert.equal(settingsSource.includes('Privacy, UI & Connectivity'), false);
  });

  it('places suspicious network alerts in the Notifications card and keeps its handler', () => {
    assert.equal((settingsSource.match(/id="networkAlertsToggle"/g) || []).length, 1);
    const notificationsTitle = settingsSource.indexOf("t('settings.notifications')");
    const networkToggle = settingsSource.indexOf('id="networkAlertsToggle"');
    assert.ok(notificationsTitle >= 0 && networkToggle > notificationsTitle);
    assert.match(settingsSource, /#networkAlertsToggle'\)\.addEventListener\('change'/);
  });
});
