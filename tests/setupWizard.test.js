'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const setupSource = read('src', 'ui', 'js', 'pages', 'setup.js');
const routerSource = read('src', 'ui', 'js', 'router.js');
const shellSource = read('src', 'ui', 'pages', 'shell.html');
const styles = read('src', 'ui', 'css', 'style.css');

// --- DOM stub --------------------------------------------------------------

function createHarness() {
  const registry = new Map();
  const listeners = new Map();

  function makeElement(id) {
    const classes = new Set();
    const el = {
      id,
      style: {},
      dataset: {},
      checked: false,
      disabled: false,
      textContent: '',
      value: '',
      _children: [],
      _html: '',
      _attrs: {},
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, force) => {
          const on = force !== undefined ? !!force : !classes.has(c);
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
        contains: (c) => classes.has(c)
      },
      addEventListener(type, fn) {
        listeners.set(id + '|' + type, fn);
      },
      removeEventListener() {},
      setAttribute(name, value) {
        el._attrs[name] = String(value);
      },
      appendChild(child) {
        el._children.push(child);
      },
      querySelector(selector) {
        if (!selector.startsWith('#')) return null;
        const target = selector.slice(1);
        if (!registry.has(target)) registry.set(target, makeElement(target));
        return registry.get(target);
      },
      querySelectorAll() {
        return [];
      },
      focus() {}
    };
    if (id.startsWith('setupThemeCard-')) el.dataset.theme = id.slice('setupThemeCard-'.length);
    if (id.startsWith('setupExtBtn-')) el.dataset.browser = id.slice('setupExtBtn-'.length);
    Object.defineProperty(el, 'innerHTML', {
      get() { return el._html; },
      set(value) {
        el._html = value;
        const re = /id="([^"]+)"/g;
        let match;
        while ((match = re.exec(value))) {
          if (!registry.has(match[1])) registry.set(match[1], makeElement(match[1]));
        }
      }
    });
    return el;
  }

  const container = makeElement('wizardContainer');
  const body = makeElement('body');

  const invokeCalls = [];
  const responses = {};
  const apiInvoke = async (channel, ...args) => {
    invokeCalls.push([channel, ...args]);
    if (responses[channel] !== undefined) {
      return typeof responses[channel] === 'function' ? responses[channel](...args) : responses[channel];
    }
    return {};
  };

  const themeCalls = [];
  const settingsCalls = [];
  const localeCalls = [];
  const ApiStub = {
    getSettings: async () => ({ features: {}, ui: { theme: 'dark' } }),
    applyTheme: (name) => themeCalls.push(name),
    updateSettings: async (patch) => settingsCalls.push(patch)
  };

  const navCalls = [];
  const sandbox = {
    window: {
      Pages: {},
      api: { invoke: apiInvoke },
      I18n: {
        t: (key) => key,
        locale: 'en',
        setLocale: async (code) => {
          localeCalls.push(code);
          sandbox.window.I18n.locale = code;
        }
      },
      AppRouter: { navigate: (page) => navCalls.push(page) },
      AppState: {},
      localStorage: { getItem: () => null, setItem: () => {} }
    },
    document: {
      body,
      documentElement: { setAttribute() {}, style: {} }
    },
    Api: ApiStub,
    console,
    setTimeout: (fn) => { fn(); return 0; }
  };
  vm.runInNewContext(setupSource, sandbox, { filename: 'setup.js' });

  function click(id) {
    const fn = listeners.get(id + '|click');
    assert.ok(fn, `no click listener registered for #${id}`);
    return fn({ target: registry.get(id), currentTarget: registry.get(id) });
  }
  function change(id) {
    const el = registry.get(id);
    const fn = listeners.get(id + '|change');
    assert.ok(fn, `no change listener registered for #${id}`);
    return fn({ target: el, currentTarget: el });
  }
  const STEPS = ['welcome', 'language', 'theme', 'notifications', 'privacy', 'extension', 'scan'];
  function activeStep() {
    for (const step of STEPS) {
      const el = registry.get('setupStep-' + step);
      if (el && el.classList && el.classList.contains('active')) return step;
    }
    return null;
  }
  async function goToStep(step) {
    for (let i = 0; i < 10; i++) {
      if (activeStep() === step) return;
      await click('setupNext');
    }
    throw new Error(`could not reach step ${step}, active=${activeStep()}`);
  }

  return {
    sandbox,
    container,
    body,
    registry,
    invokeCalls,
    settingsCalls,
    themeCalls,
    localeCalls,
    navCalls,
    responses,
    click,
    change,
    activeStep,
    goToStep,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    page: sandbox.window.Pages.setup
  };
}

// --- source-level tests ----------------------------------------------------

describe('first-run setup wizard source', () => {
  it('registers a router page module with render and destroy', () => {
    assert.match(setupSource, /window\.Pages = window\.Pages \|\| \{\};/);
    assert.match(setupSource, /window\.Pages\.setup = \{/);
    assert.match(setupSource, /async render\(container\)/);
    assert.match(setupSource, /destroy\(\)/);
  });

  it('defines all seven wizard steps in order', () => {
    assert.match(setupSource, /'welcome', 'language', 'theme', 'notifications', 'privacy', 'extension', 'scan'/);
  });

  it('shows the logo, welcome heading and subtitle on the first step', () => {
    const welcomeStep = setupSource.slice(setupSource.indexOf("setupStep-welcome"), setupSource.indexOf("setupStep-language"));
    assert.match(welcomeStep, /setup-logo/);
    assert.match(welcomeStep, /\.\.\/\.\.\/\.\.\/assets\/brand-logo\.png/);
    assert.match(welcomeStep, /\.\.\/\.\.\/\.\.\/assets\/brand-wordmark\.png/);
    assert.match(welcomeStep, /setup\.title/);
    assert.match(welcomeStep, /setup\.subtitle/);
    assert.match(welcomeStep, /setup\.skipSetup/);
  });

  it('hides the sidebar only while the wizard is rendered', () => {
    assert.match(setupSource, /document\.body\.classList\.add\('setup-mode'\)/);
    assert.match(setupSource, /document\.body\.classList\.remove\('setup-mode'\)/);
    assert.match(styles, /body\.setup-mode \.sidebar\s*\{\s*display: none;/);
  });

  it('replicates the splash handshake so the splash dismisses on first run', () => {
    assert.match(setupSource, /splash:progress/, 'wizard must emit splash progress');
    assert.match(setupSource, /\{ pct: 85, label: t\('splash\.loadingDashboard'\) \}/);
    assert.match(setupSource, /\{ pct: 90, label: t\('splash\.finalizing'\) \}/);
    assert.match(setupSource, /\{ pct: 100, label: t\('splash\.ready'\) \}/);
    assert.match(setupSource, /await new Promise\(\(resolve\) => setTimeout\(resolve, 300\)\)/);
    assert.match(setupSource, /await window\.api\.invoke\('app:ready'\)/);
  });

  it('completing the wizard persists the setup flag and navigates to the dashboard', () => {
    assert.match(setupSource, /db:setSetting', 'app\.setupComplete', true/);
    assert.match(setupSource, /window\.AppRouter\.navigate\('dashboard'\)/);
  });

  it('delegates each step to existing IPC and settings APIs only', () => {
    assert.match(setupSource, /Api\.applyTheme\(/);
    assert.match(setupSource, /Api\.updateSettings\(\{ ui: \{ theme: this\._theme \} \}\)/);
    assert.match(setupSource, /notificationsEnabled/);
    assert.match(setupSource, /scanNotifications: false/);
    assert.match(setupSource, /privacy:helpers/);
    assert.match(setupSource, /privacy\.snapshot/);
    assert.match(setupSource, /disablePatch/);
    assert.match(setupSource, /privacyMode: true/);
    assert.match(setupSource, /browserExtension:getState/);
    assert.match(setupSource, /browserExtension:install/);
    assert.match(setupSource, /browserExtension:openPage/);
    assert.match(setupSource, /scan:quick/);
    assert.match(setupSource, /i18n:listLocales/);
    assert.match(setupSource, /window\.I18n\.setLocale/);
    assert.match(setupSource, /ui: \{ language: code \}/);
    assert.match(setupSource, /assets\/flags\//);
  });

  it('labels the language step through i18n keys', () => {
    const languageStep = setupSource.slice(setupSource.indexOf("setupStep-language"), setupSource.indexOf("setupStep-theme"));
    assert.match(languageStep, /setup\.languageTitle/);
    assert.match(languageStep, /setup\.languageDesc/);
    assert.match(languageStep, /setupLangGrid/);
    assert.match(setupSource, /setup-lang-card/);
    assert.match(styles, /\.setup-lang-grid/);
    assert.match(styles, /\.setup-lang-flag/);
  });

  it('labels all wizard chrome through i18n keys', () => {
    for (const key of ['setup.title', 'setup.subtitle', 'setup.skip', 'setup.skipSetup', 'setup.back', 'setup.next', 'setup.finish', 'setup.languageTitle', 'setup.languageDesc']) {
      assert.ok(setupSource.includes("'" + key + "'"), `wizard must reference the ${key} i18n key`);
    }
    for (const id of ['setupSkip', 'setupSkipSetup', 'setupBack', 'setupNext', 'setupStep-welcome', 'setupStep-language', 'setupStep-theme', 'setupStep-notifications', 'setupStep-privacy', 'setupStep-extension', 'setupStep-scan']) {
      assert.ok(setupSource.includes('"' + id + '"'), `wizard must define #${id}`);
    }
  });

  it('keeps the skip button reachable from every step and shows Skip setup on step one', () => {
    assert.match(setupSource, /setupSkip/);
    assert.match(setupSource, /skip\.textContent = index === 0 \? t\('setup\.skipSetup'\) : t\('setup\.skip'\)/);
  });

  it('gates first-run routing in router.js only when no explicit hash is present', () => {
    const gate = routerSource.slice(routerSource.indexOf('const hashPage'));
    const gateIdx = gate.indexOf("db:getSetting', 'app.setupComplete'");
    assert.ok(gateIdx !== -1, 'router must check app.setupComplete');
    assert.ok(gate.slice(0, gateIdx).includes('if (!hashPage)'), 'the setup check must only run when there is no hash');
    assert.ok(gate.slice(gateIdx).includes("initialPage = 'setup'"));
    assert.match(routerSource, /let initialPage = isKnownPage\(hashPage\) \? hashPage : 'dashboard';/);
  });

  it('loads the wizard page module before the router in shell.html', () => {
    const scriptIdx = shellSource.indexOf('../js/pages/setup.js');
    const routerIdx = shellSource.indexOf('../js/router.js');
    assert.ok(scriptIdx !== -1, 'shell.html must include setup.js');
    assert.ok(scriptIdx < routerIdx, 'setup.js must load before router.js');
  });

  it('exposes a replay entry point from Settings', () => {
    const settingsSource = read('src', 'ui', 'js', 'pages', 'settings.js');
    assert.match(settingsSource, /id="replaySetupBtn"/);
    assert.match(settingsSource, /settings\.replaySetup/);
    assert.match(settingsSource, /AppRouter\.navigate\('setup'\)/);
  });

  it('styles the wizard layout and theme picker', () => {
    for (const selector of ['.setup-wizard', '.setup-dots', '.setup-logo', '.setup-theme-grid', '.setup-theme-card', '.setup-theme-card.active', '.setup-actions']) {
      assert.ok(styles.includes(selector), `style.css must define ${selector}`);
    }
  });
});

// --- behavior tests --------------------------------------------------------

describe('first-run setup wizard behavior', () => {
  it('shows the wizard with sidebar mode on render and cleans up on destroy', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    assert.ok(h.body.classList.contains('setup-mode'));
    assert.ok(h.invokeCalls.some((c) => c[0] === 'app:ready'), 'wizard must dismiss the splash via app:ready');
    assert.ok(h.invokeCalls.some((c) => c[0] === 'splash:progress' && c[1] && c[1].pct === 100));
    h.page.destroy();
    assert.ok(!h.body.classList.contains('setup-mode'));
  });

  it('lets the user skip setup from the welcome step', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    await h.click('setupSkipSetup');
    await h.flush();
    assert.ok(h.invokeCalls.some((c) => c[0] === 'db:setSetting' && c[1] === 'app.setupComplete' && c[2] === true));
    assert.deepEqual(h.navCalls, ['dashboard']);
  });

  it('lets the user skip setup from a later step', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    await h.click('setupNext');
    await h.click('setupSkip');
    await h.flush();
    assert.ok(h.invokeCalls.some((c) => c[0] === 'db:setSetting' && c[1] === 'app.setupComplete' && c[2] === true));
    assert.deepEqual(h.navCalls, ['dashboard']);
  });

  it('finishes the wizard from the last step', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    await h.goToStep('scan');
    assert.equal(h.registry.get('setupNext').textContent, 'setup.finish');
    await h.click('setupNext');
    assert.ok(h.invokeCalls.some((c) => c[0] === 'db:setSetting' && c[1] === 'app.setupComplete' && c[2] === true));
    assert.deepEqual(h.navCalls, ['dashboard']);
  });

  it('lists languages with flag images on the language step', async () => {
    const h = createHarness();
    h.responses['i18n:listLocales'] = [
      { code: 'fr', label: 'Français' },
      { code: 'de', label: 'Deutsch' }
    ];
    await h.page.render(h.container);
    await h.goToStep('language');
    const gridHtml = h.registry.get('setupLangGrid')._html;
    assert.ok(gridHtml.includes('../../../assets/flags/fr.png'), 'fr card must reference its flag image');
    assert.ok(gridHtml.includes('../../../assets/flags/de.png'), 'de card must reference its flag image');
    assert.ok(gridHtml.includes('Français'));
    assert.ok(gridHtml.includes('Deutsch'));
    assert.ok(h.registry.get('setupLangBtn-fr'), 'fr card must be registered');
  });

  it('applies, persists, and re-renders the wizard on the chosen language', async () => {
    const h = createHarness();
    h.responses['i18n:listLocales'] = [
      { code: 'fr', label: 'Français' },
      { code: 'de', label: 'Deutsch' }
    ];
    await h.page.render(h.container);
    await h.goToStep('language');
    await h.click('setupLangBtn-fr');
    await h.flush();
    assert.deepEqual(h.localeCalls, ['fr']);
    assert.ok(h.settingsCalls.some((p) => p.ui && p.ui.language === 'fr'));
    assert.equal(h.activeStep(), 'language', 'wizard must stay on the language step after re-render');
    assert.deepEqual(h.navCalls, [], 'changing language must not leave the wizard');
    assert.equal(h.registry.get('setupLangBtn-fr').classList.contains('active'), true, 'chosen language card must be highlighted');
    assert.match(h.registry.get('setupLangGrid').innerHTML, /id="setupLangBtn-fr"[^>]*aria-pressed="true"/, 'chosen language card must be announced as pressed');
  });

  it('applies and persists the theme from the theme step', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    await h.goToStep('theme');
    await h.click('setupThemeCard-ocean');
    assert.deepEqual(h.themeCalls, ['ocean']);
    assert.equal(h.registry.get('setupThemeCard-ocean')._attrs['aria-pressed'], 'true');
    await h.click('setupNext');
    assert.ok(h.settingsCalls.some((p) => p.ui && p.ui.theme === 'ocean'));
  });

  it('disables scan notifications when notifications are turned off', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    await h.goToStep('notifications');
    h.registry.get('setupNotificationsToggle').checked = false;
    await h.change('setupNotificationsToggle');
    assert.ok(h.settingsCalls.some((p) => p.features && p.features.notificationsEnabled === false));
    assert.ok(h.settingsCalls.some((p) => p.features && p.features.scanNotifications === false));
  });

  it('enables notifications without touching scan notifications', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    await h.goToStep('notifications');
    h.registry.get('setupNotificationsToggle').checked = true;
    await h.change('setupNotificationsToggle');
    assert.ok(h.settingsCalls.some((p) => p.features && p.features.notificationsEnabled === true));
    assert.ok(!h.settingsCalls.some((p) => p.features && Object.prototype.hasOwnProperty.call(p.features, 'scanNotifications')));
  });

  it('enables Privacy Mode with snapshot, disable patch and flag persistence', async () => {
    const h = createHarness();
    h.responses['privacy:helpers'] = {
      sensitiveFeatures: ['externalLookups', 'geoLookup'],
      disablePatch: { externalLookups: false, geoLookup: false }
    };
    h.responses['db:getSetting'] = (key) => (String(key).startsWith('feature.') ? true : {});
    await h.page.render(h.container);
    await h.goToStep('privacy');
    h.registry.get('setupPrivacyToggle').checked = true;
    await h.change('setupPrivacyToggle');
    const snapshotCall = h.invokeCalls.find((c) => c[0] === 'db:setSetting' && c[1] === 'privacy.snapshot');
    assert.ok(snapshotCall, 'privacy snapshot must be persisted');
    assert.deepEqual(JSON.parse(snapshotCall[2]), { externalLookups: true, geoLookup: true });
    assert.ok(h.settingsCalls.some((p) => p.features && p.features.externalLookups === false));
    assert.ok(h.settingsCalls.some((p) => p.features && p.features.privacyMode === true));
  });

  it('loads detected browsers and stages the extension install', async () => {
    const h = createHarness();
    h.responses['browserExtension:getState'] = {
      ok: true,
      extensionId: 'abc123',
      browsers: [
        { id: 'chrome', name: 'Chrome', installed: true },
        { id: 'edge', name: 'Edge', installed: false }
      ]
    };
    await h.page.render(h.container);
    await h.goToStep('extension');
    const installBtn = h.registry.get('setupExtBtn-chrome');
    assert.ok(installBtn, 'install button must exist for the detected browser');
    h.responses['browserExtension:install'] = { ok: true };
    await h.click('setupExtBtn-chrome');
    assert.ok(h.invokeCalls.some((c) => c[0] === 'browserExtension:install' && c[1] === 'chrome'));
  });

  it('runs the quick scan from the scan step and lands on the scanner', async () => {
    const h = createHarness();
    h.responses['scan:quick'] = {};
    await h.page.render(h.container);
    await h.goToStep('scan');
    await h.click('setupScanRun');
    assert.ok(h.invokeCalls.some((c) => c[0] === 'scan:quick'));
    assert.ok(h.invokeCalls.some((c) => c[0] === 'db:setSetting' && c[1] === 'app.setupComplete' && c[2] === true));
    assert.deepEqual(h.navCalls, ['dashboard', 'scanner']);
  });

  it('defers the first scan without completing it', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    await h.goToStep('scan');
    await h.click('setupScanLater');
    await h.flush();
    assert.ok(!h.invokeCalls.some((c) => c[0] === 'scan:quick'));
    assert.ok(h.invokeCalls.some((c) => c[0] === 'db:setSetting' && c[1] === 'app.setupComplete' && c[2] === true));
    assert.deepEqual(h.navCalls, ['dashboard']);
  });

  it('does not complete the wizard twice when buttons race', async () => {
    const h = createHarness();
    await h.page.render(h.container);
    await Promise.all([h.click('setupSkipSetup'), h.click('setupSkipSetup')]);
    const setCalls = h.invokeCalls.filter((c) => c[0] === 'db:setSetting' && c[1] === 'app.setupComplete');
    assert.ok(setCalls.length >= 1);
    assert.ok(setCalls.length <= 2, 'repeated clicks must not spam setup completion');
  });
});