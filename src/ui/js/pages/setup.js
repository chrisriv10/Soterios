window.Pages = window.Pages || {};

(function () {
  const THEMES = ['dark', 'light', 'ocean', 'emerald', 'sunset', 'violet', 'crimson', 'terminal', 'midnight', 'bumblebee', 'monochrome', 'rose', 'aurora', 'sand', 'cyber', 'mint'];
  const ACCENTS = {
    dark: '#4169E1', light: '#2563eb', ocean: '#2dd4bf', emerald: '#32e06f',
    sunset: '#f97316', violet: '#8b5cf6', crimson: '#dc2626', terminal: '#16a34a',
    midnight: '#38bdf8', bumblebee: '#facc15', monochrome: '#e5e5e5', rose: '#f472b6', aurora: '#60a5fa',
    sand: '#c2571b', cyber: '#ff00ff', mint: '#86efac'
  };
  const STEPS = ['welcome', 'language', 'theme', 'notifications', 'privacy', 'extension', 'scan'];

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.Pages.setup = {
    _stepIndex: 0,
    _theme: 'dark',
    _settings: null,
    _finishing: false,
    _selectedExtensionBrowserId: null,

    async render(container) {
      const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
      this._container = container;
      this._stepIndex = 0;
      this._finishing = false;
      document.body.classList.add('setup-mode');
      try {
        this._settings = await Api.getSettings();
      } catch (_) {
        this._settings = { features: {}, ui: {} };
      }
      this._theme = (this._settings.ui && this._settings.ui.theme) || 'dark';

      const features = (this._settings && this._settings.features) || {};
      const notificationsOn = features.notificationsEnabled !== false;
      const privacyOn = !!features.privacyMode;

      const themeCards = THEMES.map((name) => `
        <button type="button" class="setup-theme-card" id="setupThemeCard-${name}" data-theme="${name}" aria-pressed="${name === this._theme ? 'true' : 'false'}">
          <span class="setup-theme-swatch" style="background:${ACCENTS[name]}"></span>
          <span class="setup-theme-name">${escapeHtml(t('settings.theme.' + name))}</span>
        </button>`).join('');

      const dots = STEPS.map((step, i) => `<span class="setup-dot" id="setupDot-${i}" data-step="${step}"></span>`).join('');

      container.innerHTML = `
        <div class="setup-wizard">
          <button type="button" class="btn btn-ghost setup-skip" id="setupSkip">${escapeHtml(t('setup.skipSetup'))}</button>

          <div class="setup-dots" aria-hidden="true">${dots}</div>

          <section class="setup-step" id="setupStep-welcome">
            <div class="setup-logo">
              <img class="setup-logo-image" src="../../../assets/soteriosLogo.png" alt="Soterios" />
            </div>
            <h1 class="setup-title">${escapeHtml(t('setup.title'))}</h1>
            <p class="setup-subtitle">${escapeHtml(String(t('setup.subtitle')).split(/(?<=[.!?。！？])\s+/u)[0])}</p>
          </section>

          <section class="setup-step" id="setupStep-language">
            <h2 class="setup-step-title">${escapeHtml(t('setup.languageTitle'))}</h2>
            <p class="setup-step-desc">${escapeHtml(t('setup.languageDesc'))}</p>
            <div class="setup-lang-grid" id="setupLangGrid"></div>
          </section>

          <section class="setup-step" id="setupStep-theme">
            <h2 class="setup-step-title">${escapeHtml(t('setup.themeTitle'))}</h2>
            <p class="setup-step-desc">${escapeHtml(t('setup.themeDesc'))}</p>
            <div class="setup-theme-grid">${themeCards}</div>
          </section>

          <section class="setup-step" id="setupStep-notifications">
            <h2 class="setup-step-title">${escapeHtml(t('setup.notificationsTitle'))}</h2>
            <p class="setup-step-desc">${escapeHtml(t('setup.notificationsDesc'))}</p>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">${escapeHtml(t('settings.enableNotifications.label'))}</div>
                <div class="toggle-desc">${escapeHtml(t('settings.enableNotifications.desc'))}</div>
              </div>
              <label class="toggle"><input type="checkbox" id="setupNotificationsToggle" ${notificationsOn ? 'checked' : ''} /><span class="toggle-slider"></span></label>
            </div>
          </section>

          <section class="setup-step" id="setupStep-privacy">
            <h2 class="setup-step-title">${escapeHtml(t('setup.privacyTitle'))}</h2>
            <p class="setup-step-desc">${escapeHtml(t('setup.privacyDesc'))}</p>
            <div class="toggle-row">
              <div>
                <div class="toggle-label">${escapeHtml(t('settings.privacyMode.label'))}</div>
                <div class="toggle-desc">${escapeHtml(t('settings.privacyMode.desc'))}</div>
              </div>
              <label class="toggle"><input type="checkbox" id="setupPrivacyToggle" ${privacyOn ? 'checked' : ''} /><span class="toggle-slider"></span></label>
            </div>
            <div id="setupPrivacyStatus" class="setup-status"></div>
          </section>

          <section class="setup-step" id="setupStep-extension">
            <h2 class="setup-step-title">${escapeHtml(t('setup.extensionTitle'))}</h2>
            <p class="setup-step-desc">${escapeHtml(t('setup.extensionDesc'))}</p>
            <div id="setupExtensionBody" class="setup-status">${escapeHtml(t('settings.browserExtension.checking'))}</div>
          </section>

          <section class="setup-step" id="setupStep-scan">
            <h2 class="setup-step-title">${escapeHtml(t('setup.scanTitle'))}</h2>
            <p class="setup-step-desc">${escapeHtml(t('setup.scanDesc'))}</p>
            <div class="setup-scan-actions">
              <button type="button" class="btn btn-primary" id="setupScanRun">${escapeHtml(t('setup.scanRun'))}</button>
              <button type="button" class="btn btn-ghost" id="setupScanLater">${escapeHtml(t('setup.scanLater'))}</button>
            </div>
          </section>

          <div class="setup-actions">
            <button type="button" class="btn btn-ghost" id="setupBack">${escapeHtml(t('setup.back'))}</button>
            <button type="button" class="btn btn-primary" id="setupNext">${escapeHtml(t('setup.next'))}</button>
          </div>
        </div>`;

      this._bindThemeCards(container);
      this._bindStepContent(container);
      this._goTo(0);
      this._loadLanguageGrid(container, t);
      this._loadExtensionBody(container, t);

      try {
        window.api.invoke('splash:progress', { pct: 85, label: t('splash.loadingDashboard') });
        window.api.invoke('splash:progress', { pct: 90, label: t('splash.finalizing') });
        window.api.invoke('splash:progress', { pct: 100, label: t('splash.ready') });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await window.api.invoke('app:ready');
      } catch (_) {
        await window.api.invoke('app:ready').catch(() => {});
      }
    },

    destroy() {
      document.body.classList.remove('setup-mode');
      this._container = null;
    },

    _bindThemeCards(container) {
      for (const name of THEMES) {
        const card = container.querySelector('#setupThemeCard-' + name);
        if (!card) continue;
        card.addEventListener('click', () => {
          this._theme = name;
          Api.applyTheme(name);
          for (const other of THEMES) {
            const el = container.querySelector('#setupThemeCard-' + other);
            if (el) {
              el.classList.toggle('active', other === name);
              el.setAttribute('aria-pressed', other === name ? 'true' : 'false');
            }
          }
        });
      }
    },

    _bindStepContent(container) {
      const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
      const back = container.querySelector('#setupBack');
      const next = container.querySelector('#setupNext');
      const skip = container.querySelector('#setupSkip');

      back.addEventListener('click', () => {
        if (this._stepIndex > 0) this._goTo(this._stepIndex - 1);
      });
      next.addEventListener('click', async () => {
        if (this._stepIndex === STEPS.length - 1) {
          await this._finish();
          return;
        }
        await this._applyCurrentStep();
        this._goTo(this._stepIndex + 1);
      });
      skip.addEventListener('click', () => { this._finish(); });

      const notificationsToggle = container.querySelector('#setupNotificationsToggle');
      if (notificationsToggle) {
        notificationsToggle.addEventListener('change', async (event) => {
          const checked = event.target.checked;
          event.target.disabled = true;
          try {
            await Api.updateSettings({ features: { notificationsEnabled: checked } });
            if (!checked) {
              await Api.updateSettings({ features: { scanNotifications: false } });
            }
          } catch (_) {
            event.target.checked = !checked;
          } finally {
            event.target.disabled = false;
          }
        });
      }

      const privacyToggle = container.querySelector('#setupPrivacyToggle');
      if (privacyToggle) {
        privacyToggle.addEventListener('change', async (event) => {
          const input = event.target;
          const enable = input.checked;
          const status = container.querySelector('#setupPrivacyStatus');
          input.disabled = true;
          if (status) status.textContent = t('settings.privacyMode.applying');
          try {
            const helpers = await window.api.invoke('privacy:helpers');
            if (enable) {
              const snapshot = {};
              for (const key of helpers.sensitiveFeatures) {
                snapshot[key] = Boolean(await window.api.invoke('db:getSetting', 'feature.' + key, true));
              }
              await window.api.invoke('db:setSetting', 'privacy.snapshot', JSON.stringify(snapshot));
              await Api.updateSettings({ features: helpers.disablePatch });
              await Api.updateSettings({ features: { privacyMode: true } });
            } else {
              let snapshot = {};
              try {
                snapshot = JSON.parse(await window.api.invoke('db:getSetting', 'privacy.snapshot', '{}')) || {};
              } catch (_) {}
              const restorePatch = await window.api.invoke('privacy:restorePatch', snapshot);
              if (Object.keys(restorePatch).length > 0) {
                await Api.updateSettings({ features: restorePatch });
              }
              await window.api.invoke('db:setSetting', 'privacy.snapshot', '');
              await Api.updateSettings({ features: { privacyMode: false } });
            }
            if (status) status.textContent = '';
          } catch (err) {
            input.checked = !enable;
            if (status) status.textContent = err.message || String(err);
          } finally {
            input.disabled = false;
          }
        });
      }

      const scanRun = container.querySelector('#setupScanRun');
      if (scanRun) {
        scanRun.addEventListener('click', async () => {
          try {
            await window.api.invoke('scan:quick');
            await this._finish();
            if (window.AppRouter) window.AppRouter.navigate('scanner');
          } catch (_) {
            await this._finish();
          }
        });
      }
      const scanLater = container.querySelector('#setupScanLater');
      if (scanLater) {
        scanLater.addEventListener('click', () => { this._finish(); });
      }
    },

    async _applyCurrentStep() {
      if (this._stepIndex === 2) {
        await Api.updateSettings({ ui: { theme: this._theme } });
      }
    },

    _goTo(index) {
      const direction = index > this._stepIndex ? 'forward' : 'back';
      const root = document.documentElement;
      if (root?.classList) {
        root.classList.toggle('vt-forward', direction === 'forward');
        root.classList.toggle('vt-back', direction === 'back');
      }

      const supportsVT = typeof document?.startViewTransition === 'function';

      const doTransition = () => {
        this._stepIndex = index;
        this._updateStepVisibility();
        this._updateDots();
        this._updateButtons();
      };

      if (supportsVT) {
        document.startViewTransition(doTransition);
      } else {
        doTransition();
      }
    },

    _updateStepVisibility() {
      const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
      if (!this._container) return;
      for (let i = 0; i < STEPS.length; i++) {
        const section = this._container.querySelector('#setupStep-' + STEPS[i]);
        if (section) {
          const isActive = i === this._stepIndex;
          section.classList.toggle('active', isActive);
          try {
            if (isActive) {
              section.removeAttribute?.('inert');
            } else {
              section.setAttribute?.('inert', '');
            }
          } catch (_) {}
        }
      }
    },

    _updateDots() {
      if (!this._container) return;
      for (let i = 0; i < STEPS.length; i++) {
        const dot = this._container.querySelector('#setupDot-' + i);
        if (dot) dot.classList.toggle('active', i === this._stepIndex);
      }
    },

    _updateButtons() {
      const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
      if (!this._container) return;
      const back = this._container.querySelector('#setupBack');
      if (back) back.disabled = this._stepIndex === 0;
      const next = this._container.querySelector('#setupNext');
      if (next) next.textContent = this._stepIndex === STEPS.length - 1 ? t('setup.finish') : t('setup.next');
      const skip = this._container.querySelector('#setupSkip');
      if (skip) skip.textContent = t('setup.skipSetup');
    },

    async _loadLanguageGrid(container, t) {
      const grid = container.querySelector('#setupLangGrid');
      if (!grid) return;
      let locales = null;
      try {
        locales = await window.api.invoke('i18n:listLocales');
      } catch (_) {}
      if (!Array.isArray(locales) || locales.length === 0) {
        locales = [{ code: 'en', label: 'English' }];
      }
      const currentLocale = (window.I18n && window.I18n.locale) || 'en';
      grid.innerHTML = locales.map((l) => `
        <button type="button" class="setup-lang-card" id="setupLangBtn-${escapeHtml(l.code)}" data-lang="${escapeHtml(l.code)}" aria-pressed="${l.code === currentLocale ? 'true' : 'false'}">
          <img class="setup-lang-flag" src="../../../assets/flags/${escapeHtml(l.code)}.png" alt="" loading="lazy" />
          <span class="setup-lang-name">${escapeHtml(l.label)}</span>
        </button>`).join('');
      for (const l of locales) {
        const btn = grid.querySelector('#setupLangBtn-' + l.code);
        if (!btn) continue;
        if (l.code === currentLocale) btn.classList.add('active');
        btn.addEventListener('click', async () => {
          await this._applyLanguage(l.code, container, t);
        });
      }
    },

    async _applyLanguage(code, container, t) {
      const keep = this._stepIndex;
      try {
        if (window.I18n) await window.I18n.setLocale(code);
        await Api.updateSettings({ ui: { language: code } });
      } catch (_) {}
      if (container === this._container && !this._finishing) {
        await this.render(container);
        this._goTo(keep);
      }
    },

    async _loadExtensionBody(container, t) {
      const body = container.querySelector('#setupExtensionBody');
      if (!body) return;
      try {
        const state = await window.api.invoke('browserExtension:getState');
        if (!state || !state.ok) throw new Error((state && state.error) || 'Failed to load browser extension state');
        const detected = state.browsers.filter((b) => b.installed);
        if (detected.length === 0) {
          body.innerHTML = escapeHtml(t('settings.browserExtension.noBrowser'));
          return;
        }
        if (!detected.some((browser) => browser.id === this._selectedExtensionBrowserId)) {
          this._selectedExtensionBrowserId = detected[0].id;
        }
        body.innerHTML = detected.map((b) => `
          <div class="setup-ext-row ${b.id === this._selectedExtensionBrowserId ? 'selected' : ''}" data-browser-select="${escapeHtml(b.id)}" role="button" tabindex="0" aria-pressed="${b.id === this._selectedExtensionBrowserId ? 'true' : 'false'}">
            <div style="min-width:0;">
              <div class="toggle-label">${escapeHtml(b.name)}</div>
              <div class="toggle-desc">${escapeHtml(t('settings.browserExtension.extensionId', { id: state.extensionId }))}</div>
            </div>
            <button type="button" class="btn btn-sm" id="setupExtBtn-${escapeHtml(b.id)}" data-browser="${escapeHtml(b.id)}">${escapeHtml(t('settings.browserExtension.installBtn'))}</button>
          </div>`).join('');
        for (const b of detected) {
          const row = body.querySelector(`[data-browser-select="${b.id}"]`);
          const select = () => {
            this._selectedExtensionBrowserId = b.id;
            body.querySelectorAll('[data-browser-select]').forEach((item) => {
              const selected = item.dataset.browserSelect === b.id;
              item.classList.toggle('selected', selected);
              item.setAttribute('aria-pressed', String(selected));
            });
          };
          row?.addEventListener('click', (event) => {
            if (!event.target.closest('button')) select();
          });
          row?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              select();
            }
          });
          const btn = body.querySelector('#setupExtBtn-' + b.id);
          if (!btn) continue;
          btn.addEventListener('click', async () => {
            try {
              const result = await window.api.invoke('browserExtension:install', b.id);
              btn.textContent = result && result.ok
                ? t('settings.browserExtension.installed')
                : t('settings.browserExtension.installFailed');
            } catch (_) {
              btn.textContent = t('settings.browserExtension.installFailed');
            }
          });
        }
        const buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;';
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'btn btn-sm setup-extension-open';
        const openBrowserKey = 'settings.browserExtension.openBrowser';
        const translatedOpenBrowser = t(openBrowserKey);
        openBtn.textContent = translatedOpenBrowser === openBrowserKey ? 'Open browser' : translatedOpenBrowser;
        openBtn.addEventListener('click', async () => {
          try { await window.api.invoke('browserExtension:openPage', this._selectedExtensionBrowserId || detected[0].id); } catch (_) {}
        });
        buttonRow.appendChild(openBtn);
        const openFolderBtn = document.createElement('button');
        openFolderBtn.type = 'button';
        openFolderBtn.className = 'btn btn-sm setup-extension-open-folder';
        openFolderBtn.textContent = t('settings.browserExtension.openFolder');
        openFolderBtn.addEventListener('click', async () => {
          try { await window.api.invoke('browserExtension:openFolder'); } catch (_) {}
        });
        buttonRow.appendChild(openFolderBtn);
        body.appendChild(buttonRow);
      } catch (err) {
        body.innerHTML = escapeHtml(err.message || String(err));
      }
    },

    async _finish() {
      if (this._finishing) return;
      this._finishing = true;
      try {
        await window.api.invoke('db:setSetting', 'app.setupComplete', true);
      } catch (_) {}
      if (window.AppRouter) window.AppRouter.navigate('dashboard');
    }
  };
})();
