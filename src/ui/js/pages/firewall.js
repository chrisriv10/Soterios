window.Pages = window.Pages || {};
window.Pages['firewall'] = {
  REFRESH_INTERVAL_MS: 4000,
  _summaryTimer: null,
  _ruleQuery: '',
  _ruleActionFilter: 'all',
  _ruleDirectionFilter: 'all',

  t(key, vars) {
    return window.I18n?.t(key, vars) ?? key;
  },

  render(container) {
    if (this._summaryTimer) {
      clearInterval(this._summaryTimer);
      this._summaryTimer = null;
    }
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">${escapeHtml(t('firewall.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('firewall.subtitle'))}</p>
      </header>
      <div id="firewallContent">
        <div class="empty-state"><span class="spinner"></span>&nbsp;${escapeHtml(t('firewall.loading'))}</div>
      </div>
    `;
    this.load(container);
  },
  async load(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const content = container.querySelector('#firewallContent');
    try {
      const profilesPromise = window.api.invoke('firewall:status');
      const rulesPromise = window.api.invoke('firewall:rules');
      const profiles = await profilesPromise;
      const rules = await rulesPromise;
      const settings = await Api.getSettings();
      const showPerimeterMap = settings.features.networkPerimeterMap !== false;

      let html = '';
      html += `<div id="firewallSummary">${this._renderSummaryHtml(profiles, rules, t)}</div>`;

      if (showPerimeterMap) html += this._renderPerimeterHtml(t);
      else {
        html += `
        <div class="card" style="margin-top:24px; padding:20px 24px;">
          <div class="empty-state" style="margin:0;">
            ${escapeHtml(t('firewall.perimeterDisabled'))} <a href="#" class="goto-settings" style="color:var(--accent-primary);">${escapeHtml(t('nav.settings'))}</a>.
          </div>
        </div>`;
      }

      html += this._renderRulesHtml(t);
      content.innerHTML = html;

      const settingsLink = content.querySelector('.goto-settings');
      if (settingsLink) {
        settingsLink.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.AppRouter) window.AppRouter.navigate('settings');
        });
      }

      if (showPerimeterMap) await this._initPerimeter(container);
      await this._initRuleList(container);
      this._wireImportExport(container);

      content.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-profile-toggle]');
        if (!btn) return;
        const name = btn.getAttribute('data-profile-toggle');
        const enabled = btn.getAttribute('data-enabled') === 'true';
        this._toggleProfile(container, name, enabled, t);
      });

      if (this._summaryTimer) clearInterval(this._summaryTimer);
      this._summaryTimer = setInterval(() => {
        if (!document.body.contains(container)) {
          clearInterval(this._summaryTimer);
          this._summaryTimer = null;
          return;
        }
        this._refreshSummary(container, t);
      }, this.REFRESH_INTERVAL_MS);

    } catch (e) {
      content.innerHTML = `<div class="empty-state">${escapeHtml(t('firewall.error', { error: e.message }))}</div>`;
    }
  },

  _renderSummaryHtml(profiles, rules, t) {
    const safeRules = rules || {
      total: 0, inbound: 0, outbound: 0, allow: 0, block: 0, enabled: 0, disabled: 0,
      profiles: { domain: 0, private: 0, public: 0 }
    };

    let html = '';
    html += `<div class="grid grid-4" style="margin-bottom:18px;">
      <div class="stat-tile"><div class="stat-label">${escapeHtml(t('firewall.totalRules'))}</div><div class="stat-value">${safeRules.total}</div></div>
      <div class="stat-tile"><div class="stat-label">${escapeHtml(t('firewall.inboundOutbound'))}</div><div class="stat-value">${safeRules.inbound} / ${safeRules.outbound}</div></div>
      <div class="stat-tile"><div class="stat-label">${escapeHtml(t('firewall.allowBlock'))}</div><div class="stat-value" style="color:var(--ok);">${safeRules.allow} / <span style="color:var(--danger);">${safeRules.block}</span></div></div>
      <div class="stat-tile"><div class="stat-label">${escapeHtml(t('firewall.enabledDisabled'))}</div><div class="stat-value" style="color:var(--ok);">${safeRules.enabled} / <span style="color:var(--text-dim);">${safeRules.disabled}</span></div></div>
    </div>`;
    html += `<div class="grid grid-3" style="margin-bottom:18px;">
      <div class="stat-tile"><div class="stat-label">${escapeHtml(t('firewall.domainRules'))}</div><div class="stat-value">${safeRules.profiles.domain}</div></div>
      <div class="stat-tile"><div class="stat-label">${escapeHtml(t('firewall.privateRules'))}</div><div class="stat-value">${safeRules.profiles.private}</div></div>
      <div class="stat-tile"><div class="stat-label">${escapeHtml(t('firewall.publicRules'))}</div><div class="stat-value">${safeRules.profiles.public}</div></div>
    </div>`;

    let list = profiles;
    if (!Array.isArray(list)) list = [list];
    html += '<div class="dashboard-grid">';
    for (const res of list) {
      if (!res) continue;
      const name = res.Name || 'Profile';
      const enabled = res.Enabled === 1 || res.Enabled === true;
      const iconClass = enabled ? 'safe' : 'danger';
      const iconSvg = enabled
        ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
        : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
      html += `<div class="card" style="display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; align-items:center; gap:16px;">
          <div class="status-icon ${iconClass}" style="width:40px;height:40px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;">${iconSvg}</svg>
          </div>
          <div style="flex:1; display:flex; justify-content:space-between; align-items:center; gap:12px;">
            <div>
              <div style="font-weight:600; font-size:1.1rem;">${escapeHtml(name)}</div>
              <div class="page-subtitle" style="font-size:0.85rem; margin-top:2px;">
                ${escapeHtml(t('firewall.profileStatus', { status: enabled ? t('firewall.on') : t('firewall.off') }))}
              </div>
            </div>
            <button
              class="btn btn-sm"
              style="${enabled ? 'color:var(--danger);' : 'color:var(--ok);'} white-space:nowrap;"
              data-profile-toggle="${escapeHtml(name)}"
              data-enabled="${enabled}"
            >${escapeHtml(enabled ? t('firewall.turnOff') : t('firewall.turnOn'))}</button>
          </div>
        </div>
        ${rules ? `<div style="display:flex; gap:16px; font-size:0.85rem; color:var(--text-dim);">
          <span>${escapeHtml(t('firewall.rulesAffecting', { count: rules.profiles[((res.Name || '').toLowerCase())] || 0 }))}</span>
        </div>` : ''}
      </div>`;
    }
    html += '</div>';
    return html;
  },

  _renderPerimeterHtml(t) {
    return `
      <div class="list-row" id="perimeterCard" style="margin-top:24px; padding:24px 28px;">
        <style>
          #perimeterCard .perim-node { cursor:pointer; transition: opacity 0.5s ease; }
          #perimeterCard .perim-node.entering circle.perim-dot { animation: perimPop 0.4s ease; }
          #perimeterCard .perim-node.selected circle.perim-dot { stroke:#fff; stroke-width:2; }
          #perimeterCard .perim-blocked-ring { animation: perimPulse 1.6s ease-out infinite; }
          #perimeterCard .glossary-term { border-bottom:1px dotted var(--text-dim); cursor:help; }
          @keyframes perimPop { from { transform: scale(0); } to { transform: scale(1); } }
          @keyframes perimPulse {
            0% { opacity:0.55; transform: scale(0.6); }
            100% { opacity:0; transform: scale(1.8); }
          }
        </style>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" style="width:18px;height:18px;flex-shrink:0;">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span style="font-weight:600; font-size:0.95rem; letter-spacing:0.3px;">${escapeHtml(t('firewall.perimeterTitle'))}</span>
          <span id="perimeterSummary" style="margin-left:auto; font-size:0.78rem; color:var(--text-muted);"></span>
        </div>

        <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:16px; padding:12px 14px; background:var(--bg-surface-hover); border-radius:8px;">
          <input type="text" id="connSearchInput" placeholder="${escapeHtml(t('firewall.searchPlaceholder'))}"
            style="flex:1; min-width:200px; padding:7px 12px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:var(--text-main);" />
          <label style="font-size:0.8rem; color:var(--text-dim); display:flex; align-items:center; gap:6px; white-space:nowrap;">
            ${escapeHtml(t('firewall.showOnMap'))}
            <select id="maxNodesSelect" class="btn btn-sm">
              <option value="20">20</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="all">${escapeHtml(t('common.all'))}</option>
            </select>
          </label>
          <label style="font-size:0.8rem; color:var(--text-dim); display:flex; align-items:center; gap:6px; white-space:nowrap;">
            ${escapeHtml(t('firewall.direction'))}
            <select id="directionFilterSelect" class="btn btn-sm">
              <option value="all" selected>${escapeHtml(t('firewall.directionAll'))}</option>
              <option value="inbound">${escapeHtml(t('firewall.directionInbound'))}</option>
              <option value="outbound">${escapeHtml(t('firewall.directionOutbound'))}</option>
            </select>
          </label>
          <label style="font-size:0.8rem; color:var(--text-dim); display:flex; align-items:center; gap:6px; white-space:nowrap;">
            ${escapeHtml(t('firewall.process'))}
            <select id="processFilterSelect" class="btn btn-sm">
              <option value="all" selected>${escapeHtml(t('common.all'))}</option>
            </select>
          </label>
          <div style="display:flex; gap:12px; font-size:0.8rem;">
            <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" id="filterSafe" checked/> <span style="color:var(--ok);">${escapeHtml(t('firewall.filterAllowed'))}</span></label>
            <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" id="filterUnknown" checked/> <span style="color:var(--warn);">${escapeHtml(t('firewall.filterUnverified'))}</span></label>
            <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" id="filterMalicious" checked/> <span style="color:var(--danger);">${escapeHtml(t('firewall.filterBlocked'))}</span></label>
          </div>
        </div>

        <div style="display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">
          <div style="flex:2; min-width:320px;">
            <svg id="perimeterSvg" viewBox="0 0 600 420" style="width:100%; height:auto; display:block;"></svg>
            <div style="display:flex; justify-content:center; gap:20px; margin-top:10px; flex-wrap:wrap; font-size:0.78rem; color:var(--text-dim);">
              <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ok);margin-right:5px;"></span>${escapeHtml(t('firewall.legendAllowed'))}</span>
              <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--warn);margin-right:5px;"></span>${escapeHtml(t('firewall.legendUnverified'))}</span>
              <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--danger);margin-right:5px;"></span>${escapeHtml(t('firewall.legendBlocked'))}</span>
            </div>
          </div>
          <div style="flex:1; min-width:270px; max-width:340px;" id="connectionDetailPanel"></div>
        </div>

        <div style="margin-top:24px; padding-top:20px; border-top:1px solid var(--glass-border);">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px;">
            <h3 style="margin:0; font-size:0.95rem;">${escapeHtml(t('firewall.allConnections'))}</h3>
            <span id="connTableCount" style="font-size:0.78rem; color:var(--text-muted);"></span>
          </div>
          <div id="connTableContainer" style="max-height:340px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
            <div class="empty-state">${escapeHtml(t('firewall.loadingConnections'))}</div>
          </div>
        </div>
      </div>`;
  },

  _renderRulesHtml(t) {
    return `
      <div class="card" style="margin-top:24px; padding:20px 24px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
          <h3 style="margin:0;">${escapeHtml(t('firewall.firewallRules'))}</h3>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <button class="btn btn-sm" id="exportFirewallRulesBtn" type="button">${escapeHtml(t('firewall.exportRules'))}</button>
            <button class="btn btn-sm" id="importFirewallRulesBtn" type="button">${escapeHtml(t('firewall.importRules'))}</button>
            <select id="ruleActionFilter" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
              <option value="all" ${this._ruleActionFilter === 'all' ? 'selected' : ''}>${escapeHtml(t('firewall.ruleActionFilter'))}</option>
              <option value="Allow" ${this._ruleActionFilter === 'Allow' ? 'selected' : ''}>${escapeHtml(t('firewall.ruleActionAllow'))}</option>
              <option value="Block" ${this._ruleActionFilter === 'Block' ? 'selected' : ''}>${escapeHtml(t('firewall.ruleActionBlock'))}</option>
            </select>
            <select id="ruleDirectionFilter" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
              <option value="all" ${this._ruleDirectionFilter === 'all' ? 'selected' : ''}>${escapeHtml(t('firewall.ruleDirectionFilter'))}</option>
              <option value="Inbound" ${this._ruleDirectionFilter === 'Inbound' ? 'selected' : ''}>${escapeHtml(t('firewall.ruleDirectionInbound'))}</option>
              <option value="Outbound" ${this._ruleDirectionFilter === 'Outbound' ? 'selected' : ''}>${escapeHtml(t('firewall.ruleDirectionOutbound'))}</option>
            </select>
            <input type="text" id="ruleSearchInput" placeholder="${escapeHtml(t('firewall.ruleSearchPlaceholder'))}"
              value="${escapeHtml(this._ruleQuery || '')}"
              style="min-width:240px; padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:var(--text-main);" />
          </div>
        </div>
        <div id="ruleListContainer" style="max-height:380px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
          <div class="empty-state">${escapeHtml(t('firewall.loadingRules'))}</div>
        </div>
      </div>`;
  },

  async _toggleProfile(container, profileName, currentlyEnabled, t) {
    const turningOff = currentlyEnabled;
    const verb = turningOff ? t('firewall.turnOff') : t('firewall.turnOn');
    const warning = turningOff
      ? t('firewall.confirmTurnOff', { profile: profileName })
      : t('firewall.confirmTurnOn', { profile: profileName });
    if (!window.confirm(warning)) return;

    const btn = container.querySelector(`[data-profile-toggle="${CSS.escape(profileName)}"]`);
    if (btn) { btn.disabled = true; btn.textContent = turningOff ? t('firewall.turningOff') : t('firewall.turningOn'); }

    try {
      await window.api.invoke('firewall:setProfileEnabled', { profile: profileName, enabled: !currentlyEnabled });
      await this._refreshSummary(container, t);
    } catch (e) {
      alert(this._friendlyError(e, t('firewall.failedToggle', { action: turningOff ? t('common.disable') : t('common.enable'), profile: profileName })));
      if (btn) { btn.disabled = false; btn.textContent = turningOff ? t('firewall.turnOff') : t('firewall.turnOn'); }
    }
  },

  async _refreshSummary(container, t) {
    const summaryEl = container.querySelector('#firewallSummary');
    if (!summaryEl) return;
    try {
      const [profiles, rules] = await Promise.all([
        window.api.invoke('firewall:status'),
        window.api.invoke('firewall:rules')
      ]);
      summaryEl.innerHTML = this._renderSummaryHtml(profiles, rules, t);
    } catch (e) {
      console.error('Firewall summary refresh failed:', e);
    }
  },

  _perimeterTimer: null,
  _particleRaf: null,
  _perimeterNodes: new Map(),
  _perimeterNodeEls: new Map(),
  _selectedKey: null,
  _trustedIps: [],
  _lastConnections: [],
  _searchQuery: '',
  _riskFilter: { SAFE: true, UNKNOWN: true, MALICIOUS: true },
  _directionFilter: 'all',
  _processFilter: 'all',
  _maxVisualNodes: 50,

  _glossary(key) {
    return this.t(`firewall.glossary.${key}`);
  },

  _riskLabel(risk) {
    return risk === 'SAFE' ? window.I18n?.t('common.allowed') ?? 'Allowed' : risk === 'MALICIOUS' ? window.I18n?.t('common.blocked') ?? 'Blocked' : window.I18n?.t('common.unverified') ?? 'Unverified';
  },

  STATE_CODE_MAP: {
    1: 'CLOSED', 2: 'LISTEN', 3: 'SYN_SENT', 4: 'SYN_RECEIVED',
    5: 'ESTABLISHED', 6: 'FIN_WAIT_1', 7: 'FIN_WAIT_2', 8: 'CLOSE_WAIT',
    9: 'CLOSING', 10: 'LAST_ACK', 11: 'TIME_WAIT', 12: 'DELETE_TCB', 100: 'BOUND'
  },

  _getConnState(c) {
    const raw = c.state ?? c.State ?? c.connectionState ?? c.ConnectionState ?? c.status ?? c.Status ?? '';
    return (this.STATE_CODE_MAP[raw] || raw || 'UNKNOWN').toString().toUpperCase();
  },

  _field(c, ...names) {
    for (const n of names) { if (c[n] !== undefined && c[n] !== null && c[n] !== '') return c[n]; }
    return '';
  },

  _isIPv4(ip) {
    return typeof ip === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  },

  _getDirection(c, localPort, remotePort) {
    const lp = Number(localPort) || 0;
    const rp = Number(remotePort) || 0;
    if (lp > 0 && lp < 1024 && rp >= 1024) return 'inbound';
    return 'outbound';
  },

  _connKey(c) {
    return [
      this._field(c, 'localAddress', 'LocalAddress'), this._field(c, 'localPort', 'LocalPort'),
      this._field(c, 'remoteAddress', 'RemoteAddress'), this._field(c, 'remotePort', 'RemotePort')
    ].join('|');
  },

  _friendlyError(e, fallback) {
    let raw = (e && e.message) || String(e || '');
    raw = raw.replace(/^Error invoking remote method '[^']*':\s*/i, '');
    raw = raw.replace(/^Error:\s*/i, '');
    if (!raw || raw.length > 160 || /\bat line:|exception calling|\bstack\b/i.test(raw)) {
      return fallback || t('common.error');
    }
    return raw;
  },

  async _initPerimeter(container) {
    try { this._trustedIps = (await window.api.invoke('firewall:getTrusted')) || []; } catch (_) { this._trustedIps = []; }

    this._renderDetailPanel(container, null);
    await this._pollPerimeter(container);
    this._startParticleLoop(container);

    const searchInput = container.querySelector('#connSearchInput');
    const maxNodesSelect = container.querySelector('#maxNodesSelect');
    const directionFilterSelect = container.querySelector('#directionFilterSelect');
    const processFilterSelect = container.querySelector('#processFilterSelect');
    const filterSafe = container.querySelector('#filterSafe');
    const filterUnknown = container.querySelector('#filterUnknown');
    const filterMalicious = container.querySelector('#filterMalicious');

    const reRenderFromCache = () => {
      this._renderPerimeter(container, this._lastConnections);
      this._renderConnectionsTable(container, this._lastConnections);
    };

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this._searchQuery = searchInput.value.trim().toLowerCase();
        reRenderFromCache();
      });
    }
    if (maxNodesSelect) {
      maxNodesSelect.addEventListener('change', () => {
        this._maxVisualNodes = maxNodesSelect.value === 'all' ? Infinity : (Number(maxNodesSelect.value) || 50);
        reRenderFromCache();
      });
    }
    if (directionFilterSelect) {
      directionFilterSelect.addEventListener('change', () => {
        this._directionFilter = directionFilterSelect.value;
        reRenderFromCache();
      });
    }
    if (processFilterSelect) {
      processFilterSelect.addEventListener('change', () => {
        this._processFilter = processFilterSelect.value;
        reRenderFromCache();
      });
    }
    [['SAFE', filterSafe], ['UNKNOWN', filterUnknown], ['MALICIOUS', filterMalicious]].forEach(([risk, el]) => {
      if (!el) return;
      el.addEventListener('change', () => {
        this._riskFilter[risk] = el.checked;
        reRenderFromCache();
      });
    });

    if (this._perimeterTimer) clearInterval(this._perimeterTimer);
    this._perimeterTimer = setInterval(() => {
      if (!document.body.contains(container)) {
        clearInterval(this._perimeterTimer);
        this._perimeterTimer = null;
        if (this._particleRaf) cancelAnimationFrame(this._particleRaf);
        return;
      }
      if (this._perimeterPolling) return;
      this._perimeterPolling = true;
      this._pollPerimeter(container).finally(() => {
        this._perimeterPolling = false;
      });
    }, 6000);
  },

  async _pollPerimeter(container) {
    const svg = container.querySelector('#perimeterSvg');
    if (!svg) return;
    let connections = [];
    try {
      const res = await window.api.invoke('network:connections');
      connections = Array.isArray(res) ? res : [];
    } catch (_) { return; }
    this._lastConnections = connections;
    this._updateProcessFilterOptions(container, connections);
    this._renderPerimeter(container, connections);
    this._renderConnectionsTable(container, connections);
  },

  _classifyRisk(c, key) {
    const remoteAddress = this._field(c, 'remoteAddress', 'RemoteAddress');
    if (c.classification === 'MALICIOUS') return 'MALICIOUS';
    if (this._trustedIps.includes(remoteAddress)) return 'SAFE';
    if (c.classification === 'SAFE') return 'SAFE';
    return 'UNKNOWN';
  },

  _riskColor(risk) {
    return risk === 'SAFE' ? 'var(--ok)' : risk === 'MALICIOUS' ? 'var(--danger)' : 'var(--warn)';
  },

  _matchesFilters(c, risk) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    if (!this._riskFilter[risk]) return false;
    if (this._directionFilter !== 'all') {
      const localPort = this._field(c, 'localPort', 'LocalPort');
      const remotePort = this._field(c, 'remotePort', 'RemotePort');
      if (this._getDirection(c, localPort, remotePort) !== this._directionFilter) return false;
    }
    if (this._processFilter !== 'all') {
      if ((this._field(c, 'processName') || '(unknown process)') !== this._processFilter) return false;
    }
    if (!this._searchQuery) return true;
    const haystack = [
      this._field(c, 'processName'), this._field(c, 'remoteAddress', 'RemoteAddress'),
      this._field(c, 'hostname'), this._field(c, 'serviceName')
    ].join(' ').toLowerCase();
    return haystack.includes(this._searchQuery);
  },

  _updateProcessFilterOptions(container, connections) {
    const select = container.querySelector('#processFilterSelect');
    if (!select) return;
    const names = [...new Set(connections.map((c) => this._field(c, 'processName') || '(unknown process)'))].sort();
    const previousValue = select.value;
    select.innerHTML = '<option value="all">All</option>' + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if (previousValue && (previousValue === 'all' || names.includes(previousValue))) {
      select.value = previousValue;
    } else {
      select.value = 'all';
      this._processFilter = 'all';
    }
  },

  _renderPerimeter(container, connections) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const svg = container.querySelector('#perimeterSvg');
    const summary = container.querySelector('#perimeterSummary');
    if (!svg) return;

    const cx = 300, cy = 210;
    const boundaryR = 175;

    const priority = { MALICIOUS: 0, UNKNOWN: 1, SAFE: 2 };
    const withMeta = connections
      .map((c) => {
        const key = this._connKey(c);
        const risk = this._classifyRisk(c, key);
        return { c, key, risk };
      })
      .filter((item) => this._matchesFilters(item.c, item.risk));
    withMeta.sort((a, b) => priority[a.risk] - priority[b.risk]);
    const cap = Number.isFinite(this._maxVisualNodes) ? this._maxVisualNodes : withMeta.length;
    const shown = withMeta.slice(0, cap);
    const hiddenCount = Math.max(0, withMeta.length - shown.length);

    for (const item of shown) {
      const localPort = this._field(item.c, 'localPort', 'LocalPort');
      const remotePort = this._field(item.c, 'remotePort', 'RemotePort');
      item.direction = this._getDirection(item.c, localPort, remotePort);
      item.blocked = item.risk === 'MALICIOUS';
    }

    const sectionOrder = ['MALICIOUS', 'UNKNOWN', 'SAFE'];
    const sectionLabels = { MALICIOUS: t('firewall.legendBlocked'), UNKNOWN: t('firewall.legendUnverified'), SAFE: t('firewall.legendAllowed') };
    const groups = sectionOrder
      .map((risk) => ({ risk, items: shown.filter((i) => i.risk === risk) }))
      .filter((g) => g.items.length > 0);

    const GAP = groups.length > 1 ? (Math.PI * 2 * 0.02) : 0;
    const totalGapAngle = GAP * groups.length;
    const availableAngle = Math.PI * 2 - totalGapAngle;
    const MIN_SECTION_FRACTION = groups.length > 1 ? 0.08 : 0;
    const totalCount = shown.length || 1;
    let cursor = -Math.PI / 2;
    const sectionMeta = [];
    for (const g of groups) {
      const rawFraction = g.items.length / totalCount;
      const fraction = Math.max(rawFraction, MIN_SECTION_FRACTION);
      sectionMeta.push({ ...g, startAngle: cursor, sweep: availableAngle * fraction });
      cursor += availableAngle * fraction + GAP;
    }
    const totalSweep = sectionMeta.reduce((s, g) => s + g.sweep, 0) + totalGapAngle;
    const scale = totalSweep > 0 ? (Math.PI * 2) / totalSweep : 1;
    cursor = -Math.PI / 2;
    for (const g of sectionMeta) {
      g.startAngle = cursor;
      g.sweep *= scale;
      cursor += g.sweep + GAP * scale;
    }

    for (const g of sectionMeta) {
      const count = g.items.length;
      const numBands = Math.max(1, Math.min(4, Math.ceil(count / 16)));
      g.items.forEach((item, i) => {
        const t = count <= 1 ? 0.5 : i / count;
        const angle = g.startAngle + t * g.sweep;
        const band = i % numBands;
        const baseRadius = 108 + band * (58 / numBands);
        const radius = item.blocked ? boundaryR : baseRadius;
        item.angle = angle;
        item.radius = radius;
        item.x = cx + Math.cos(angle) * radius;
        item.y = cy + Math.sin(angle) * radius;
      });
    }

    const allItems = shown;
    const newKeys = new Set(allItems.map((i) => i.key));
    const prevKeys = new Set(this._perimeterNodes.keys());
    const enteringKeys = new Set([...newKeys].filter((k) => !prevKeys.has(k)));

    if (this._selectedKey && !newKeys.has(this._selectedKey)) {
      this._selectedKey = null;
      this._renderDetailPanel(container, null);
    }

    const nodeMap = new Map(allItems.map((i) => [i.key, i]));
    this._perimeterNodes = nodeMap;

    let chromeG = svg.querySelector('#perimStaticChrome');
    let nodesG = svg.querySelector('#perimNodesLayer');
    if (!chromeG || !nodesG) {
      svg.innerHTML = '<g id="perimStaticChrome"></g><g id="perimNodesLayer"></g>';
      chromeG = svg.querySelector('#perimStaticChrome');
      nodesG = svg.querySelector('#perimNodesLayer');
      this._perimeterNodeEls = new Map();
    }

    let chromeHtml = `
      <circle cx="${cx}" cy="${cy}" r="${boundaryR}" fill="none" stroke="var(--glass-border)" stroke-width="1.5" stroke-dasharray="4 5"/>
      <g>
        <circle cx="${cx}" cy="${cy}" r="30" fill="var(--bg-surface-hover)" stroke="var(--accent-primary)" stroke-width="1.5"/>
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-main)">${escapeHtml(t('firewall.thisPC'))}</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="var(--text-dim)">${allItems.length} shown</text>
      </g>
    `;
    if (sectionMeta.length > 1) {
      for (const g of sectionMeta) {
        const color = this._riskColor(g.risk);
        const midAngle = g.startAngle + g.sweep / 2;
        const labelR = boundaryR + 16;
        const lx = cx + Math.cos(midAngle) * labelR;
        const ly = cy + Math.sin(midAngle) * labelR;
        const dx1 = cx + Math.cos(g.startAngle) * 95, dy1 = cy + Math.sin(g.startAngle) * 95;
        const dx2 = cx + Math.cos(g.startAngle) * (boundaryR + 8), dy2 = cy + Math.sin(g.startAngle) * (boundaryR + 8);
        chromeHtml += `<line x1="${dx1}" y1="${dy1}" x2="${dx2}" y2="${dy2}" stroke="var(--glass-border)" stroke-width="1" stroke-dasharray="2 3"/>`;
        chromeHtml += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="9" font-weight="600" fill="${color}">${sectionLabels[g.risk]} (${g.items.length})</text>`;
      }
    }
    chromeG.innerHTML = chromeHtml;

    for (const item of allItems) {
      const existing = this._perimeterNodeEls.get(item.key);

      if (existing && existing.blocked === item.blocked) {
        this._updatePerimeterNodeEl(existing, item, cx, cy);
        item.particleEl = existing.particleEl;
        continue;
      }

      if (existing) existing.g.remove();
      const entering = enteringKeys.has(item.key) && !existing;
      const el = this._createPerimeterNodeEl(item, cx, cy, entering, container, svg);
      nodesG.appendChild(el.g);
      this._perimeterNodeEls.set(item.key, el);
      item.particleEl = el.particleEl;
    }

    for (const [key, el] of this._perimeterNodeEls) {
      if (!nodeMap.has(key)) {
        el.g.remove();
        this._perimeterNodeEls.delete(key);
      }
    }

    if (summary) {
      const blockedCount = allItems.filter((i) => i.blocked).length;
      const unknownCount = allItems.filter((i) => i.risk === 'UNKNOWN').length;
      const totalConnections = connections.length;
      const filteredCount = withMeta.length;
      const pluralS = totalConnections === 1 ? '' : 's';
      let countText = t('firewall.perimeterSummaryText', { total: totalConnections, s: pluralS, filtered: filteredCount, shown: allItems.length });
      if (hiddenCount > 0) {
        countText += t('firewall.perimeterSummaryHidden', { hidden: hiddenCount });
      }
      summary.textContent = `${countText} · ${blockedCount} ${t('common.blocked')} · ${unknownCount} ${t('common.unverified')}`;
    }
  },

  _createPerimeterNodeEl(item, cx, cy, entering, container, svg) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const color = this._riskColor(item.risk);
    const label = escapeHtml(this._field(item.c, 'processName') || this._field(item.c, 'remoteAddress', 'RemoteAddress') || t('common.unknown'));
    const selected = this._selectedKey === item.key ? 'selected' : '';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `perim-node ${entering ? 'entering' : ''} ${selected}`.trim());
    g.setAttribute('data-key', item.key);
    g.setAttribute('transform-origin', `${item.x}px ${item.y}px`);
    g.style.pointerEvents = 'all';
    // Make keyboard accessible
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', label);

    let inner = `<title>${label}</title>`;
    if (item.blocked) {
      inner += `<circle class="perim-blocked-ring" cx="${item.x}" cy="${item.y}" r="7" fill="none" stroke="${color}" stroke-width="2" pointer-events="all"/>`;
    } else {
      const hubR = 32;
      const lineStartX = cx + Math.cos(item.angle) * hubR;
      const lineStartY = cy + Math.sin(item.angle) * hubR;
      inner += `<line class="perim-line" x1="${lineStartX}" y1="${lineStartY}" x2="${item.x}" y2="${item.y}" stroke="${color}" stroke-width="1" opacity="0.25"/>`;
      inner += `<circle class="perim-particle" data-key="${escapeHtml(item.key)}" cx="${item.x}" cy="${item.y}" r="2.2" fill="${color}" opacity="0.9"/>`;
    }
    inner += `<circle class="perim-hit" r="11" cx="${item.x}" cy="${item.y}" fill="rgba(0,0,0,0)" pointer-events="all"/>`;
    inner += `<circle class="perim-dot" cx="${item.x}" cy="${item.y}" r="6" fill="${color}" pointer-events="all"/>`;
    g.innerHTML = inner;

    const handleNodeClick = () => {
      this._selectedKey = item.key;
      svg.querySelectorAll('.perim-node').forEach((n) => n.classList.remove('selected'));
      g.classList.add('selected');
      this._renderDetailPanel(container, this._perimeterNodes.get(item.key));
    };
    g.querySelector('.perim-hit').addEventListener('click', handleNodeClick);
    g.querySelector('.perim-dot').addEventListener('click', handleNodeClick);

    // Keyboard accessibility: Enter/Space to activate
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNodeClick();
      }
    });

    return {
      g,
      blocked: item.blocked,
      dotEl: g.querySelector('.perim-dot'),
      lineEl: g.querySelector('.perim-line'),
      blockedRingEl: g.querySelector('.perim-blocked-ring'),
      particleEl: g.querySelector('.perim-particle')
    };
  },

  _updatePerimeterNodeEl(existing, item, cx, cy) {
    const color = this._riskColor(item.risk);
    const { g, dotEl, lineEl, blockedRingEl, particleEl } = existing;

    g.classList.toggle('selected', this._selectedKey === item.key);
    g.setAttribute('transform-origin', `${item.x}px ${item.y}px`);

    const hitEl = g.querySelector('.perim-hit');
    if (hitEl) { hitEl.setAttribute('cx', item.x); hitEl.setAttribute('cy', item.y); }

    if (dotEl) {
      dotEl.setAttribute('cx', item.x);
      dotEl.setAttribute('cy', item.y);
      dotEl.setAttribute('fill', color);
    }

    if (item.blocked) {
      if (blockedRingEl) {
        blockedRingEl.setAttribute('cx', item.x);
        blockedRingEl.setAttribute('cy', item.y);
        blockedRingEl.setAttribute('stroke', color);
      }
    } else {
      const hubR = 32;
      const lineStartX = cx + Math.cos(item.angle) * hubR;
      const lineStartY = cy + Math.sin(item.angle) * hubR;
      if (lineEl) {
        lineEl.setAttribute('x1', lineStartX);
        lineEl.setAttribute('y1', lineStartY);
        lineEl.setAttribute('x2', item.x);
        lineEl.setAttribute('y2', item.y);
        lineEl.setAttribute('stroke', color);
      }
      if (particleEl) particleEl.setAttribute('fill', color);
    }

    const titleEl = g.querySelector('title');
    const label = this._field(item.c, 'processName') || this._field(item.c, 'remoteAddress', 'RemoteAddress') || t('common.unknown');
    if (titleEl && titleEl.textContent !== label) titleEl.textContent = label;
  },

  _startParticleLoop(container) {
    if (this._particleRaf) cancelAnimationFrame(this._particleRaf);
    const svg = container.querySelector('#perimeterSvg');
    const cx = 300, cy = 210;
    const hubR = 32;
    const speed = 0.00045;
    const FRAME_INTERVAL_MS = 50;
    let lastFrameTime = 0;
    this._particleVisible = true;

    const loop = (t) => {
      if (!document.body.contains(container)) {
        return;
      }
      if (this._particleVisible && !document.hidden && (t - lastFrameTime) >= FRAME_INTERVAL_MS) {
        lastFrameTime = t;
        for (const [key, item] of this._perimeterNodes) {
          if (item.blocked || !item.particleEl) continue;
          const phase = (key.length * 37) % 1000;
          let frac = ((t * speed) + phase / 1000) % 1;
          const travel = item.direction === 'inbound' ? (1 - frac) : frac;
          const startX = cx + Math.cos(item.angle) * hubR;
          const startY = cy + Math.sin(item.angle) * hubR;
          item.particleEl.setAttribute('cx', startX + (item.x - startX) * travel);
          item.particleEl.setAttribute('cy', startY + (item.y - startY) * travel);
        }
      }
      this._particleRaf = requestAnimationFrame(loop);
    };
    this._particleRaf = requestAnimationFrame(loop);

    if (svg && 'IntersectionObserver' in window) {
      this._particleObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) this._particleVisible = entry.isIntersecting;
      }, { threshold: 0 });
      this._particleObserver.observe(svg);
    }
  },

  _renderDetailPanel(container, item) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const panel = container.querySelector('#connectionDetailPanel');
    if (!panel) return;
    if (!item) {
      panel.innerHTML = `
        <div class="card compact" style="display:flex; flex-direction:column; gap:8px;">
          <div style="font-weight:600; font-size:0.85rem;">${escapeHtml(t('firewall.perimeterDetail'))}</div>
          <div style="font-size:0.78rem; color:var(--text-dim); display:flex; flex-direction:column; gap:6px;">
            <div>${escapeHtml(t('firewall.perimeterDesc1'))}</div>
            <div style="margin-top:6px;">${t('firewall.perimeterDesc2', { unverified: `<span class="glossary-term" title="${escapeHtml(this._glossary('unverified'))}">${escapeHtml(t('common.unverified'))}</span>` })}</div>
            <div><span class="glossary-term" title="${escapeHtml(this._glossary('inbound'))}">${escapeHtml(t('firewall.inbound'))}</span> / <span class="glossary-term" title="${escapeHtml(this._glossary('outbound'))}">${escapeHtml(t('firewall.outbound'))}</span> ${escapeHtml(t('firewall.perimeterDesc3'))}</div>
            <div><span class="glossary-term" title="${escapeHtml(this._glossary('established'))}">${escapeHtml(t('firewall.established'))}</span>, <span class="glossary-term" title="${escapeHtml(this._glossary('listen'))}">${escapeHtml(t('firewall.listen'))}</span>, <span class="glossary-term" title="${escapeHtml(this._glossary('time_wait'))}">${escapeHtml(t('firewall.time_wait'))}</span> ${escapeHtml(t('firewall.perimeterDesc4'))}</div>
          </div>
        </div>`;
      return;
    }
    const c = item.c;
    const remoteAddress = this._field(c, 'remoteAddress', 'RemoteAddress');
    const remotePort = this._field(c, 'remotePort', 'RemotePort');
    const localAddress = this._field(c, 'localAddress', 'LocalAddress');
    const localPort = this._field(c, 'localPort', 'LocalPort');
    const pid = this._field(c, 'pid', 'OwningProcess');
    const processName = this._field(c, 'processName') || t('common.unknownProcess');
    const hostname = this._field(c, 'hostname');
    const service = this._field(c, 'serviceName');
    const state = this._getConnState(c);
    const stateExplain = this._glossary(state.toLowerCase()) || '';
    const risk = item.risk;
    const riskLabel = this._riskLabel(risk);
    const color = this._riskColor(risk);
    const isTrusted = this._trustedIps.includes(remoteAddress);
    const bandwidthEligible = this._isIPv4(localAddress) && this._isIPv4(remoteAddress) && state === 'ESTABLISHED';

    panel.innerHTML = `
      <div class="card compact" style="display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-weight:600;">${escapeHtml(processName)}</span>
          <span class="glossary-term" title="${escapeHtml(risk === 'UNKNOWN' ? this._glossary('unverified') : '')}" style="font-size:0.7rem; font-weight:600; color:${color}; background:${color}15; padding:3px 8px; border-radius:4px;">${riskLabel.toUpperCase()}${item.blocked ? ' · BLOCKED' : ''}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-dim); display:flex; flex-direction:column; gap:4px;">
          <div>${escapeHtml(t('firewall.detailRemote', { ip: remoteAddress, port: remotePort }))}${hostname ? ` (${escapeHtml(hostname)})` : ''}</div>
          ${service ? `<div>${escapeHtml(t('firewall.detailService', { service }))}</div>` : ''}
          <div>${escapeHtml(t('firewall.detailLocal', { ip: localAddress, port: localPort }))}</div>
          <div>${escapeHtml(t('firewall.detailDirection', { direction: item.direction === 'inbound' ? t('firewall.detailDirectionIn') : t('firewall.detailDirectionOut'), est: t('firewall.detailDirectionEst') }))}</div>
          <div>${escapeHtml(t('firewall.detailState', { state }))}</div>
          <div>${escapeHtml(t('firewall.detailPid', { pid: pid ? escapeHtml(pid) : t('common.unknown') }))}</div>
          ${bandwidthEligible
            ? `<div id="detailBandwidthResult" style="opacity:0.85;">${escapeHtml(t('firewall.detailBandwidthNotMeasured'))}</div>`
            : !this._isIPv4(localAddress) || !this._isIPv4(remoteAddress)
              ? `<div style="opacity:0.7;">${escapeHtml(t('firewall.detailBandwidthIpv6'))}</div>`
              : `<div style="opacity:0.7;">${escapeHtml(t('firewall.detailBandwidthState', { state }))}</div>`
          }
        </div>
        <div id="detailWhoisResult" style="font-size:0.78rem; color:var(--text-dim);"></div>
        <div id="detailProcessResult" style="font-size:0.78rem; color:var(--text-dim);"></div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
          ${bandwidthEligible
            ? `<button class="btn btn-sm" data-action="bandwidth" title="${escapeHtml(t('firewall.bandwidthTooltip'))}">${escapeHtml(t('firewall.measureBandwidth'))}</button>`
            : ''
          }
          <button class="btn btn-sm" data-action="block-conn">${escapeHtml(t('firewall.blockConnection'))}</button>
          <button class="btn btn-sm" data-action="block-ip">${escapeHtml(t('firewall.blockIp'))}</button>
          <button class="btn btn-sm" data-action="block-app" ${pid ? '' : 'disabled'}>${escapeHtml(t('firewall.blockApp'))}</button>
          <button class="btn btn-sm" data-action="trust">${escapeHtml(isTrusted ? t('firewall.untrust') : t('firewall.trust'))}</button>
          <button class="btn btn-sm" data-action="whois" title="${escapeHtml(this._glossary('whois'))}">${escapeHtml(t('firewall.whois'))}</button>
          <button class="btn btn-sm" data-action="process" ${pid ? '' : 'disabled'}>${escapeHtml(t('firewall.viewProcess'))}</button>
        </div>
      </div>
    `;

    panel.querySelector('[data-action="block-conn"]').addEventListener('click', () => this._blockConnection(container, c));
    panel.querySelector('[data-action="block-ip"]').addEventListener('click', () => this._blockIp(container, remoteAddress));
    panel.querySelector('[data-action="block-app"]').addEventListener('click', () => this._blockApp(container, pid, processName));
    panel.querySelector('[data-action="trust"]').addEventListener('click', () => this._toggleTrust(container, remoteAddress, isTrusted));
    panel.querySelector('[data-action="whois"]').addEventListener('click', () => this._runWhois(container, remoteAddress));
    panel.querySelector('[data-action="process"]').addEventListener('click', () => this._showProcessDetails(container, pid));
    const bandwidthBtn = panel.querySelector('[data-action="bandwidth"]');
    if (bandwidthBtn) {
      bandwidthBtn.addEventListener('click', () => this._measureBandwidth(container, bandwidthBtn, {
        localAddress, localPort, remoteAddress, remotePort
      }));
    }
  },

  _renderConnectionsTable(container, connections) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const tableEl = container.querySelector('#connTableContainer');
    const countEl = container.querySelector('#connTableCount');
    if (!tableEl) return;

    const withMeta = connections
      .map((c) => {
        const key = this._connKey(c);
        const risk = this._classifyRisk(c, key);
        return { c, key, risk };
      })
      .filter((item) => this._matchesFilters(item.c, item.risk));

    if (countEl) countEl.textContent = `${withMeta.length} of ${connections.length}`;

    if (!withMeta.length) {
      tableEl.innerHTML = `<div class="empty-state">${escapeHtml(t('firewall.noConnectionsMatch'))}</div>`;
      return;
    }

    tableEl.innerHTML = withMeta.slice(0, 400).map((item) => {
      const c = item.c;
      const color = this._riskColor(item.risk);
      const remoteAddress = this._field(c, 'remoteAddress', 'RemoteAddress');
      const remotePort = this._field(c, 'remotePort', 'RemotePort');
      const processName = this._field(c, 'processName') || '(unknown process)';
      const localPort = this._field(c, 'localPort', 'LocalPort');
      const direction = this._getDirection(c, localPort, remotePort);
      const state = this._getConnState(c);
      return `<div class="log-row" data-conn-key="${escapeHtml(item.key)}" style="display:flex; align-items:center; gap:10px; cursor:pointer; content-visibility:auto; contain-intrinsic-size: 0 30px;">
        <span class="log-tag" style="background:${color}22; color:${color};">${this._riskLabel(item.risk)}</span>
        <span class="log-tag info">${direction === 'inbound' ? 'IN' : 'OUT'}</span>
        <span class="log-path" style="flex:1;">${escapeHtml(processName)} — ${escapeHtml(remoteAddress)}:${escapeHtml(remotePort)}</span>
        <span style="font-size:0.72rem; color:var(--text-dim);">${escapeHtml(state)}</span>
      </div>`;
    }).join('');

    tableEl.querySelectorAll('[data-conn-key]').forEach((row) => {
      row.addEventListener('click', () => {
        const key = row.getAttribute('data-conn-key');
        const node = this._perimeterNodes.get(key);
        if (node) {
          this._selectedKey = key;
          const svg = container.querySelector('#perimeterSvg');
          if (svg) {
            svg.querySelectorAll('.perim-node').forEach((n) => n.classList.remove('selected'));
            const match = svg.querySelector(`[data-key="${CSS.escape(key)}"]`);
            if (match) match.classList.add('selected');
          }
          this._renderDetailPanel(container, node);
        } else {
          const found = withMeta.find((m) => m.key === key);
          if (found) this._renderDetailPanel(container, { ...found, direction: this._getDirection(found.c, this._field(found.c, 'localPort', 'LocalPort'), this._field(found.c, 'remotePort', 'RemotePort')), blocked: found.risk === 'MALICIOUS' });
        }
      });
    });
  },

  async _blockConnection(container, c) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const remoteAddress = this._field(c, 'remoteAddress', 'RemoteAddress');
    const remotePort = this._field(c, 'remotePort', 'RemotePort');
    if (!window.confirm(t('firewall.confirmBlockConn', { ip: remoteAddress, port: remotePort }))) return;
    try {
      await window.api.invoke('firewall:createRule', {
        name: `Block ${remoteAddress}:${remotePort} (Out)`, direction: 'Outbound', action: 'Block',
        protocol: 'TCP', remoteAddress, remotePort
      });
      await window.api.invoke('firewall:createRule', {
        name: `Block ${remoteAddress}:${remotePort} (In)`, direction: 'Inbound', action: 'Block',
        protocol: 'TCP', remoteAddress, remotePort
      });
      alert(t('firewall.ruleCreated'));
      this._initRuleList(container);
      this._refreshSummary(container);
    } catch (e) { alert(this._friendlyError(e, t('firewall.failedCreateRule'))); }
  },

  async _blockIp(container, ip) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    if (!window.confirm(t('firewall.confirmBlockIp', { ip }))) return;
    try {
      await window.api.invoke('firewall:createRule', { name: `Block IP ${ip} (Out)`, direction: 'Outbound', action: 'Block', remoteAddress: ip });
      await window.api.invoke('firewall:createRule', { name: `Block IP ${ip} (In)`, direction: 'Inbound', action: 'Block', remoteAddress: ip });
      alert(t('firewall.ipBlocked'));
      this._initRuleList(container);
      this._refreshSummary(container);
    } catch (e) { alert(this._friendlyError(e, t('firewall.failedBlockIp'))); }
  },

  _findProcessPath(proc) {
    if (!proc) return null;
    const candidates = [
      'path', 'execPath', 'exe', 'exePath', 'filePath', 'fullPath', 'processPath', 'image', 'imagePath',
      'ExecutablePath', 'FilePath', 'FullPath', 'ProcessPath', 'ImagePath', 'Path', 'CommandLine', 'commandLine'
    ];
    for (const key of candidates) {
      if (proc[key]) return proc[key];
    }
    return null;
  },

  async _blockApp(container, pid, processName) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    try {
      const processes = await window.api.invoke('process:list');
      const proc = (processes || []).find((p) => String(p.pid ?? p.Pid ?? p.PID) === String(pid));
      const programPath = this._findProcessPath(proc);
      if (!programPath) { alert(t('firewall.noProcessPath')); return; }
      if (!window.confirm(t('firewall.confirmBlockApp', { name: processName, path: programPath }))) return;
      await window.api.invoke('firewall:createRule', { name: `Block App ${processName} (Out)`, direction: 'Outbound', action: 'Block', program: programPath });
      await window.api.invoke('firewall:createRule', { name: `Block App ${processName} (In)`, direction: 'Inbound', action: 'Block', program: programPath });
      alert(t('firewall.appBlocked'));
      this._initRuleList(container);
      this._refreshSummary(container);
    } catch (e) { alert(this._friendlyError(e, t('firewall.failedBlockApp'))); }
  },

  async _toggleTrust(container, ip, currentlyTrusted) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    try {
      this._trustedIps = currentlyTrusted
        ? await window.api.invoke('firewall:untrustConnection', ip)
        : await window.api.invoke('firewall:trustConnection', ip);
      if (this._selectedKey) this._renderDetailPanel(container, this._perimeterNodes.get(this._selectedKey));
    } catch (e) { alert(this._friendlyError(e, t('firewall.failedTrust'))); }
  },

  async _measureBandwidth(container, btn, spec) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const target = container.querySelector('#detailBandwidthResult');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('firewall.measuringBandwidth');
    if (target) target.textContent = t('firewall.measuringBandwidth');
    try {
      const result = await window.api.invoke('network:measureBandwidth', spec);
      if (target) {
        target.innerHTML = `${t('firewall.bandwidthResult', { out: result.outboundKBps.toFixed(1), in: result.inboundKBps.toFixed(1) })}`;
      }
    } catch (e) {
      if (target) target.textContent = this._friendlyError(e, t('firewall.bandwidthFailed'));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  },

  async _runWhois(container, ip) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const target = container.querySelector('#detailWhoisResult');
    if (target) target.textContent = t('firewall.whoisLookingUp');
    try {
      const info = await window.api.invoke('network:whois', ip);
      if (!target) return;
      if (!info || !info.found) { target.textContent = t('firewall.whoisNoData'); return; }
      target.innerHTML = `${t('firewall.whoisResult', { org: escapeHtml(info.org || info.isp || t('common.unknownOrg')), city: escapeHtml(info.city || ''), cityCountry: info.city && info.country ? ', ' : '', country: escapeHtml(info.country || '') })}`;
    } catch (e) {
      if (target) target.textContent = this._friendlyError(e, t('firewall.whoisFailed'));
    }
  },

  async _showProcessDetails(container, pid) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const target = container.querySelector('#detailProcessResult');
    if (target) target.textContent = t('firewall.processLoading');
    try {
      const processes = await window.api.invoke('process:list');
      const proc = (processes || []).find((p) => String(p.pid ?? p.Pid ?? p.PID) === String(pid));
      if (!target) return;
      if (!proc) { target.textContent = t('firewall.processNotFound'); return; }
      const path = this._findProcessPath(proc);
      const mem = proc.memory;
      const pathHtml = path
        ? `${t('firewall.processPath', { path: escapeHtml(path) })}`
        : t('firewall.processPathUnavailable');
      target.innerHTML = `${pathHtml}${mem !== undefined ? ` ${t('firewall.processMemory', { mem: escapeHtml(mem.toFixed ? mem.toFixed(1) : String(mem)) })}` : ''}`;
    } catch (e) {
      if (target) target.textContent = this._friendlyError(e, t('firewall.failedProcessDetails'));
    }
  },

  _wireImportExport(container) {
    const exportBtn = container.querySelector('#exportFirewallRulesBtn');
    const importBtn = container.querySelector('#importFirewallRulesBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        exportBtn.disabled = true;
        try {
          const res = await window.api.invoke('firewall:exportRules');
          if (!res || res.canceled) return;
          alert(`Exported ${res.count} Soterios-managed rule(s) to:\n${res.path}`);
        } catch (e) {
          alert(this._friendlyError(e, 'Failed to export firewall rules.'));
        } finally {
          exportBtn.disabled = false;
        }
      });
    }
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        const choice = window.prompt(
          'If an imported rule already exists, choose conflict handling:\nskip / overwrite / rename',
          'skip'
        );
        if (choice === null) return;
        const onConflict = ['skip', 'overwrite', 'rename'].includes(String(choice).trim().toLowerCase())
          ? String(choice).trim().toLowerCase()
          : 'skip';
        importBtn.disabled = true;
        try {
          const res = await window.api.invoke('firewall:importRules', { onConflict });
          if (!res || res.canceled) return;
          const errNote = res.errors && res.errors.length
            ? `\nErrors:\n- ${res.errors.slice(0, 5).join('\n- ')}`
            : '';
          alert(
            `Import finished.\nCreated: ${res.created}\nSkipped: ${res.skipped}\nOverwritten: ${res.overwritten}\nRenamed: ${res.renamed}${errNote}`
          );
          await this._initRuleList(container);
          this._refreshSummary(container);
        } catch (e) {
          alert(this._friendlyError(e, 'Failed to import firewall rules.'));
        } finally {
          importBtn.disabled = false;
        }
      });
    }
  },

  async _initRuleList(container) {
    const listEl = container.querySelector('#ruleListContainer');
    const searchInput = container.querySelector('#ruleSearchInput');
    const actionSelect = container.querySelector('#ruleActionFilter');
    const directionSelect = container.querySelector('#ruleDirectionFilter');
    if (!listEl) return;

    const applyFilters = () => {
      const q = (this._ruleQuery || '').trim().toLowerCase();
      const action = this._ruleActionFilter || 'all';
      const direction = this._ruleDirectionFilter || 'all';
      const filtered = this._ruleCache.filter((r) => {
        const matchesSearch = !q || (r.name || '').toLowerCase().includes(q) || (r.program || '').toLowerCase().includes(q) || (r.remoteAddress || '').toLowerCase().includes(q);
        const matchesAction = action === 'all' || r.action === action;
        const matchesDirection = direction === 'all' || r.direction === direction;
        return matchesSearch && matchesAction && matchesDirection;
      });
      this._renderRuleList(container, filtered);
    };

    try {
      this._ruleCache = (await window.api.invoke('firewall:listRules')) || [];
      applyFilters();
    } catch (e) {
      listEl.innerHTML = `<div class="empty-state">Error loading rules: ${escapeHtml(this._friendlyError(e, 'Unable to load rules.'))}</div>`;
      return;
    }
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this._ruleQuery = searchInput.value;
        applyFilters();
      });
    }
    if (actionSelect) {
      actionSelect.addEventListener('change', () => {
        this._ruleActionFilter = actionSelect.value;
        applyFilters();
      });
    }
    if (directionSelect) {
      directionSelect.addEventListener('change', () => {
        this._ruleDirectionFilter = directionSelect.value;
        applyFilters();
      });
    }
  },

  _renderRuleList(container, rules) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const listEl = container.querySelector('#ruleListContainer');
    if (!listEl) return;
    if (!rules.length) {
      listEl.innerHTML = `<div class="empty-state">${escapeHtml(t('firewall.noMatchingRules'))}</div>`;
      return;
    }
    listEl.innerHTML = rules.slice(0, 300).map((r) => {
      const actionColor = r.action === 'Allow' ? 'var(--ok)' : 'var(--danger)';
      const dirLabel = r.direction === 'Inbound' ? 'IN' : 'OUT';
      return `<div class="log-row" style="display:flex; align-items:center; gap:10px; content-visibility:auto; contain-intrinsic-size: 0 30px; ${r.enabled ? '' : 'opacity:0.5;'}">
        <span class="log-tag" style="background:${actionColor}22; color:${actionColor};">${escapeHtml(r.action || '')}</span>
        <span class="log-tag info">${dirLabel}</span>
        <span class="log-path" style="flex:1;">${escapeHtml(r.name || '')}${r.program ? ` — ${escapeHtml(r.program)}` : ''}${r.remoteAddress ? ` — ${escapeHtml(r.remoteAddress)}` : ''}</span>
        ${r.managedByApp ? `
          <button class="btn btn-sm" data-rule-toggle="${escapeHtml(r.name)}" data-enabled="${r.enabled}">${escapeHtml(r.enabled ? t('firewall.ruleDisable') : t('firewall.ruleEnable'))}</button>
          <button class="btn btn-sm" style="color:var(--accent-danger);" data-rule-delete="${escapeHtml(r.name)}">${escapeHtml(t('firewall.ruleDelete'))}</button>
        ` : ''}
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-rule-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.getAttribute('data-rule-toggle');
        const enabled = btn.getAttribute('data-enabled') === 'true';
        try {
          await window.api.invoke('firewall:setRuleEnabled', { name, enabled: !enabled });
          this._initRuleList(container);
          this._refreshSummary(container);
        } catch (e) { alert(this._friendlyError(e, t('firewall.failedToggleRule'))); }
      });
    });
    listEl.querySelectorAll('[data-rule-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.getAttribute('data-rule-delete');
        if (!window.confirm(t('firewall.confirmDeleteRule', { name }))) return;
        try {
          await window.api.invoke('firewall:deleteRule', name);
          this._initRuleList(container);
          this._refreshSummary(container);
        } catch (e) { alert(this._friendlyError(e, t('firewall.failedDeleteRule'))); }
      });
    });
  }
};