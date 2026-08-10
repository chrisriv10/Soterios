window.Pages = window.Pages || {};
window.Pages['network'] = {
  REFRESH_INTERVAL_MS: 3000,
  _connectionQuery: '',
  _connectionRiskFilter: 'all',
  _connectionStateFilter: 'all',
  _geoCache: {},
  _groupByProcess: true,
  _simpleView: true,
  _expandedGroups: new Set(),
  _vpnSelection: '',
  _vpnPending: null,
  _vpnError: '',

  _classificationLabel(classification) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    switch (classification) {
      case 'SAFE': return t('network.flagSafe');
      case 'UNKNOWN': return t('network.flagUnverified');
      case 'MALICIOUS': return t('network.flagMalicious');
      default: return classification;
    }
  },

  _renderConnectionRow(c, t, getState, firstDefined, simpleView) {
    const proc = c.processName ? ` (${escapeHtml(c.processName)})` : (c.pid ? ` (PID: ${escapeHtml(c.pid)})` : '');
    const hostname = c.hostname ? ` \u2192 ${escapeHtml(c.hostname)}` : '';
    const service = c.serviceName ? ` [${escapeHtml(c.serviceName)}]` : '';
    const state = getState(c);

    const remoteAddress = firstDefined(c.remoteAddress, c.RemoteAddress);
    const remotePort = firstDefined(c.remotePort, c.RemotePort);
    const localAddress = firstDefined(c.localAddress, c.LocalAddress);
    const localPort = firstDefined(c.localPort, c.LocalPort);

    let badgeColor = 'var(--text-dim)';
    let borderColor = 'var(--accent-primary)';
    if (c.classification === 'SAFE') {
      badgeColor = 'var(--ok)';
      borderColor = 'var(--ok)';
    } else if (c.classification === 'MALICIOUS') {
      badgeColor = 'var(--danger)';
      borderColor = 'var(--danger)';
    } else if (c.classification === 'UNKNOWN') {
      badgeColor = 'var(--warn)';
      borderColor = 'var(--warn)';
    }

    let stateColor = 'var(--text-dim)';
    const stateUpper = state.toString().toUpperCase();
    if (stateUpper === 'ESTABLISHED') {
      stateColor = 'var(--ok)';
    } else if (stateUpper === 'LISTEN' || stateUpper === 'LISTENING') {
      stateColor = 'var(--accent-primary)';
    } else if (stateUpper === 'TIME_WAIT' || stateUpper === 'TIMEWAIT') {
      stateColor = 'var(--warn)';
    } else if (stateUpper === 'CLOSE_WAIT' || stateUpper === 'CLOSEWAIT') {
      stateColor = 'var(--danger)';
    }
    const stateBadge = state
      ? `<span style="font-size:0.7rem; font-weight:600; color:${stateColor}; background:${stateColor}15; padding:2px 6px; border-radius:4px; margin-right:6px;">${escapeHtml(state)}</span>`
      : '';

    const searchBlob = [
      c.processName, c.hostname, c.serviceName, state, c.classification,
      remoteAddress, remotePort, localAddress, localPort, c.pid
    ].filter((v) => v !== undefined && v !== null && v !== '').join(' ').toLowerCase();

    const riskDisplay = this._classificationLabel(c.classification);

    if (simpleView) {
      // Simple view: just show IP, port, and risk
      return `<div class="list-row connection-row" data-ip="${escapeHtml(remoteAddress)}" data-search="${escapeHtml(searchBlob)}" data-risk="${escapeHtml(c.classification || 'UNKNOWN')}" data-state="${escapeHtml(state)}" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-left:3px solid ${borderColor}; background:var(--bg-surface); border-radius:4px;">
        <div style="font-weight:500; font-family:monospace; font-size:0.9rem;">${escapeHtml(remoteAddress)}:${escapeHtml(remotePort)}${hostname}</div>
        <div style="font-size:0.75rem; font-weight:600; color:${badgeColor}; background:${badgeColor}15; padding:3px 6px; border-radius:4px;">${escapeHtml(riskDisplay)}</div>
      </div>`;
    } else {
      // Technical view: show full details
      return `<div class="list-row connection-row" data-ip="${escapeHtml(remoteAddress)}" data-search="${escapeHtml(searchBlob)}" data-risk="${escapeHtml(c.classification || 'UNKNOWN')}" data-state="${escapeHtml(state)}" style="display:flex; flex-direction:column; gap:4px; padding:12px 16px; border-left:4px solid ${borderColor}; content-visibility:auto; contain-intrinsic-size:0 70px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600; font-family:monospace; word-break:break-all;">${stateBadge}${escapeHtml(remoteAddress)}:${escapeHtml(remotePort)}${service}${hostname}</div>
            <div class="page-subtitle" style="font-size:0.85rem; word-break:break-all;">${escapeHtml(t('network.localConnection', { localIp: localAddress, localPort: localPort, proc: proc }))}</div>
          </div>
          <div style="font-size:0.75rem; font-weight:600; color:${badgeColor}; background:${badgeColor}15; padding:4px 8px; border-radius:4px;">${escapeHtml(riskDisplay)}</div>
        </div>
      </div>`;
    }
  },

  render(container) {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;

    container.innerHTML = `
      <style>
        @keyframes heatmapPulseMalicious {
          0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0.7; }
          70% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
        }
        .heatmap-marker {
          will-change: transform;
        }
        .heatmap-marker.heatmap-pulse-malicious::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: var(--danger);
          transform: translate(-50%, -50%) scale(0.7);
          opacity: 0.7;
          animation: heatmapPulseMalicious 2s infinite;
          will-change: transform, opacity;
          pointer-events: none;
        }
        @keyframes flashHighlight {
          0% { background-color: rgba(255, 255, 255, 0.2); }
          100% { background-color: transparent; }
        }
        .flash-highlight {
          animation: flashHighlight 1.5s ease-out;
        }
        .heatmap-marker:hover {
          z-index: 10;
          transform: translate(-50%, -50%) scale(1.2) !important;
        }
      </style>
      <header class="page-header">
        <h1 class="page-title">${escapeHtml(t('network.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('network.subtitle'))}</p>
      </header>
      <div id="networkContent">
        <div class="empty-state"><span class="spinner"></span>&nbsp;${escapeHtml(t('network.loading'))}</div>
      </div>
    `;
    this.load(container, true);

    const content = container.querySelector('#networkContent');
    if (content) {
      content.addEventListener('click', (e) => {
        const marker = e.target.closest('.heatmap-marker');
        if (marker) {
          const ips = marker.dataset.ips.split(',');
          window.Pages['network']._selectedClusterIps = ips;
          window.Pages['network']._selectedClusterLoc = marker.dataset.loc;
          window.Pages['network'].load(container, false);
        } else if (e.target.closest('.heatmap-infobox-close')) {
          window.Pages['network']._selectedClusterIps = null;
          window.Pages['network'].load(container, false);
        }
      });

      content.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'connectionSearch') {
          window.Pages['network']._connectionQuery = e.target.value;
          window.Pages['network'].applyConnectionFilter(container);
        }
      });
      content.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'connectionRiskFilter') {
          window.Pages['network']._connectionRiskFilter = e.target.value;
          window.Pages['network'].applyConnectionFilter(container);
        } else if (e.target && e.target.id === 'connectionStateFilter') {
          window.Pages['network']._connectionStateFilter = e.target.value;
          window.Pages['network'].applyConnectionFilter(container);
        } else if (e.target && e.target.id === 'vpnSelect') {
          window.Pages['network']._vpnSelection = e.target.value;
          window.Pages['network'].load(container, false);
        }
      });
      content.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'viewToggle') {
          window.Pages['network']._simpleView = e.target.value === 'simple';
          window.Pages['network'].load(container, false);
        } else if (e.target && e.target.id === 'groupToggle') {
          window.Pages['network']._groupByProcess = e.target.value === 'grouped';
          // Clear expanded groups when switching to grouped view to ensure auto-expand works
          if (window.Pages['network']._groupByProcess) {
            window.Pages['network']._expandedGroups = new Set();
          }
          window.Pages['network'].load(container, false);
        }
      });
      content.addEventListener('click', (e) => {
        if (e.target.closest('.process-group-header')) {
          const header = e.target.closest('.process-group-header');
          const processName = header.dataset.process;
          if (window.Pages['network']._expandedGroups.has(processName)) {
            window.Pages['network']._expandedGroups.delete(processName);
          } else {
            window.Pages['network']._expandedGroups.add(processName);
          }
          window.Pages['network'].load(container, false);
        } else if (e.target.closest('#vpnToggleBtn')) {
          const btn = e.target.closest('#vpnToggleBtn');
          window.Pages['network'].toggleVpn(container, btn.dataset.vpnName, btn.dataset.vpnAction);
        }
      });
    }

    this._refreshTimer = setInterval(() => {
      if (!document.body.contains(container)) {
        clearInterval(this._refreshTimer);
        this._refreshTimer = null;
        return;
      }
      this.load(container, false);
    }, this.REFRESH_INTERVAL_MS);
  },
  async load(container, isInitial) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const content = container.querySelector('#networkContent');
    if (!content) return;
    const prevScrollEl = content?.querySelector('#activeConnectionsList');
    const prevScrollTop = prevScrollEl ? prevScrollEl.scrollTop : 0;
    const prevSearchEl = content?.querySelector('#connectionSearch');
    const searchWasFocused = !!(prevSearchEl && document.activeElement === prevSearchEl);
    const searchSelectionStart = prevSearchEl ? prevSearchEl.selectionStart : null;
    const searchSelectionEnd = prevSearchEl ? prevSearchEl.selectionEnd : null;
    try {
      const [statsResult, connectionsResult, settingsResult, vpnResult] = await Promise.allSettled([
        window.api.invoke('network:stats'),
        window.api.invoke('network:connections'),
        window.api.invoke('db:getSetting', 'feature.networkTrafficHistory', true),
        window.api.invoke('network:vpn:list')
      ]);

      if (!document.body.contains(container)) {
        return;
      }

      const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
      const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value : null;
      const networkTrafficHistoryEnabled = settingsResult.status === 'fulfilled' ? settingsResult.value : true;
      const vpn = vpnResult.status === 'fulfilled' ? vpnResult.value : null;
      const vpns = (vpn && Array.isArray(vpn.vpns)) ? vpn.vpns : [];

      let html = '';

      const STATE_CODE_MAP = {
        1: 'CLOSED', 2: 'LISTEN', 3: 'SYN_SENT', 4: 'SYN_RECEIVED',
        5: 'ESTABLISHED', 6: 'FIN_WAIT_1', 7: 'FIN_WAIT_2', 8: 'CLOSE_WAIT',
        9: 'CLOSING', 10: 'LAST_ACK', 11: 'TIME_WAIT', 12: 'DELETE_TCB',
        100: 'BOUND'
      };
      const getState = (c) => {
        const raw = c.state ?? c.State ?? c.connectionState ?? c.ConnectionState ?? c.status ?? c.Status ?? '';
        return (STATE_CODE_MAP[raw] || raw).toString().toUpperCase() || 'UNKNOWN';
      };
      const firstDefined = (...vals) => {
        for (const v of vals) {
          if (v !== undefined && v !== null && v !== '') return v;
        }
        return '';
      };

      const matchesConnectionFilters = (c) => {
        const state = getState(c);
        const risk = c.classification || 'UNKNOWN';
        const query = (this._connectionQuery || '').trim().toLowerCase();
        const riskFilter = this._connectionRiskFilter || 'all';
        const stateFilter = this._connectionStateFilter || 'all';

        if (riskFilter !== 'all' && risk !== riskFilter) return false;
        if (stateFilter !== 'all' && state !== stateFilter) return false;
        if (query) {
          const remoteAddress = firstDefined(c.remoteAddress, c.RemoteAddress);
          const remotePort = firstDefined(c.remotePort, c.RemotePort);
          const localAddress = firstDefined(c.localAddress, c.LocalAddress);
          const localPort = firstDefined(c.localPort, c.LocalPort);
          const searchBlob = [
            c.processName, c.hostname, c.serviceName, state, risk,
            remoteAddress, remotePort, localAddress, localPort, c.pid
          ].filter((v) => v !== undefined && v !== null && v !== '').join(' ').toLowerCase();
          if (!searchBlob.includes(query)) return false;
        }
        return true;
      };
      const filteredConnections = (connections || []).filter(matchesConnectionFilters);

      const safeCount = connections ? connections.filter(c => c.classification === 'SAFE').length : 0;
      const maliciousCount = connections ? connections.filter(c => c.classification === 'MALICIOUS').length : 0;
      const unknownCount = connections ? connections.length - safeCount - maliciousCount : 0;

      const STATE_COLORS = {
        ESTABLISHED: 'var(--ok)',
        LISTEN: 'var(--accent-primary)',
        BOUND: 'var(--accent-primary)',
        TIME_WAIT: 'var(--warn)',
        CLOSE_WAIT: 'var(--danger)'
      };
      const stateCounts = {};
      if (connections) {
        for (const c of connections) {
          const s = getState(c);
          stateCounts[s] = (stateCounts[s] || 0) + 1;
        }
      }
      const stateEntries = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]);
      const stateTotal = stateEntries.reduce((sum, [, n]) => sum + n, 0);
      const fallbackPalette = ['var(--text-dim)', 'var(--accent-primary)', 'var(--warn)', 'var(--danger)', 'var(--ok)'];
      let paletteIdx = 0;
      const stateColorFor = (name) => {
        if (STATE_COLORS[name]) return STATE_COLORS[name];
        return fallbackPalette[paletteIdx++ % fallbackPalette.length];
      };

      if (stats && stats.connections) {
        const c = stats.connections;
        html += `<div class="grid grid-5" style="margin-bottom:18px;">
          <div class="stat-tile"><div class="stat-label">${escapeHtml(t('network.totalTcp'))}</div><div class="stat-value">${c.total}</div></div>
          <div class="stat-tile"><div class="stat-label">${escapeHtml(t('network.established'))}</div><div class="stat-value" style="color:var(--ok);">${c.established}</div></div>
          <div class="stat-tile"><div class="stat-label">${escapeHtml(t('network.listening'))}</div><div class="stat-value" style="color:var(--accent-primary);">${c.listen}</div></div>
          <div class="stat-tile"><div class="stat-label">${escapeHtml(t('network.timeWait'))}</div><div class="stat-value" style="color:var(--warn);">${c.timeWait}</div></div>
          <div class="stat-tile"><div class="stat-label">${escapeHtml(t('network.closeWait'))}</div><div class="stat-value" style="color:var(--danger);">${c.closeWait}</div></div>
        </div>`;
      }

      html += '<div class="card" style="padding:14px 16px; margin-bottom:18px;">';
      html += '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">';
      html += `<div>
        <h3 style="margin:0 0 2px; font-size:1rem;">${escapeHtml(t('network.vpnTitle'))}</h3>
        <div class="page-subtitle" style="font-size:0.8rem;">${escapeHtml(t('network.vpnSubtitle'))}</div>
      </div>`;
      if (vpns.length === 0) {
        html += `<div style="font-size:0.8rem; color:var(--text-dim); flex:1 1 100%;">${escapeHtml(t('network.vpnNoProfiles'))}</div>`;
      } else {
        const selectedName = vpns.some((v) => v.name === this._vpnSelection)
          ? this._vpnSelection
          : (vpns.find((v) => v.connected) || vpns[0]).name;
        const selVpn = vpns.find((v) => v.name === selectedName) || vpns[0];
        const busy = !!this._vpnPending;
        const connected = !!selVpn.connected && !busy;

        html += '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">';
        html += `<select id="vpnSelect" ${busy ? 'disabled' : ''} style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem; max-width:280px;">`;
        for (const v of vpns) {
          html += `<option value="${escapeHtml(v.name)}" ${v.name === selectedName ? 'selected' : ''}>${escapeHtml(v.name)}${v.connected ? ' \u2713' : ''}</option>`;
        }
        html += '</select>';
        const btnClass = connected ? 'btn btn-sm btn-danger' : 'btn btn-sm btn-primary';
        const btnLabel = busy ? t('network.vpnWorking') : (connected ? t('network.vpnDisconnect') : t('network.vpnConnect'));
        html += `<button id="vpnToggleBtn" class="${btnClass}" data-vpn-action="${connected ? 'disconnect' : 'connect'}" data-vpn-name="${escapeHtml(selVpn.name)}" ${busy ? 'disabled' : ''}>${escapeHtml(btnLabel)}</button>`;

        let statusText = '';
        let statusColor = 'var(--text-dim)';
        if (this._vpnError) {
          statusText = this._vpnError;
          statusColor = 'var(--danger)';
        } else if (this._vpnPending) {
          statusText = this._vpnPending.action === 'disconnect'
            ? t('network.vpnDisconnecting', { name: this._vpnPending.name })
            : t('network.vpnConnecting', { name: this._vpnPending.name });
        } else if (connected) {
          statusText = t('network.vpnConnected', { name: selVpn.name });
          statusColor = 'var(--ok)';
        } else {
          statusText = t('network.vpnDisconnected');
        }
        html += `<span id="vpnStatusText" style="font-size:0.8rem; color:${statusColor};">${escapeHtml(statusText)}</span>`;
        html += '</div>';
      }
      html += '</div></div>';

      html += '<div style="display:flex; gap:16px; margin-bottom:18px; flex-wrap:wrap; align-items:stretch;">';

      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      html += `<h3 style="margin-bottom:10px; font-size:1rem;">${escapeHtml(t('network.bandwidth'))}</h3>`;
      if (stats && stats.interfaces && stats.interfaces.length > 0) {
        html += '<div style="display:flex; flex-direction:column; gap:8px;">';
        for (const iface of stats.interfaces) {
          html += `<div class="stat-tile">
            <div class="stat-label">${escapeHtml(iface.iface)}</div>
            <div class="stat-value" style="font-size:0.85rem;">
              \u25B2 ${iface.txSec} KB/s &nbsp; \u25BC ${iface.rxSec} KB/s
            </div>
            <div style="font-size:0.7rem; color:var(--text-dim);">
              ${escapeHtml(t('network.totalStats', { txTotal: iface.txTotal, rxTotal: iface.rxTotal }))}
            </div>
          </div>`;
        }
        html += '</div>';
      } else {
        html += `<div class="empty-state" style="font-size:0.85rem;">${escapeHtml(t('network.noInterfaceData'))}</div>`;
      }
      html += '</div></div>';

      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      html += `<h3 style="margin-bottom:10px; font-size:1rem;">${escapeHtml(t('network.connectionStates'))}</h3>`;
      if (stateTotal === 0) {
        html += `<div class="empty-state" style="font-size:0.85rem;">${escapeHtml(t('network.noConnectionData'))}</div>`;
      } else {
        let cumulative = 0;
        const gradientStops = stateEntries.map(([name, count]) => {
          const color = stateColorFor(name);
          const start = (cumulative / stateTotal) * 360;
          cumulative += count;
          const end = (cumulative / stateTotal) * 360;
          return `${color} ${start}deg ${end}deg`;
        }).join(', ');

        html += '<div style="display:flex; align-items:center; gap:16px;">';
        html += `<div style="flex-shrink:0; width:96px; height:96px; border-radius:50%; background: conic-gradient(${gradientStops});"></div>`;
        html += '<div style="display:flex; flex-direction:column; gap:6px; font-size:0.78rem;">';
        paletteIdx = 0;
        for (const [name, count] of stateEntries) {
          const color = STATE_COLORS[name] || fallbackPalette[paletteIdx++ % fallbackPalette.length];
          const pct = Math.round((count / stateTotal) * 100);
          html += `<div style="display:flex; align-items:center; gap:6px;">
            <span style="width:9px; height:9px; border-radius:50%; background:${color}; display:inline-block;"></span>
            <span>${escapeHtml(name)}: ${count} (${pct}%)</span>
          </div>`;
        }
        html += '</div></div>';
      }
      html += '</div></div>';

      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      html += `<h3 style="margin-bottom:10px; font-size:1rem;">${escapeHtml(t('network.securityFlags'))}</h3>`;
      html += `<div style="display:flex; flex-direction:column; gap:8px; font-size:0.85rem;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="display:flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:var(--ok); display:inline-block;"></span>${escapeHtml(t('network.flagSafe'))}</span>
          <span style="font-weight:600; color:var(--ok);">${safeCount}</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="display:flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:var(--warn); display:inline-block;"></span>${escapeHtml(t('network.flagUnverified'))}</span>
          <span style="font-weight:600; color:var(--warn);">${unknownCount}</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="display:flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:var(--danger); display:inline-block;"></span>${escapeHtml(t('network.flagMalicious'))}</span>
          <span style="font-weight:600; color:var(--danger);">${maliciousCount}</span>
        </div>
      </div>`;
      html += '</div></div>';

      html += '</div>';

      if (networkTrafficHistoryEnabled) {
        html += '<div class="card" style="padding:16px 18px 14px; margin-bottom:18px;">';
        html += '<div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:12px;">';
        html += `<h3 style="margin:0; font-size:1rem;">${escapeHtml(t('network.historyTitle'))}</h3>`;
        html += '<div id="networkHistoryLegend" style="display:flex; align-items:center; gap:18px; font-size:0.78rem; color:var(--text-dim);"></div>';
        html += '</div>';
        html += '<div id="networkHistoryChartWrap" style="position:relative;">';
        html += '<canvas id="networkHistoryChart" style="width:100%; height:190px; display:block; cursor:crosshair;"></canvas>';
        html += '<div id="networkHistoryTooltip" style="position:absolute; top:0; left:0; display:none; pointer-events:none; transform:translate(-50%, -110%); background:var(--bg-base); border:1px solid var(--glass-border); border-radius:8px; padding:7px 10px; font-size:0.72rem; line-height:1.5; box-shadow:0 8px 24px rgba(0,0,0,0.35); white-space:nowrap; z-index:5;"></div>';
        html += '</div>';
        html += `<div id="networkHistoryEmpty" class="empty-state" style="font-size:0.85rem; display:none;">${escapeHtml(t('network.historyEmpty'))}</div>`;
        html += '</div>';
      }

      html += '<div id="networkAlertsPanel"></div>';

      const uniqueIps = [...new Set(connections ? connections.map(c => firstDefined(c.remoteAddress, c.RemoteAddress)).filter(Boolean) : [])];
      const uncachedIps = uniqueIps.filter((ip) => !(ip in this._geoCache));
      if (uncachedIps.length) {
        try {
          const fresh = await window.api.invoke('network:geo', uncachedIps);
          if (!document.body.contains(container)) {
            return;
          }
          Object.assign(this._geoCache, fresh);
          for (const ip of uncachedIps) {
            if (!(ip in fresh)) this._geoCache[ip] = null;
          }
        } catch (e) {
          console.error('Geo lookup failed', e);
        }
      }
      const geoData = {};
      for (const ip of uniqueIps) {
        if (this._geoCache[ip]) geoData[ip] = this._geoCache[ip];
      }

      const totalConnectionsCount = (connections || []).length;
      const filteredConnectionsCount = filteredConnections.length;
      const mappedCount = filteredConnections.filter((c) => {
        const ip = firstDefined(c.remoteAddress, c.RemoteAddress);
        return !!geoData[ip];
      }).length;

      if (Object.keys(geoData).length > 0) {
        html += '<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px; flex-wrap:wrap; gap:8px;">';
        html += `<div>
          <h3 style="margin:0; font-size:1rem;">${escapeHtml(t('network.heatmapTitle'))}</h3>
          <div style="font-size:0.75rem; color:var(--text-dim); margin-top:2px;">${escapeHtml(t('network.heatmapCounts', { total: totalConnectionsCount, filtered: filteredConnectionsCount, mapped: mappedCount }))}</div>
        </div>`;
        html += `<div style="display:flex; gap:12px; font-size:0.75rem; font-weight:600;">
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--ok);"></span> ${escapeHtml(t('network.heatmapLegendSafe'))}</span>
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--warn);"></span> ${escapeHtml(t('network.heatmapLegendUnverified'))}</span>
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--danger);"></span> ${escapeHtml(t('network.heatmapLegendMalicious'))}</span>
        </div>`;
        html += '</div>';

        html += `<div class="card" style="padding:0; margin-bottom:18px; position:relative; background-color:var(--bg-panel); overflow:hidden; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
          <div id="heatmapMapBgMount"></div>
          <div style="position:absolute; top:0; left:0; bottom:0; right:0; pointer-events:none; z-index:2;">`;

        if (mappedCount === 0) {
          html += `<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; font-size:0.85rem; color:var(--text-dim); white-space:nowrap;">${escapeHtml(t('network.heatmapNoMatches'))}</div>`;
        }

        const clusters = {};
        for (const c of filteredConnections) {
          const ip = firstDefined(c.remoteAddress, c.RemoteAddress);
          const geo = geoData[ip];
          if (!geo || geo.lat === undefined || geo.lon === undefined) continue;

          const clusterX = Math.round(geo.lon / 2.5) * 2.5;
          const clusterY = Math.round(geo.lat / 2.5) * 2.5;
          const key = `${clusterX},${clusterY}`;

          if (!clusters[key]) {
            clusters[key] = {
              lat: clusterY, lon: clusterX,
              count: 0,
              ips: new Set(),
              classification: 'SAFE',
              locations: new Set()
            };
          }

          clusters[key].count++;
          clusters[key].ips.add(ip);
          if (geo.city && geo.country) clusters[key].locations.add(`${geo.city}, ${geo.country}`);

          if (c.classification === 'MALICIOUS') {
            clusters[key].classification = 'MALICIOUS';
          } else if (c.classification === 'UNKNOWN' && clusters[key].classification === 'SAFE') {
            clusters[key].classification = 'UNKNOWN';
          }
        }

        for (const key in clusters) {
          const c = clusters[key];
          const x = ((c.lon + 180) / 360) * 100;
          const y = ((90 - c.lat) / 180) * 100;

          let color = 'var(--ok)';
          let glow = 'var(--ok)';
          let pulseClass = '';

          if (c.classification === 'MALICIOUS') {
            color = 'var(--danger)';
            glow = 'var(--danger)';
            pulseClass = 'heatmap-pulse-malicious';
          } else if (c.classification === 'UNKNOWN') {
            color = 'var(--warn)';
            glow = 'var(--warn)';
          }

          const size = Math.max(8, 6 + Math.log(c.count) * 4);
          const ipList = Array.from(c.ips).join(',');
          const locList = Array.from(c.locations).join(' | ') || t('common.unverifiedLocation');
          const classificationDisplay = this._classificationLabel(c.classification);

          html += `<div class="heatmap-marker ${pulseClass}" data-ips="${ipList}" data-loc="${escapeHtml(locList)}"
            title="${escapeHtml(locList)}\\nIPs: ${ipList}\\nConnections: ${c.count}\\nClassification: ${escapeHtml(classificationDisplay)}"
            style="position:absolute; left:${x}%; top:${y}%; width:${size}px; height:${size}px;
            background-color:${color}; border-radius:50%; transform:translate(-50%, -50%);
            box-shadow:0 0 10px ${glow}; cursor:pointer; pointer-events:auto; display:flex;
            align-items:center; justify-content:center; color:#fff; font-size:9px; font-weight:bold; transition: transform 0.15s ease-out;">
            ${c.count > 1 ? c.count : ''}
          </div>`;
        }

        if (window.Pages['network']._selectedClusterIps) {
          const selectedIps = window.Pages['network']._selectedClusterIps;
          const loc = window.Pages['network']._selectedClusterLoc;
          const matchingConns = filteredConnections.filter(c => {
             const ip = firstDefined(c.remoteAddress, c.RemoteAddress);
             return selectedIps.includes(ip);
          });

          html += `<div style="position:absolute; top:10px; right:10px; width:320px; max-height:calc(100% - 20px); background:rgba(20, 26, 33, 0.95); border:1px solid rgba(255,255,255,0.1); border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.5); z-index:20; display:flex; flex-direction:column; backdrop-filter:blur(4px); pointer-events:auto;">
            <div style="padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center;">
              <div style="font-weight:600; font-size:0.9rem;">${escapeHtml(loc || t('network.clusterDetails'))}</div>
              <div class="heatmap-infobox-close" style="cursor:pointer; opacity:0.7; font-size:1.4rem; line-height:1;">&times;</div>
            </div>
            <div style="padding:10px 14px; overflow-y:auto; font-size:0.8rem; display:flex; flex-direction:column; gap:12px;">`;

          for (const c of matchingConns) {
            const proc = c.processName ? `(${escapeHtml(c.processName)})` : (c.pid ? `(PID: ${escapeHtml(c.pid)})` : '');
            const ip = firstDefined(c.remoteAddress, c.RemoteAddress);
            const port = firstDefined(c.remotePort, c.RemotePort);
            const state = getState(c);
            let stateColor = 'var(--text-dim)';
            if (state === 'ESTABLISHED') stateColor = 'var(--ok)';
            else if (state === 'LISTEN' || state === 'LISTENING') stateColor = 'var(--accent-primary)';
            else if (state === 'TIME_WAIT') stateColor = 'var(--warn)';
            else if (state === 'CLOSE_WAIT') stateColor = 'var(--danger)';

            html += `<div>
              <div style="font-family:monospace; color:var(--text-primary); font-size:0.85rem;">${escapeHtml(ip)}:${escapeHtml(port)}</div>
              <div style="color:var(--text-dim); display:flex; justify-content:space-between; margin-top:4px;">
                <span>${proc}</span>
                <span style="color:${stateColor}; font-weight:600; font-size:0.7rem; background:${stateColor}15; padding:2px 4px; border-radius:4px;">${escapeHtml(state)}</span>
              </div>
            </div>`;
          }

          html += `</div></div>`;
        }

        html += `</div></div>`;
      }

      html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap;">
        <h3 style="margin:0; font-size:1rem;">${escapeHtml(t('network.activeConnections'))}</h3>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span id="connectionCount" class="page-subtitle" style="font-size:0.8rem; white-space:nowrap;"></span>
          <select id="viewToggle" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
            <option value="simple" ${this._simpleView ? 'selected' : ''}>${escapeHtml(t('network.simpleView'))}</option>
            <option value="technical" ${!this._simpleView ? 'selected' : ''}>${escapeHtml(t('network.technicalView'))}</option>
          </select>
          <select id="groupToggle" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
            <option value="flat" ${!this._groupByProcess ? 'selected' : ''}>Flat View</option>
            <option value="grouped" ${this._groupByProcess ? 'selected' : ''}>${escapeHtml(t('network.groupByProcess'))}</option>
          </select>
          <select id="connectionStateFilter" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
            <option value="all" ${this._connectionStateFilter === 'all' ? 'selected' : ''}>${escapeHtml(t('network.stateFilterAll'))}</option>
            <option value="ESTABLISHED" ${this._connectionStateFilter === 'ESTABLISHED' ? 'selected' : ''}>${escapeHtml(t('network.stateFilterEstablished'))}</option>
            <option value="LISTEN" ${this._connectionStateFilter === 'LISTEN' ? 'selected' : ''}>${escapeHtml(t('network.stateFilterListen'))}</option>
            <option value="TIME_WAIT" ${this._connectionStateFilter === 'TIME_WAIT' ? 'selected' : ''}>${escapeHtml(t('network.stateFilterTimeWait'))}</option>
            <option value="CLOSE_WAIT" ${this._connectionStateFilter === 'CLOSE_WAIT' ? 'selected' : ''}>${escapeHtml(t('network.stateFilterCloseWait'))}</option>
            <option value="BOUND" ${this._connectionStateFilter === 'BOUND' ? 'selected' : ''}>${escapeHtml(t('network.stateFilterBound'))}</option>
          </select>
          <select id="connectionRiskFilter" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
            <option value="all" ${this._connectionRiskFilter === 'all' ? 'selected' : ''}>${escapeHtml(t('network.riskFilterAll'))}</option>
            <option value="SAFE" ${this._connectionRiskFilter === 'SAFE' ? 'selected' : ''}>${escapeHtml(t('network.riskFilterSafe'))}</option>
            <option value="UNKNOWN" ${this._connectionRiskFilter === 'UNKNOWN' ? 'selected' : ''}>${escapeHtml(t('network.riskFilterUnverified'))}</option>
            <option value="MALICIOUS" ${this._connectionRiskFilter === 'MALICIOUS' ? 'selected' : ''}>${escapeHtml(t('network.riskFilterMalicious'))}</option>
          </select>
          <input type="text" id="connectionSearch" placeholder="${escapeHtml(t('network.searchPlaceholder'))}"
            value="${escapeHtml(this._connectionQuery || '')}"
            style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--glass-bg,rgba(255,255,255,0.05)); color:inherit; font-size:0.85rem; width:220px;">
        </div>
      </div>`;
      if (!connections || connections.length === 0) {
        html += `<div class="empty-state">${escapeHtml(t('network.noConnections'))}</div>`;
      } else {
        const classificationOrder = { SAFE: 0, UNKNOWN: 1, MALICIOUS: 2 };
        const sortedConnections = [...connections].sort((a, b) => {
          const rankA = classificationOrder[a.classification] ?? 1;
          const rankB = classificationOrder[b.classification] ?? 1;
          if (rankA !== rankB) return rankA - rankB;
          const establishedA = getState(a) === 'ESTABLISHED' ? 0 : 1;
          const establishedB = getState(b) === 'ESTABLISHED' ? 0 : 1;
          return establishedA - establishedB;
        });

        html += '<div id="activeConnectionsList" style="display:flex; flex-direction:column; gap:8px; max-height:400px; overflow-y:auto;">';

        if (this._groupByProcess) {
          // Group connections by process
          const groups = new Map();
          for (const c of sortedConnections) {
            const processKey = c.processName || (c.pid ? `PID:${c.pid}` : t('network.unknownProcess'));
            if (!groups.has(processKey)) {
              groups.set(processKey, []);
            }
            groups.get(processKey).push(c);
          }

          // Auto-expand groups only if none are expanded (first time grouping)
          if (this._expandedGroups.size === 0) {
            // Don't auto-expand by default - let users choose which to expand
          }

          for (const [processName, groupConnections] of groups) {
            const safeCount = groupConnections.filter(c => c.classification === 'SAFE').length;
            const unknownCount = groupConnections.filter(c => c.classification === 'UNKNOWN').length;
            const maliciousCount = groupConnections.filter(c => c.classification === 'MALICIOUS').length;
            
            let groupBorderColor = '#58A6FF';
            if (maliciousCount > 0) {
              groupBorderColor = '#F85149';
            } else if (unknownCount > 0) {
              groupBorderColor = '#D29922';
            } else {
              groupBorderColor = '#3FB950';
            }

            const isExpanded = this._expandedGroups.has(processName);

            html += `<div class="process-group" style="border-left:4px solid ${groupBorderColor}; background:#1e2329; border-radius:8px; margin-bottom:12px; display:block;">
              <div class="process-group-header" data-process="${escapeHtml(processName)}" style="padding:12px 16px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; background:#252b32;">
                <div>
                  <div style="font-weight:600; font-size:0.95rem; color:#fff;">${escapeHtml(t('network.processGroup', { process: processName, count: groupConnections.length }))}</div>
                  <div style="font-size:0.8rem; color:#888; margin-top:2px;">${escapeHtml(t('network.riskSummary', { safe: safeCount, unknown: unknownCount, malicious: maliciousCount }))}</div>
                </div>
                <div style="font-size:1.2rem; color:#888; transition:transform 0.2s;">${isExpanded ? '▼' : '▶'}</div>
              </div>
              <div class="process-group-connections" style="display:${isExpanded ? 'block' : 'none'}; padding:8px 0;">`;

            for (const c of groupConnections) {
              html += this._renderConnectionRow(c, t, getState, firstDefined, this._simpleView);
            }

            html += '</div></div>';
          }
        } else {
          // Flat list view (original behavior)
          for (const c of sortedConnections) {
            html += this._renderConnectionRow(c, t, getState, firstDefined, this._simpleView);
          }
        }

        html += '</div>';
        html += `<div id="connectionNoResults" class="empty-state" style="display:none; margin-top:8px;">${escapeHtml(t('network.noResults'))}</div>`;
      }

      content.innerHTML = html;
      this.paintHistoryChart(content).catch(() => {});

      const mapBgMount = content.querySelector('#heatmapMapBgMount');
      if (mapBgMount) {
        if (!this._worldMapBgEl) {
          this._worldMapBgEl = document.createElement('div');
          this._worldMapBgEl.innerHTML = `
            <div style="position:absolute; top:0; left:0; right:0; bottom:0; background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px); background-size: 20px 20px; pointer-events:none; z-index:1;"></div>
            <img src="../img/world-map.svg" alt="World Map" style="width:100%; height:auto; opacity:0.6; display:block; pointer-events:none; user-select:none;" />
          `;
        }
        mapBgMount.replaceWith(this._worldMapBgEl);
      }

      const alertsPanelMount = content.querySelector('#networkAlertsPanel');
      if (alertsPanelMount) {
        if (!this._alertsPanelEl) {
          this._alertsPanelEl = document.createElement('div');
          this._alertsPanelEl.id = 'networkAlertsPanel';
          this._alertsPanelEl.className = 'card';
          this._alertsPanelEl.style.cssText = 'padding:10px 12px; margin-bottom:18px;';
          this._alertsPanelEl.innerHTML = `
            <h3 style="margin-bottom:6px; font-size:0.9rem;">${escapeHtml(t('network.alertsTitle'))}</h3>
            <div id="networkAlertsList" class="empty-state" style="font-size:0.8rem;">${escapeHtml(t('network.alertsLoading'))}</div>
          `;
        }
        alertsPanelMount.replaceWith(this._alertsPanelEl);
        this.renderAlertHits(content).catch(() => {});
      }

      if (prevScrollTop) {
        const newScrollEl = content.querySelector('#activeConnectionsList');
        if (newScrollEl) newScrollEl.scrollTop = prevScrollTop;
      }

      this.applyConnectionFilter(container);

      if (searchWasFocused) {
        const newSearchEl = content.querySelector('#connectionSearch');
        if (newSearchEl) {
          newSearchEl.focus();
          if (searchSelectionStart !== null) newSearchEl.setSelectionRange(searchSelectionStart, searchSelectionEnd);
        }
      }
    } catch (e) {
      if (isInitial) {
        content.innerHTML = `<div class="empty-state">${escapeHtml(t('network.error', { error: e.message }))}</div>`;
      } else {
        console.error('Network refresh failed:', e);
      }
    }
  },

  applyConnectionFilter(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const content = container.querySelector('#networkContent');
    if (!content) return;
    const listEl = content.querySelector('#activeConnectionsList');
    const countEl = content.querySelector('#connectionCount');
    const noResultsEl = content.querySelector('#connectionNoResults');
    if (!listEl) return;

    const query = (this._connectionQuery || '').trim().toLowerCase();
    const riskFilter = this._connectionRiskFilter || 'all';
    const stateFilter = this._connectionStateFilter || 'all';
    
    // Handle grouped view
    if (this._groupByProcess) {
      const groups = listEl.querySelectorAll('.process-group');
      let visibleGroups = 0;
      let totalConnections = 0;

      groups.forEach((group) => {
        const rows = group.querySelectorAll('.connection-row');
        let visibleInGroup = 0;

        rows.forEach((row) => {
          const searchMatches = !query || (row.dataset.search || '').includes(query);
          const riskMatches = riskFilter === 'all' || row.dataset.risk === riskFilter;
          const stateMatches = stateFilter === 'all' || row.dataset.state === stateFilter;
          const matches = searchMatches && riskMatches && stateMatches;
          row.style.display = matches ? '' : 'none';
          if (matches) visibleInGroup += 1;
        });

        // Show/hide group based on visible connections
        group.style.display = visibleInGroup > 0 ? 'block' : 'none';
        if (visibleInGroup > 0) visibleGroups += 1;
        totalConnections += rows.length;
      });
      
      if (countEl) {
        countEl.textContent = query
          ? t('network.connectionCountFiltered', { visible: visibleGroups, total: groups.length })
          : t('network.connectionCount', { count: groups.length });
      }
      if (noResultsEl) {
        noResultsEl.style.display = (groups.length > 0 && visibleGroups === 0) ? '' : 'none';
      }
    } else {
      // Flat list view
      const rows = listEl.querySelectorAll('.connection-row');
      let visible = 0;

      rows.forEach((row) => {
        const searchMatches = !query || (row.dataset.search || '').includes(query);
        const riskMatches = riskFilter === 'all' || row.dataset.risk === riskFilter;
        const stateMatches = stateFilter === 'all' || row.dataset.state === stateFilter;
        const matches = searchMatches && riskMatches && stateMatches;
        row.style.display = matches ? '' : 'none';
        if (matches) visible += 1;
      });

      if (countEl) {
        countEl.textContent = query
          ? t('network.connectionCountFiltered', { visible, total: rows.length })
          : t('network.connectionCount', { count: rows.length });
      }
      if (noResultsEl) {
        noResultsEl.style.display = (rows.length > 0 && visible === 0) ? '' : 'none';
      }
    }
  },

  _niceAxisMax(value) {
    if (!(value > 0)) return 1;
    const exp = Math.floor(Math.log10(value));
    const base = Math.pow(10, exp);
    const norm = value / base;
    let niceNorm;
    if (norm <= 1) niceNorm = 1;
    else if (norm <= 2) niceNorm = 2;
    else if (norm <= 5) niceNorm = 5;
    else niceNorm = 10;
    return niceNorm * base;
  },

  async paintHistoryChart(content) {
    const canvas = content.querySelector('#networkHistoryChart');
    const empty = content.querySelector('#networkHistoryEmpty');
    const legend = content.querySelector('#networkHistoryLegend');
    const tooltip = content.querySelector('#networkHistoryTooltip');
    if (!canvas) return;
    const networkTrafficHistoryEnabled = await window.api.invoke('db:getSetting', 'feature.networkTrafficHistory', true);
    if (!networkTrafficHistoryEnabled) return;
    let rows = [];
    try {
      rows = await window.api.invoke('network:history', { hours: 24 }) || [];
    } catch (_) {
      rows = [];
    }
    if (!rows.length) {
      if (empty) empty.style.display = '';
      canvas.style.display = 'none';
      if (legend) legend.innerHTML = '';
      if (tooltip) tooltip.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    canvas.style.display = 'block';

    const buckets = new Map();
    for (const row of rows) {
      const key = row.recorded_at;
      const cur = buckets.get(key) || { t: key, rx: 0, tx: 0 };
      cur.rx += Number(row.rx_sec) || 0;
      cur.tx += Number(row.tx_sec) || 0;
      buckets.set(key, cur);
    }
    const series = [...buckets.values()].sort((a, b) => a.t.localeCompare(b.t));
    const maxRaw = Math.max(1, ...series.map((p) => Math.max(p.rx, p.tx)));
    const maxY = this._niceAxisMax(maxRaw);

    // --- legend: current + 24h peak for each direction ---
    const last = series[series.length - 1];
    const peakRx = Math.max(...series.map((p) => p.rx));
    const peakTx = Math.max(...series.map((p) => p.tx));
    if (legend) {
      const legendRow = (color, glow, label, current, peak) => `
        <span style="display:flex; align-items:center; gap:6px;">
          <span style="width:8px; height:8px; border-radius:50%; background:${color}; box-shadow:0 0 6px ${glow}; display:inline-block; flex-shrink:0;"></span>
          ${escapeHtml(label)}
          <strong style="color:var(--text-main); font-weight:600;">${escapeHtml(formatBytes(current))}/s</strong>
          <span style="opacity:0.7;">${escapeHtml(t('network.historyPeak', { value: `${formatBytes(peak)}/s` }))}</span>
        </span>`;
      legend.innerHTML =
        legendRow('var(--accent-primary)', 'var(--accent-primary-glow)', t('network.historyDownload'), last.rx, peakRx) +
        legendRow('var(--ok)', 'var(--ok-glow)', t('network.historyUpload'), last.tx, peakTx);
    }

    // --- high-DPI canvas sizing ---
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width) || canvas.parentElement.clientWidth || 600);
    const cssH = Math.max(1, Math.round(rect.height) || 190);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padL = 64, padR = 8, padT = 10, padB = 20;
    const plotW = Math.max(1, cssW - padL - padR);
    const plotH = Math.max(1, cssH - padT - padB);
    const xAt = (i) => padL + (series.length > 1 ? (i / (series.length - 1)) * plotW : plotW / 2);
    const yAt = (v) => padT + plotH - (Math.min(v, maxY) / maxY) * plotH;

    const rootStyle = getComputedStyle(canvas);
    const cssVar = (name, fallback) => {
      const v = rootStyle.getPropertyValue(name).trim();
      return v && !v.includes('var(') ? v : fallback;
    };
    const colorRx = cssVar('--accent-primary', '#58A6FF');
    const colorTx = cssVar('--accent-success', '#3FB950');
    const textDim = cssVar('--text-dim', cssVar('--text-muted', 'rgba(139,148,158,0.85)'));
    const fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, Arial, sans-serif';
    const gridColor = 'rgba(127,135,150,0.14)';

    const pathThrough = (pts) => {
      const p = new Path2D();
      if (!pts.length) return p;
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        p.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      if (pts.length > 1) {
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        p.quadraticCurveTo(a.x, a.y, b.x, b.y);
      }
      return p;
    };

    const draw = (hoverIdx) => {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.font = `11px ${fontFamily}`;
      ctx.textBaseline = 'middle';

      // horizontal grid + y-axis labels
      const ySteps = [0, 0.5, 1];
      ySteps.forEach((frac) => {
        const y = padT + plotH - frac * plotH;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(y) + 0.5);
        ctx.lineTo(padL + plotW, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.fillStyle = textDim;
        ctx.textAlign = 'right';
        ctx.fillText(`${formatBytes(frac * maxY)}/s`, padL - 8, y);
      });

      // x-axis time labels
      const tickCount = Math.min(5, series.length);
      ctx.fillStyle = textDim;
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i < tickCount; i++) {
        const idx = tickCount > 1 ? Math.round((i / (tickCount - 1)) * (series.length - 1)) : 0;
        const label = new Date(series[idx].t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        ctx.textAlign = i === 0 ? 'left' : (i === tickCount - 1 ? 'right' : 'center');
        ctx.fillText(label, xAt(idx), cssH - 4);
      }
      ctx.textBaseline = 'middle';

      const rxPts = series.map((p, i) => ({ x: xAt(i), y: yAt(p.rx) }));
      const txPts = series.map((p, i) => ({ x: xAt(i), y: yAt(p.tx) }));

      const fillArea = (pts, color) => {
        if (!pts.length) return;
        const areaPath = new Path2D(pathThrough(pts));
        areaPath.lineTo(pts[pts.length - 1].x, padT + plotH);
        areaPath.lineTo(pts[0].x, padT + plotH);
        areaPath.closePath();
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, color.replace('__A__', '0.30'));
        grad.addColorStop(1, color.replace('__A__', '0'));
        ctx.fillStyle = grad;
        ctx.fill(areaPath);
      };
      const strokeLine = (pts, color) => {
        if (!pts.length) return;
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.25;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(pathThrough(pts));
        ctx.restore();
      };
      const toRgba = (hex, a) => {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return `rgba(88,166,255,${a})`;
        return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
      };

      fillArea(txPts, toRgba(colorTx, '__A__'));
      fillArea(rxPts, toRgba(colorRx, '__A__'));
      strokeLine(txPts, colorTx);
      strokeLine(rxPts, colorRx);

      // glowing marker on the latest sample of each series
      [{ pts: rxPts, color: colorRx }, { pts: txPts, color: colorTx }].forEach(({ pts, color }) => {
        const p = pts[pts.length - 1];
        if (!p) return;
        ctx.save();
        ctx.fillStyle = toRgba(color, 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // hover crosshair + point markers
      if (hoverIdx != null && series[hoverIdx]) {
        const x = xAt(hoverIdx);
        ctx.save();
        ctx.strokeStyle = 'rgba(200,205,215,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        [{ y: yAt(series[hoverIdx].rx), color: colorRx }, { y: yAt(series[hoverIdx].tx), color: colorTx }].forEach(({ y, color }) => {
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#0B0E14';
          ctx.stroke();
        });
        ctx.restore();
      }
    };

    draw(null);

    // --- interactive tooltip ---
    let rafPending = false;
    const handleMove = (evt) => {
      const r = canvas.getBoundingClientRect();
      const x = evt.clientX - r.left;
      let idx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < series.length; i++) {
        const d = Math.abs(xAt(i) - x);
        if (d < bestDist) { bestDist = d; idx = i; }
      }
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        draw(idx);
        if (tooltip) {
          const p = series[idx];
          const timeLabel = new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          tooltip.innerHTML = `
            <div style="color:var(--text-dim); margin-bottom:3px;">${escapeHtml(timeLabel)}</div>
            <div style="display:flex; align-items:center; gap:6px;"><span style="width:7px; height:7px; border-radius:50%; background:${colorRx}; display:inline-block;"></span>${escapeHtml(t('network.historyDownload'))} <strong>${escapeHtml(formatBytes(p.rx))}/s</strong></div>
            <div style="display:flex; align-items:center; gap:6px;"><span style="width:7px; height:7px; border-radius:50%; background:${colorTx}; display:inline-block;"></span>${escapeHtml(t('network.historyUpload'))} <strong>${escapeHtml(formatBytes(p.tx))}/s</strong></div>`;
          const px = xAt(idx);
          const py = Math.min(yAt(p.rx), yAt(p.tx));
          tooltip.style.left = `${Math.max(50, Math.min(cssW - 50, px))}px`;
          tooltip.style.top = `${Math.max(46, py)}px`;
          tooltip.style.display = 'block';
        }
      });
    };
    const handleLeave = () => {
      draw(null);
      if (tooltip) tooltip.style.display = 'none';
    };
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseleave', handleLeave);
  },

  async renderAlertHits(content) {
    const list = content.querySelector('#networkAlertsList');
    if (!list) return;
    let status = { recentHits: [] };
    try {
      status = await window.api.invoke('network-alerts:status') || status;
    } catch (_) {}
    const hits = status.recentHits || [];

    const hitsKey = hits.map(h => h.key).join('|');
    if (this._lastAlertHitsKey === hitsKey && list.innerHTML && !list.classList.contains('empty-state')) {
      return;
    }
    this._lastAlertHitsKey = hitsKey;

    if (!hits.length) {
      list.className = 'empty-state';
      list.style.fontSize = '0.8rem';
      list.textContent = t('network.alertsNone');
      return;
    }

    list.className = '';
    list.style.fontSize = '';

    const showAll = this._alertsExpanded;
    const displayHits = showAll ? hits.slice(0, 8) : hits.slice(0, 1);
    const hasMore = hits.length > 1;

    list.innerHTML = displayHits.map((h) => {
      const alertType = h.classification === 'MALICIOUS' ? 'blockedIp' : 'suspiciousActivity';
      const alertTitle = t(`network.alert.${alertType}`);
      const alertDesc = t(`network.alert.${alertType}Desc`);
      
      return `
      <div class="list-row" style="display:flex; flex-direction:column; gap:8px; padding:12px; border-bottom:1px solid var(--glass-border); background:var(--bg-surface); border-radius:6px; border-left:3px solid var(--danger);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
          <div style="flex:1;">
            <div style="font-weight:600; font-size:0.85rem; color:var(--danger); margin-bottom:4px;">${escapeHtml(alertTitle)}</div>
            <div style="font-family:monospace; font-size:0.9rem; margin-bottom:4px;">${escapeHtml(h.remoteAddress || '')}${h.remotePort ? ':' + escapeHtml(h.remotePort) : ''}</div>
            <div style="font-size:0.8rem; color:var(--text-dim); margin-bottom:6px;">${escapeHtml(alertDesc)}</div>
            <div class="page-subtitle" style="font-size:0.75rem;">${escapeHtml(t('network.alertPidState', { pid: h.pid || 'n/a', state: h.state || '' }))}</div>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
          <div style="font-size:0.75rem; font-weight:600; color:var(--text-dim);">${escapeHtml(t('network.alert.recommendation'))}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" style="font-size:0.75rem; padding:4px 10px;" data-alert-block="${escapeHtml(h.remoteAddress || '')}">${escapeHtml(t('network.alert.blockIp'))}</button>
            <button class="btn btn-sm" style="font-size:0.75rem; padding:4px 10px; color:var(--accent-danger);" data-alert-kill="${escapeHtml(h.pid || '')}" ${h.pid ? '' : 'disabled'}>${escapeHtml(t('network.alert.terminateConnection'))}</button>
            <button class="btn btn-sm" style="font-size:0.75rem; padding:4px 10px;" data-alert-ignore="${escapeHtml(h.key)}">${escapeHtml(t('network.alertIgnore'))}</button>
          </div>
        </div>
      </div>
    `}).join('');

    if (hasMore) {
      const expandBtn = document.createElement('button');
      expandBtn.className = 'btn btn-sm';
      expandBtn.style.cssText = 'margin-top:6px; font-size:0.75rem; padding:4px 8px;';
      expandBtn.textContent = showAll ? t('network.alertShowLess', { count: hits.length - 1 }) : t('network.alertShowMore', { count: hits.length - 1 });
      expandBtn.onclick = () => {
        this._alertsExpanded = !this._alertsExpanded;
        this.renderAlertHits(content);
      };
      list.appendChild(expandBtn);
    }

    this.bindAlertActions(content);
  },

  bindAlertActions(content) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    content.querySelectorAll('[data-alert-ignore]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await window.api.invoke('network-alerts:ignore', btn.getAttribute('data-alert-ignore'));
          btn.closest('.list-row')?.remove();
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    });
    content.querySelectorAll('[data-alert-kill]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const res = await window.api.invoke('network-alerts:kill', Number(btn.getAttribute('data-alert-kill')));
          if (!res || !res.success) alert((res && res.error) || t('network.alertKillFailed'));
          else btn.closest('.list-row')?.remove();
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    });
    content.querySelectorAll('[data-alert-block]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const ip = btn.getAttribute('data-alert-block');
          await window.api.invoke('firewall:addRule', {
            direction: 'inbound',
            action: 'block',
            remoteAddress: ip
          });
          btn.textContent = 'Blocked';
          btn.disabled = true;
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    });
  },

  async toggleVpn(container, name, action) {
    if (this._vpnPending || !name) return;
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    this._vpnPending = { name, action: action === 'disconnect' ? 'disconnect' : 'connect' };
    this._vpnError = '';

    const btn = container.querySelector('#vpnToggleBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = t('network.vpnWorking');
    }
    const status = container.querySelector('#vpnStatusText');
    if (status) {
      status.style.color = 'var(--text-dim)';
      status.textContent = action === 'disconnect'
        ? t('network.vpnDisconnecting', { name })
        : t('network.vpnConnecting', { name });
    }

    try {
      const res = await window.api.invoke(action === 'disconnect' ? 'network:vpn:disconnect' : 'network:vpn:connect', name);
      if (!res || !res.ok) {
        this._vpnError = (res && res.error) || 'VPN action failed';
        if (status) {
          status.style.color = 'var(--danger)';
          status.textContent = this._vpnError;
        }
      }
    } catch (err) {
      this._vpnError = err.message || String(err);
      if (status) {
        status.style.color = 'var(--danger)';
        status.textContent = this._vpnError;
      }
    } finally {
      this._vpnPending = null;
      this.load(container, false);
    }
  },

  destroy() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._connectionQuery = '';
    this._connectionRiskFilter = 'all';
    this._connectionStateFilter = 'all';
    this._geoCache = {};
    this._selectedClusterIps = null;
    this._selectedClusterLoc = null;
    this._worldMapBgEl = null;
    this._alertsPanelEl = null;
    this._alertsExpanded = false;
    this._lastAlertHitsKey = null;
    this._vpnPending = null;
    this._vpnError = '';
  }
};