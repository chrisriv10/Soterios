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

  it('keeps the feature cards balanced with emergency lockdown and auto-updates on the left', () => {
    const firstCardTitle = settingsSource.indexOf("t('settings.featureToggles')");
    const secondCardTitle = settingsSource.indexOf("t('settings.featureToggles')", firstCardTitle + 1);
    const updatesTitle = settingsSource.indexOf("t('settings.updates')");
    const leftFeatureCard = settingsSource.slice(firstCardTitle, secondCardTitle);
    const updatesCard = settingsSource.slice(updatesTitle, settingsSource.indexOf("t('settings.about')", updatesTitle));

    assert.ok(leftFeatureCard.includes('id="emergencyLockdownToggle"'));
    assert.ok(leftFeatureCard.includes('id="autoUpdatesToggle"'));
    assert.equal((settingsSource.match(/id="emergencyLockdownToggle"/g) || []).length, 1);
    assert.equal((settingsSource.match(/id="autoUpdatesToggle"/g) || []).length, 1);
    assert.equal(updatesCard.includes('id="autoUpdatesToggle"'), false);
  });

  it('places suspicious network alerts in the Notifications card and keeps its handler', () => {
    assert.equal((settingsSource.match(/id="networkAlertsToggle"/g) || []).length, 1);
    const notificationsTitle = settingsSource.indexOf("t('settings.notifications')");
    const networkToggle = settingsSource.indexOf('id="networkAlertsToggle"');
    assert.ok(notificationsTitle >= 0 && networkToggle > notificationsTitle);
    assert.match(settingsSource, /#networkAlertsToggle'\)\.addEventListener\('change'/);
  });
});
