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
    html += '<div class="grid grid-3">';
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
          <div style="flex:2; min-width:320px;" id="perimeterVisualContainer">
            <svg id="perimeterSvg" class="perimeter-radar" viewBox="0 0 600 420" style="width:100%; height:auto; display:block;"></svg>
            <div style="display:flex; justify-content:center; gap:20px; margin-top:10px; flex-wrap:wrap; font-size:0.78rem; color:var(--text-dim);">
              <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ok);margin-right:5px;"></span>${escapeHtml(t('firewall.legendAllowed'))}</span>
              <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--warn);margin-right:5px;"></span>${escapeHtml(t('firewall.legendUnverified'))}</span>
              <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--danger);margin-right:5px;"></span>${escapeHtml(t('firewall.legendBlocked'))}</span>
            </div>
          </div>
          <div style="flex:1; min-width:270px; max-width:340px; display:flex; flex-direction:column; gap:8px;" id="connectionDetailPanel">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <span style="font-weight:600; font-size:0.85rem;">${escapeHtml(t('firewall.whatAmILookingAt'))}</span>
            </div>
            <div id="connectionDetailContent"></div>
          </div>
        </div>
        <div style="display:flex; justify-content:center; margin-top:12px;">
          <button class="btn btn-sm btn-ghost" id="minimizeDetailBtn" style="padding:4px 8px; font-size:0.75rem;">${escapeHtml(t('common.minimize'))}</button>
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
      window.DashboardCache?.invalidate?.();
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
  _perimeterActivity: new Map(),
  _perimeterConnToGroup: new Map(),
  _selectedKey: null,
  _trustedIps: [],
  _lastConnections: [],
  _searchQuery: '',
  _riskFilter: { SAFE: true, UNKNOWN: true, MALICIOUS: true },
  _directionFilter: 'all',
  _processFilter: 'all',
  _maxVisualNodes: 50,

  _riskRank(risk) {
    return risk === 'MALICIOUS' ? 3 : risk === 'UNKNOWN' ? 2 : 1;
  },

  _stableHash(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  },

  _endpointGroupKey(c) {
    const pid = this._field(c, 'pid', 'OwningProcess');
    const processName = this._field(c, 'processName') || 'unknown';
    const remoteAddress = this._field(c, 'remoteAddress', 'RemoteAddress') || 'unknown';
    return `${pid || processName}|${remoteAddress}`;
  },

  _aggregatePerimeterEndpoints(connections, applyFilters = true) {
    const groups = new Map();
    if (applyFilters) this._perimeterConnToGroup = new Map();

    for (const c of connections || []) {
      const connKey = this._connKey(c);
      const memberRisk = this._classifyRisk(c, connKey);
      if (applyFilters && !this._matchesFilters(c, memberRisk)) continue;

      const key = this._endpointGroupKey(c);
      const localPort = this._field(c, 'localPort', 'LocalPort');
      const remotePort = this._field(c, 'remotePort', 'RemotePort');
      const direction = this._getDirection(c, localPort, remotePort);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          c,
          members: [],
          risk: memberRisk,
          processName: this._field(c, 'processName') || this.t('network.unknownProcess'),
          pid: this._field(c, 'pid', 'OwningProcess'),
          remoteAddress: this._field(c, 'remoteAddress', 'RemoteAddress'),
          hostname: this._field(c, 'hostname'),
          services: new Set(),
          states: new Set(),
          directions: new Set(),
          count: 0
        };
        groups.set(key, group);
      }
      group.members.push(c);
      group.count++;
      group.directions.add(direction);
      const service = this._field(c, 'serviceName');
      const state = this._getConnState(c);
      if (service) group.services.add(service);
      if (state) group.states.add(state);
      if (!group.hostname && this._field(c, 'hostname')) group.hostname = this._field(c, 'hostname');
      if (this._riskRank(memberRisk) > this._riskRank(group.risk)) group.risk = memberRisk;
      if (applyFilters) this._perimeterConnToGroup.set(connKey, key);
    }

    for (const group of groups.values()) {
      group.direction = group.directions.size > 1 ? 'mixed' : [...group.directions][0] || 'outbound';
      group.blocked = group.risk === 'MALICIOUS';
      group.nodeRadius = Math.min(13, 6 + Math.log2(group.count + 1) * 2.2);
      group.edgeWidth = Math.min(2.6, 0.8 + Math.log2(group.count + 1) * 0.45);
    }
    return [...groups.values()];
  },

  _recordPerimeterActivity(connections, now = Date.now()) {
    const groups = this._aggregatePerimeterEndpoints(connections, false);
    const current = new Map(groups.map((group) => [group.key, group]));
    const staleAfterMs = 10 * 60 * 1000;

    for (const [key, activity] of this._perimeterActivity) {
      const group = current.get(key);
      const previous = activity.samples[activity.samples.length - 1];
      if (!group) {
        activity.samples.push({ at: now, count: 0, risk: activity.lastRisk });
        activity.samples = activity.samples.slice(-20);
        activity.activeSince = null;
        if (now - activity.lastSeen > staleAfterMs) this._perimeterActivity.delete(key);
        continue;
      }
      if (!previous || previous.count === 0 || activity.activeSince == null) activity.activeSince = now;
      activity.lastSeen = now;
      activity.lastRisk = group.risk;
      activity.samples.push({ at: now, count: group.count, risk: group.risk });
      activity.samples = activity.samples.slice(-20);
      current.delete(key);
    }

    for (const group of current.values()) {
      this._perimeterActivity.set(group.key, {
        firstSeen: now,
        activeSince: now,
        lastSeen: now,
        lastRisk: group.risk,
        samples: [{ at: now, count: group.count, risk: group.risk }]
      });
    }
  },

  _layoutPerimeterGroups(groups, cx = 300, cy = 210) {
    const ringSpec = {
      SAFE: { radii: [76, 96, 112] },
      UNKNOWN: { radii: [128, 145] },
      MALICIOUS: { radii: [174, 190] }
    };
    return groups.map((group) => {
      const processKey = `${group.pid || group.processName}`;
      const processAngle = (this._stableHash(processKey) / 0x100000000) * Math.PI * 2 - Math.PI / 2;
      const endpointJitter = ((this._stableHash(group.key) % 1001) / 1000 - 0.5) * 0.42;
      const spec = ringSpec[group.risk] || ringSpec.UNKNOWN;
      const band = this._stableHash(`${group.key}|band`) % spec.radii.length;
      const radius = spec.radii[band];
      const angle = processAngle + endpointJitter;
      return {
        ...group,
        angle,
        radius,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius
      };
    });
  },

  _orderPerimeterEndpoints(groups) {
    const priority = { MALICIOUS: 0, UNKNOWN: 1, SAFE: 2 };
    return [...(groups || [])].sort((a, b) => (
      priority[a.risk] - priority[b.risk] || b.count - a.count || a.key.localeCompare(b.key)
    ));
  },

  _formatObservedDuration(ms) {
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (seconds < 60) return this.t('firewall.perimeterDurationSeconds', { count: seconds });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return this.t('firewall.perimeterDurationMinutes', { count: minutes });
    return this.t('firewall.perimeterDurationHours', { count: Math.floor(minutes / 60) });
  },

  _activitySparkline(samples, width = 220, height = 42) {
    const values = (samples || []).map((sample) => Number(sample.count) || 0);
    if (!values.length) return '';
    const max = Math.max(1, ...values);
    return values.map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y = height - 4 - (value / max) * (height - 8);
      return `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  },

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

    const minimizeBtn = container.querySelector('#minimizeDetailBtn');
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => {
        const detailPanel = container.querySelector('#connectionDetailPanel');
        const visualContainer = container.querySelector('#perimeterVisualContainer');
        if (!detailPanel || !visualContainer) return;
        
        const isMinimized = detailPanel.style.display === 'none';
        detailPanel.style.display = isMinimized ? 'flex' : 'none';
        minimizeBtn.textContent = isMinimized ? (window.I18n?.t('common.minimize') ?? 'Minimize') : (window.I18n?.t('common.expand') ?? 'Expand');
        
        if (!isMinimized) {
          visualContainer.style.flex = '1';
          visualContainer.style.margin = '0 auto';
          visualContainer.style.maxWidth = '600px';
        } else {
          visualContainer.style.flex = '2';
          visualContainer.style.margin = '';
          visualContainer.style.maxWidth = '';
        }
      });
    }

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
    this._recordPerimeterActivity(connections);
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
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const names = [...new Set(connections.map((c) => this._field(c, 'processName') || t('common.unknown')))].sort();
    const previousValue = select.value;
    select.innerHTML = `<option value="all">${escapeHtml(t('common.all'))}</option>` + names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
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
    const boundaryR = 158;
    const endpointGroups = this._orderPerimeterEndpoints(this._aggregatePerimeterEndpoints(connections, true));
    const cap = Number.isFinite(this._maxVisualNodes) ? this._maxVisualNodes : endpointGroups.length;
    const allItems = this._layoutPerimeterGroups(endpointGroups.slice(0, cap), cx, cy);
    const hiddenCount = Math.max(0, endpointGroups.length - allItems.length);

    for (const item of allItems) item.activity = this._perimeterActivity.get(item.key) || null;
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

    const socketsShown = allItems.reduce((sum, item) => sum + item.count, 0);
    const chromeHtml = `
      <circle class="perim-risk-band perim-risk-band-safe" cx="${cx}" cy="${cy}" r="114"/>
      <circle class="perim-risk-band perim-risk-band-unknown" cx="${cx}" cy="${cy}" r="149"/>
      <circle class="perim-boundary-glow" cx="${cx}" cy="${cy}" r="${boundaryR}"/>
      <circle class="perim-boundary" cx="${cx}" cy="${cy}" r="${boundaryR}"/>
      <text class="perim-ring-label perim-ring-label-safe" x="${cx}" y="${cy - 116}" text-anchor="middle">${escapeHtml(t('firewall.perimeterBandSafe'))}</text>
      <text class="perim-ring-label perim-ring-label-unknown" x="${cx}" y="${cy - 151}" text-anchor="middle">${escapeHtml(t('firewall.perimeterBandUnknown'))}</text>
      <text class="perim-ring-label perim-ring-label-malicious" x="${cx}" y="${cy - 184}" text-anchor="middle">${escapeHtml(t('firewall.perimeterBandMalicious'))}</text>
      <g class="perim-hub">
        <circle cx="${cx}" cy="${cy}" r="34"/>
        <circle class="perim-hub-core" cx="${cx}" cy="${cy}" r="27"/>
        <text x="${cx}" y="${cy - 3}" text-anchor="middle">${escapeHtml(t('firewall.thisPC'))}</text>
        <text class="perim-hub-count" x="${cx}" y="${cy + 12}" text-anchor="middle">${escapeHtml(t('firewall.perimeterHubCount', { endpoints: allItems.length, sockets: socketsShown }))}</text>
      </g>`;
    chromeG.innerHTML = chromeHtml;

    for (const item of allItems) {
      const existing = this._perimeterNodeEls.get(item.key);

      if (existing) {
        this._updatePerimeterNodeEl(existing, item, cx, cy);
        item.particleEls = existing.particleEls;
        continue;
      }

      const entering = enteringKeys.has(item.key);
      const el = this._createPerimeterNodeEl(item, cx, cy, entering, container, svg);
      nodesG.appendChild(el.g);
      this._perimeterNodeEls.set(item.key, el);
      item.particleEls = el.particleEls;
    }

    for (const [key, el] of this._perimeterNodeEls) {
      if (!nodeMap.has(key)) {
        this._perimeterNodeEls.delete(key);
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          el.g.remove();
        } else {
          el.g.classList.add('leaving');
          el.g.addEventListener('animationend', () => el.g.remove(), { once: true });
        }
      }
    }

    if (this._selectedKey && nodeMap.has(this._selectedKey)) {
      this._renderDetailPanel(container, nodeMap.get(this._selectedKey));
    }

    if (summary) {
      const blockedCount = allItems.filter((i) => i.blocked).length;
      const unknownCount = allItems.filter((i) => i.risk === 'UNKNOWN').length;
      const totalConnections = connections.length;
      let countText = t('firewall.perimeterEndpointSummary', {
        total: totalConnections,
        endpoints: endpointGroups.length,
        shown: allItems.length
      });
      if (hiddenCount > 0) {
        countText += t('firewall.perimeterSummaryHidden', { hidden: hiddenCount });
      }
      summary.textContent = `${countText} · ${blockedCount} ${t('common.blocked')} · ${unknownCount} ${t('common.unverified')}`;
    }
  },

  _createPerimeterNodeEl(item, cx, cy, entering, container, svg) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const color = this._riskColor(item.risk);
    const label = t('firewall.perimeterNodeAria', {
      process: item.processName,
      address: item.remoteAddress,
      count: item.count,
      risk: this._riskLabel(item.risk)
    });
    const selected = this._selectedKey === item.key ? 'selected' : '';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `perim-node direction-${item.direction} ${item.blocked ? 'is-blocked' : ''} ${entering ? 'entering' : ''} ${selected}`.trim());
    g.setAttribute('data-key', item.key);
    g.style.transform = `translate(${item.x}px, ${item.y}px)`;
    g.style.pointerEvents = 'all';
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', label);

    const edgeStartR = item.blocked ? 158 : 34;
    const startX = cx + Math.cos(item.angle) * edgeStartR - item.x;
    const startY = cy + Math.sin(item.angle) * edgeStartR - item.y;
    g.innerHTML = `
      <title>${escapeHtml(label)}</title>
      <line class="perim-line" x1="${startX}" y1="${startY}" x2="0" y2="0" stroke="${color}" stroke-width="${item.edgeWidth}"/>
      <circle class="perim-particle perim-particle-a" data-key="${escapeHtml(item.key)}" cx="${startX}" cy="${startY}" r="2.2" fill="${color}"/>
      <circle class="perim-particle perim-particle-b" data-key="${escapeHtml(item.key)}" cx="0" cy="0" r="2.2" fill="${color}"/>
      <circle class="perim-blocked-ring" cx="0" cy="0" r="${item.nodeRadius + 3}" stroke="${color}"/>
      <g class="perim-node-core">
        <circle class="perim-hit" r="${Math.max(13, item.nodeRadius + 5)}" cx="0" cy="0"/>
        <circle class="perim-dot" cx="0" cy="0" r="${item.nodeRadius}" fill="${color}"/>
        <text class="perim-node-count" x="0" y="3">${item.count > 1 ? item.count : ''}</text>
      </g>`;

    const handleNodeClick = () => {
      this._selectedKey = item.key;
      svg.querySelectorAll('.perim-node').forEach((n) => n.classList.remove('selected'));
      g.classList.add('selected');
      this._renderDetailPanel(container, this._perimeterNodes.get(item.key));
    };
    g.addEventListener('click', handleNodeClick);

    // Keyboard accessibility: Enter/Space to activate
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleNodeClick();
      }
    });

    return {
      g,
      dotEl: g.querySelector('.perim-dot'),
      lineEl: g.querySelector('.perim-line'),
      blockedRingEl: g.querySelector('.perim-blocked-ring'),
      countEl: g.querySelector('.perim-node-count'),
      particleEls: Array.from(g.querySelectorAll('.perim-particle'))
    };
  },

  _updatePerimeterNodeEl(existing, item, cx, cy) {
    const color = this._riskColor(item.risk);
    const { g, dotEl, lineEl, blockedRingEl, countEl, particleEls } = existing;

    g.classList.toggle('selected', this._selectedKey === item.key);
    g.classList.toggle('is-blocked', item.blocked);
    ['inbound', 'outbound', 'mixed'].forEach((direction) => {
      g.classList.toggle(`direction-${direction}`, item.direction === direction);
    });
    g.style.transform = `translate(${item.x}px, ${item.y}px)`;

    if (dotEl) {
      dotEl.setAttribute('fill', color);
      dotEl.setAttribute('r', item.nodeRadius);
    }

    if (blockedRingEl) {
      blockedRingEl.setAttribute('r', item.nodeRadius + 3);
      blockedRingEl.setAttribute('stroke', color);
    }
    const edgeStartR = item.blocked ? 158 : 34;
    const startX = cx + Math.cos(item.angle) * edgeStartR - item.x;
    const startY = cy + Math.sin(item.angle) * edgeStartR - item.y;
    if (lineEl) {
      lineEl.setAttribute('x1', startX);
      lineEl.setAttribute('y1', startY);
      lineEl.setAttribute('stroke', color);
      lineEl.setAttribute('stroke-width', item.edgeWidth);
    }
    for (const particleEl of particleEls || []) {
      particleEl.setAttribute('fill', color);
    }
    if (countEl) countEl.textContent = item.count > 1 ? item.count : '';

    const titleEl = g.querySelector('title');
    const label = this.t('firewall.perimeterNodeAria', {
      process: item.processName,
      address: item.remoteAddress,
      count: item.count,
      risk: this._riskLabel(item.risk)
    });
    if (titleEl && titleEl.textContent !== label) titleEl.textContent = label;
    g.setAttribute('aria-label', label);
  },

  _startParticleLoop(container) {
    if (this._particleRaf) cancelAnimationFrame(this._particleRaf);
    if (this._particleObserver) {
      this._particleObserver.disconnect();
      this._particleObserver = null;
    }
    const svg = container.querySelector('#perimeterSvg');
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const cx = 300, cy = 210;
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
          if (item.blocked || !item.particleEls?.length) continue;
          const hubR = 34;
          const phase = (key.length * 37) % 1000;
          const frac = ((t * speed) + phase / 1000) % 1;
          const startX = cx + Math.cos(item.angle) * hubR;
          const startY = cy + Math.sin(item.angle) * hubR;
          const travels = item.direction === 'mixed'
            ? [frac, 1 - ((frac + 0.42) % 1)]
            : [item.direction === 'inbound' ? 1 - frac : frac];
          item.particleEls.forEach((particle, index) => {
            if (index >= travels.length) return;
            const travel = travels[index];
            particle.setAttribute('cx', startX + (item.x - startX) * travel - item.x);
            particle.setAttribute('cy', startY + (item.y - startY) * travel - item.y);
          });
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
    const contentDiv = container.querySelector('#connectionDetailContent');
    if (!panel) return;
    if (!item) {
      if (contentDiv) {
        contentDiv.innerHTML = `
          <div class="card compact" style="display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:0.78rem; color:var(--text-dim); display:flex; flex-direction:column; gap:6px;">
              <div>${escapeHtml(t('firewall.perimeterDesc1'))}</div>
              <div style="margin-top:6px;">${t('firewall.perimeterDesc2', { unverified: `<span class="glossary-term" title="${escapeHtml(this._glossary('unverified'))}">${escapeHtml(t('common.unverified'))}</span>` })}</div>
              <div><span class="glossary-term" title="${escapeHtml(this._glossary('inbound'))}">${escapeHtml(t('firewall.inbound'))}</span> / <span class="glossary-term" title="${escapeHtml(this._glossary('outbound'))}">${escapeHtml(t('firewall.outbound'))}</span> ${escapeHtml(t('firewall.perimeterDesc3'))}</div>
              <div><span class="glossary-term" title="${escapeHtml(this._glossary('established'))}">${escapeHtml(t('firewall.established'))}</span>, <span class="glossary-term" title="${escapeHtml(this._glossary('listen'))}">${escapeHtml(t('firewall.listen'))}</span>, <span class="glossary-term" title="${escapeHtml(this._glossary('time_wait'))}">${escapeHtml(t('firewall.time_wait'))}</span> ${escapeHtml(t('firewall.perimeterDesc4'))}</div>
            </div>
          </div>`;
      }
      return;
    }
    const members = item.members?.length ? item.members : [item.c].filter(Boolean);
    const c = members[0] || item.c;
    const remoteAddress = item.remoteAddress || this._field(c, 'remoteAddress', 'RemoteAddress');
    const pid = item.pid || this._field(c, 'pid', 'OwningProcess');
    const processName = item.processName || this._field(c, 'processName') || t('network.unknownProcess');
    const hostname = item.hostname || this._field(c, 'hostname');
    const risk = item.risk;
    const riskLabel = this._riskLabel(risk);
    const color = this._riskColor(risk);
    const isTrusted = this._trustedIps.includes(remoteAddress);
    const activity = item.activity || this._perimeterActivity.get(item.key);
    const activeFor = activity?.activeSince ? this._formatObservedDuration(Date.now() - activity.activeSince) : t('common.unknown');
    const sparklinePath = this._activitySparkline(activity?.samples || []);
    const directionLabel = item.direction === 'mixed'
      ? t('firewall.perimeterDirectionMixed')
      : item.direction === 'inbound' ? t('firewall.detailDirectionIn') : t('firewall.detailDirectionOut');
    const services = [...(item.services || [])];
    const states = [...(item.states || [])];

    const memberRows = members.map((member, index) => {
      const memberRemotePort = this._field(member, 'remotePort', 'RemotePort');
      const memberLocalAddress = this._field(member, 'localAddress', 'LocalAddress');
      const memberLocalPort = this._field(member, 'localPort', 'LocalPort');
      const memberState = this._getConnState(member);
      const memberService = this._field(member, 'serviceName');
      const memberDirection = this._getDirection(member, memberLocalPort, memberRemotePort);
      const bandwidthEligible = this._isIPv4(memberLocalAddress) && this._isIPv4(remoteAddress) && memberState === 'ESTABLISHED';
      return `<div class="perim-member-row" data-member-index="${index}">
        <div class="perim-member-main">
          <span>${escapeHtml(memberLocalAddress)}:${escapeHtml(memberLocalPort)}</span>
          <span class="perim-member-arrow">${memberDirection === 'inbound' ? '&#8592;' : '&#8594;'}</span>
          <span>${escapeHtml(remoteAddress)}:${escapeHtml(memberRemotePort)}</span>
        </div>
        <div class="perim-member-meta">
          <span>${escapeHtml(memberService || t('common.unknown'))}</span>
          <span>${escapeHtml(memberState)}</span>
        </div>
        <div class="perim-member-actions">
          ${bandwidthEligible ? `<button class="btn btn-sm" data-member-bandwidth="${index}">${escapeHtml(t('firewall.measureBandwidth'))}</button>` : ''}
          <button class="btn btn-sm" data-member-block="${index}">${escapeHtml(t('firewall.blockConnection'))}</button>
        </div>
        <div class="perim-member-result" data-member-result="${index}"></div>
      </div>`;
    }).join('');

    if (contentDiv) {
      contentDiv.innerHTML = `
      <div class="card compact perim-detail-card">
        <div class="perim-detail-heading">
          <span style="font-weight:600;">${escapeHtml(processName)}</span>
          <span class="glossary-term perim-risk-badge" title="${escapeHtml(risk === 'UNKNOWN' ? this._glossary('unverified') : '')}" style="--perim-risk:${color};">${escapeHtml(riskLabel.toUpperCase())}</span>
        </div>
        <div class="perim-endpoint-address">${escapeHtml(remoteAddress)}${hostname ? ` <span>${escapeHtml(hostname)}</span>` : ''}</div>
        <div class="perim-kpi-grid">
          <div><strong>${item.count}</strong><span>${escapeHtml(t('firewall.perimeterSockets'))}</span></div>
          <div><strong>${escapeHtml(activeFor)}</strong><span>${escapeHtml(t('firewall.perimeterObservedFor'))}</span></div>
          <div><strong>${escapeHtml(directionLabel)}</strong><span>${escapeHtml(t('firewall.direction'))}</span></div>
        </div>
        <div class="perim-activity-chart">
          <div><span>${escapeHtml(t('firewall.perimeterRecentActivity'))}</span><span>${escapeHtml(t('firewall.perimeterPollWindow'))}</span></div>
          <svg viewBox="0 0 220 42" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t('firewall.perimeterActivityAria'))}">
            <path class="perim-sparkline-fill" d="${sparklinePath ? `${sparklinePath} L 220 42 L 0 42 Z` : ''}"></path>
            <path class="perim-sparkline-line" d="${sparklinePath}"></path>
          </svg>
        </div>
        <div class="perim-detail-meta">
          <div>${escapeHtml(t('firewall.detailPid', { pid: pid || t('common.unknown') }))}</div>
          ${services.length ? `<div>${escapeHtml(t('firewall.perimeterServices', { services: services.join(', ') }))}</div>` : ''}
          ${states.length ? `<div>${escapeHtml(t('firewall.perimeterStates', { states: states.join(', ') }))}</div>` : ''}
        </div>
        <div id="detailWhoisResult" style="font-size:0.78rem; color:var(--text-dim);"></div>
        <div id="detailProcessResult" style="font-size:0.78rem; color:var(--text-dim);"></div>
        <div class="perim-group-actions">
          <button class="btn btn-sm" data-action="block-ip">${escapeHtml(t('firewall.blockIp'))}</button>
          <button class="btn btn-sm" data-action="block-app" ${pid ? '' : 'disabled'}>${escapeHtml(t('firewall.blockApp'))}</button>
          <button class="btn btn-sm" data-action="trust">${escapeHtml(isTrusted ? t('firewall.untrust') : t('firewall.trust'))}</button>
          <button class="btn btn-sm" data-action="whois" title="${escapeHtml(this._glossary('whois'))}">${escapeHtml(t('firewall.whois'))}</button>
          <button class="btn btn-sm" data-action="process" ${pid ? '' : 'disabled'}>${escapeHtml(t('firewall.viewProcess'))}</button>
        </div>
        <div class="perim-members-heading">${escapeHtml(t('firewall.perimeterMemberConnections', { count: members.length }))}</div>
        <div class="perim-members-list">${memberRows}</div>
      </div>
      `;

      contentDiv.querySelector('[data-action="block-ip"]').addEventListener('click', () => this._blockIp(container, remoteAddress));
      contentDiv.querySelector('[data-action="block-app"]').addEventListener('click', () => this._blockApp(container, pid, processName));
      contentDiv.querySelector('[data-action="trust"]').addEventListener('click', () => this._toggleTrust(container, remoteAddress, isTrusted));
      contentDiv.querySelector('[data-action="whois"]').addEventListener('click', () => this._runWhois(container, remoteAddress));
      contentDiv.querySelector('[data-action="process"]').addEventListener('click', () => this._showProcessDetails(container, pid));
      contentDiv.querySelectorAll('[data-member-block]').forEach((btn) => {
        const member = members[Number(btn.dataset.memberBlock)];
        btn.addEventListener('click', () => this._blockConnection(container, member));
      });
      contentDiv.querySelectorAll('[data-member-bandwidth]').forEach((btn) => {
        const index = Number(btn.dataset.memberBandwidth);
        const member = members[index];
        const target = contentDiv.querySelector(`[data-member-result="${index}"]`);
        btn.addEventListener('click', () => this._measureBandwidth(container, btn, {
          localAddress: this._field(member, 'localAddress', 'LocalAddress'),
          localPort: this._field(member, 'localPort', 'LocalPort'),
          remoteAddress,
          remotePort: this._field(member, 'remotePort', 'RemotePort')
        }, target));
      });
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
        const groupKey = this._perimeterConnToGroup.get(key) || this._endpointGroupKey((withMeta.find((m) => m.key === key) || {}).c || {});
        const node = this._perimeterNodes.get(groupKey);
        if (node) {
          this._selectedKey = groupKey;
          const svg = container.querySelector('#perimeterSvg');
          if (svg) {
            svg.querySelectorAll('.perim-node').forEach((n) => n.classList.remove('selected'));
            const match = svg.querySelector(`[data-key="${CSS.escape(groupKey)}"]`);
            if (match) match.classList.add('selected');
          }
          this._renderDetailPanel(container, node);
        } else {
          const found = withMeta.find((m) => m.key === key);
          if (found) {
            const fallbackGroup = this._aggregatePerimeterEndpoints([found.c], false)[0];
            if (fallbackGroup) {
              fallbackGroup.activity = this._perimeterActivity.get(fallbackGroup.key) || null;
              this._renderDetailPanel(container, fallbackGroup);
            }
          }
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

  async _measureBandwidth(container, btn, spec, resultTarget = null) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const target = resultTarget || container.querySelector('#detailBandwidthResult');
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
  },

  destroy() {
    if (this._summaryTimer) clearInterval(this._summaryTimer);
    if (this._perimeterTimer) clearInterval(this._perimeterTimer);
    if (this._particleRaf) cancelAnimationFrame(this._particleRaf);
    if (this._particleObserver) this._particleObserver.disconnect();
    this._summaryTimer = null;
    this._perimeterTimer = null;
    this._particleRaf = null;
    this._particleObserver = null;
    this._perimeterPolling = false;
    this._perimeterNodes = new Map();
    this._perimeterNodeEls = new Map();
    this._perimeterActivity = new Map();
    this._perimeterConnToGroup = new Map();
    this._selectedKey = null;
    this._lastConnections = [];
  }
};
