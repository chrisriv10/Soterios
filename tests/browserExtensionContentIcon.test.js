'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'src', 'content.ts'), 'utf8');

describe('browser extension password-field control', () => {
  it('uses the packaged Soterios icon for the idle field control', () => {
    assert.match(contentSource, /icon\.src = chrome\.runtime\.getURL\('icons\/icon32\.png'\)/);
    assert.match(contentSource, /setFieldGlyph\(button, 'S'\)/);
    assert.doesNotMatch(contentSource, /button\.textContent = 'S'/);
  });

  it('centers the password control icon inside its fixed button', () => {
    assert.match(contentSource, /\.field-button\{[^}]*padding:0;[^}]*display:flex;[^}]*align-items:center;[^}]*justify-content:center;[^}]*line-height:0/);
    assert.match(contentSource, /\.field-button img\{[^}]*margin:0;[^}]*object-position:center/);
  });

  it('deduplicates repeated site advisories for the same page and reasons', () => {
    assert.match(contentSource, /let lastSiteNoticeKey = ''/);
    assert.match(contentSource, /function siteNoticeKey\(/);
    assert.match(contentSource, /if \(key === lastSiteNoticeKey\) return/);
    assert.match(contentSource, /lastSiteNoticeKey = ''; dismissNotices\(\)/);
  });

  it('keeps repeated site checks from resending the same desktop advisory', () => {
    const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'src', 'background.ts'), 'utf8');
    assert.match(backgroundSource, /DESKTOP_NOTICE_COOLDOWN_MS = 10 \* 60 \* 1000/);
    assert.match(backgroundSource, /const desktopNoticeTimes = new Map/);
    assert.match(backgroundSource, /if \(desktopNoticeTimes\.has\(key\)\) return/);
  });
});
