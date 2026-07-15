window.Pages = window.Pages || {};
window.Pages['network'] = {
  REFRESH_INTERVAL_MS: 3000,
  _connectionQuery: '',
  _connectionRiskFilter: 'all',
  _connectionStateFilter: 'all',
  _geoCache: {},
  render(container) {
    // Clear any previous auto-refresh timer (e.g. if this page is re-rendered)
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    container.innerHTML = `
      <style>
        /* GPU-accelerated pulse: animating transform + opacity (instead of
           box-shadow) keeps this off the main-thread paint path, so it
           doesn't fight page scrolling for repaint budget. The ring is a
           ::after pseudo-element with its own transform, so it can animate
           scale independently of the marker's own centering transform. */
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
        <h1 class="page-title">Network Monitor</h1>
        <p class="page-subtitle">Active connections and interface bandwidth</p>
      </header>
      <div id="networkContent">
        <div class="empty-state"><span class="spinner"></span>&nbsp;Loading network stats\u2026</div>
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
        }
      });
    }

    // Auto-refresh bandwidth + connections in real time. Stops itself if the
    // page has been navigated away from (container removed from the DOM).
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
    const content = container.querySelector('#networkContent');
    if (!content) return;
    // Preserve the connection list's scroll position across silent refreshes.
    const prevScrollEl = content?.querySelector('#activeConnectionsList');
    const prevScrollTop = prevScrollEl ? prevScrollEl.scrollTop : 0;
    // Preserve focus/cursor position in the connection search box too, since
    // content.innerHTML is fully rebuilt on every refresh (including silent
    // background ones) and would otherwise steal focus mid-keystroke.
    const prevSearchEl = content?.querySelector('#connectionSearch');
    const searchWasFocused = !!(prevSearchEl && document.activeElement === prevSearchEl);
    const searchSelectionStart = prevSearchEl ? prevSearchEl.selectionStart : null;
    const searchSelectionEnd = prevSearchEl ? prevSearchEl.selectionEnd : null;
    try {
      const [statsResult, connectionsResult] = await Promise.allSettled([
        window.api.invoke('network:stats'),
        window.api.invoke('network:connections')
      ]);

      // Verify container is still in DOM after async operation
      if (!document.body.contains(container)) {
        return;
      }

      const stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
      const connections = connectionsResult.status === 'fulfilled' ? connectionsResult.value : null;

      let html = '';

      // Windows Get-NetTCPConnection can return the State field as a raw
      // numeric code instead of a friendly name depending on how it was queried.
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
      // Helper: pick a field that may legitimately be 0 (e.g. port on a
      // listening socket) without falling through to a fallback via `||`.
      const firstDefined = (...vals) => {
        for (const v of vals) {
          if (v !== undefined && v !== null && v !== '') return v;
        }
        return '';
      };

      // Shared filter logic for the connection search box + risk/state
      // selects -- used both to drive the heat map's cluster data below
      // (so filtering actually affects what's plotted) and, further down,
      // to build each row's data-search/data-risk/data-state attributes
      // that applyConnectionFilter() reads for its instant DOM show/hide.
      // Keeping one implementation avoids the map and the list silently
      // drifting out of sync on what "matches the current filters" means.
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

      // Classification counts (used by the Security Flags panel)
      const safeCount = connections ? connections.filter(c => c.classification === 'SAFE').length : 0;
      const maliciousCount = connections ? connections.filter(c => c.classification === 'MALICIOUS').length : 0;
      const unknownCount = connections ? connections.length - safeCount - maliciousCount : 0;

      // Connection state counts (used by the Protocol Pie)
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

      // Connection state summary
      if (stats && stats.connections) {
        const c = stats.connections;
        html += `<div class="grid grid-5" style="margin-bottom:18px;">
          <div class="stat-tile"><div class="stat-label">Total TCP</div><div class="stat-value">${c.total}</div></div>
          <div class="stat-tile"><div class="stat-label">Established</div><div class="stat-value" style="color:var(--ok);">${c.established}</div></div>
          <div class="stat-tile"><div class="stat-label">Listening</div><div class="stat-value" style="color:var(--accent-primary);">${c.listen}</div></div>
          <div class="stat-tile"><div class="stat-label">Time Wait</div><div class="stat-value" style="color:var(--warn);">${c.timeWait}</div></div>
          <div class="stat-tile"><div class="stat-label">Close Wait</div><div class="stat-value" style="color:var(--danger);">${c.closeWait}</div></div>
        </div>`;
      }

      // Bandwidth + Protocol Pie + Security Flags row
      html += '<div style="display:flex; gap:16px; margin-bottom:18px; flex-wrap:wrap; align-items:stretch;">';

      // Bandwidth
      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      html += '<h3 style="margin-bottom:10px; font-size:1rem;">Bandwidth</h3>';
      if (stats && stats.interfaces && stats.interfaces.length > 0) {
        html += '<div style="display:flex; flex-direction:column; gap:8px;">';
        for (const iface of stats.interfaces) {
          html += `<div class="stat-tile">
            <div class="stat-label">${escapeHtml(iface.iface)}</div>
            <div class="stat-value" style="font-size:0.85rem;">
              \u25B2 ${iface.txSec} KB/s &nbsp; \u25BC ${iface.rxSec} KB/s
            </div>
            <div style="font-size:0.7rem; color:var(--text-dim);">
              Total: \u25B2 ${iface.txTotal} MB / \u25BC ${iface.rxTotal} MB
            </div>
          </div>`;
        }
        html += '</div>';
      } else {
        html += '<div class="empty-state" style="font-size:0.85rem;">No interface data.</div>';
      }
      html += '</div></div>';

      // Protocol Pie
      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      html += '<h3 style="margin-bottom:10px; font-size:1rem;">Connection States</h3>';
      if (stateTotal === 0) {
        html += '<div class="empty-state" style="font-size:0.85rem;">No connection data.</div>';
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

      // Security Flags
      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      html += '<h3 style="margin-bottom:10px; font-size:1rem;">Security Flags</h3>';
      html += `<div style="display:flex; flex-direction:column; gap:8px; font-size:0.85rem;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="display:flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:var(--ok); display:inline-block;"></span>Safe</span>
          <span style="font-weight:600; color:var(--ok);">${safeCount}</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="display:flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:var(--warn); display:inline-block;"></span>Unverified</span>
          <span style="font-weight:600; color:var(--warn);">${unknownCount}</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="display:flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:var(--danger); display:inline-block;"></span>Malicious</span>
          <span style="font-weight:600; color:var(--danger);">${maliciousCount}</span>
        </div>
      </div>`;
      html += '</div></div>';

      html += '</div>'; // end bandwidth/pie/flags row

      // Traffic history chart (persisted network_stats samples)
      html += '<div class="card" style="padding:14px 16px; margin-bottom:18px;">';
      html += '<h3 style="margin-bottom:10px; font-size:1rem;">Traffic history (24h)</h3>';
      html += '<canvas id="networkHistoryChart" width="900" height="180" style="width:100%; max-height:180px;"></canvas>';
      html += '<div id="networkHistoryEmpty" class="empty-state" style="font-size:0.85rem; display:none;">No historical samples yet — samples are recorded every 30 seconds while the app runs.</div>';
      html += '</div>';

      // Recent suspicious network alert actions
      html += '<div class="card" style="padding:14px 16px; margin-bottom:18px;" id="networkAlertsPanel">';
      html += '<h3 style="margin-bottom:10px; font-size:1rem;">Suspicious connection alerts</h3>';
      html += '<div id="networkAlertsList" class="empty-state" style="font-size:0.85rem;">Loading alerts…</div>';
      html += '</div>';

      // Heat Map
      const uniqueIps = [...new Set(connections ? connections.map(c => firstDefined(c.remoteAddress, c.RemoteAddress)).filter(Boolean) : [])];
      const uncachedIps = uniqueIps.filter((ip) => !(ip in this._geoCache));
      if (uncachedIps.length) {
        try {
          const fresh = await window.api.invoke('network:geo', uncachedIps);
          // Verify container is still in DOM after async operation
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

      // Three distinct numbers, mirroring the same "total vs filtered vs
      // actually shown" distinction the connections list below makes:
      // total connections regardless of filters, how many match the
      // current search/risk/state filters, and how many of THOSE actually
      // have resolved geolocation data (private IPs, failed lookups, etc.
      // never get a dot no matter what).
      const totalConnectionsCount = (connections || []).length;
      const filteredConnectionsCount = filteredConnections.length;
      const mappedCount = filteredConnections.filter((c) => {
        const ip = firstDefined(c.remoteAddress, c.RemoteAddress);
        return !!geoData[ip];
      }).length;

      if (Object.keys(geoData).length > 0) {
        html += '<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px; flex-wrap:wrap; gap:8px;">';
        html += `<div>
          <h3 style="margin:0; font-size:1rem;">Active Connections Heat Map</h3>
          <div style="font-size:0.75rem; color:var(--text-dim); margin-top:2px;">${totalConnectionsCount} total connection${totalConnectionsCount === 1 ? '' : 's'} \u00b7 ${filteredConnectionsCount} match current filters \u00b7 ${mappedCount} mapped</div>
        </div>`;
        html += `<div style="display:flex; gap:12px; font-size:0.75rem; font-weight:600;">
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--ok);"></span> Safe</span>
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--warn);"></span> Unverified</span>
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--danger);"></span> Malicious</span>
        </div>`;
        html += '</div>';

        html += `<div class="card" style="padding:0; margin-bottom:18px; position:relative; background-color:var(--bg-panel); overflow:hidden; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
          <div id="heatmapMapBgMount"></div>
          <div style="position:absolute; top:0; left:0; bottom:0; right:0; pointer-events:none; z-index:2;">`;

        if (mappedCount === 0) {
          html += `<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); text-align:center; font-size:0.85rem; color:var(--text-dim); white-space:nowrap;">No connections match your current filters.</div>`;
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
          const locList = Array.from(c.locations).join(' | ') || 'Unverified Location';
          
          html += `<div class="heatmap-marker ${pulseClass}" data-ips="${ipList}" data-loc="${escapeHtml(locList)}"
            title="${escapeHtml(locList)}\nIPs: ${ipList}\nConnections: ${c.count}"
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
              <div style="font-weight:600; font-size:0.9rem;">${escapeHtml(loc || 'Cluster Details')}</div>
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

      // Active connections list
      html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap;">
        <h3 style="margin:0; font-size:1rem;">Active Connections</h3>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span id="connectionCount" class="page-subtitle" style="font-size:0.8rem; white-space:nowrap;"></span>
          <select id="connectionStateFilter" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
            <option value="all" ${this._connectionStateFilter === 'all' ? 'selected' : ''}>All States</option>
            <option value="ESTABLISHED" ${this._connectionStateFilter === 'ESTABLISHED' ? 'selected' : ''}>Established</option>
            <option value="LISTEN" ${this._connectionStateFilter === 'LISTEN' ? 'selected' : ''}>Listen</option>
            <option value="TIME_WAIT" ${this._connectionStateFilter === 'TIME_WAIT' ? 'selected' : ''}>Time Wait</option>
            <option value="CLOSE_WAIT" ${this._connectionStateFilter === 'CLOSE_WAIT' ? 'selected' : ''}>Close Wait</option>
            <option value="BOUND" ${this._connectionStateFilter === 'BOUND' ? 'selected' : ''}>Bound</option>
          </select>
          <select id="connectionRiskFilter" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
            <option value="all" ${this._connectionRiskFilter === 'all' ? 'selected' : ''}>All Risks</option>
            <option value="SAFE" ${this._connectionRiskFilter === 'SAFE' ? 'selected' : ''}>Allowed</option>
            <option value="UNKNOWN" ${this._connectionRiskFilter === 'UNKNOWN' ? 'selected' : ''}>Unverified</option>
            <option value="MALICIOUS" ${this._connectionRiskFilter === 'MALICIOUS' ? 'selected' : ''}>Blocked</option>
          </select>
          <input type="text" id="connectionSearch" placeholder="Search IP, host, process, state\u2026"
            value="${escapeHtml(this._connectionQuery || '')}"
            style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--glass-bg,rgba(255,255,255,0.05)); color:inherit; font-size:0.85rem; width:220px;">
        </div>
      </div>`;
      if (!connections || connections.length === 0) {
        html += '<div class="empty-state">No active connections found.</div>';
      } else {
        // Sort so SAFE connections come first, then UNKNOWN, then MALICIOUS.
        // Within each of those groups, ESTABLISHED connections come first.
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
        for (const c of sortedConnections) {
          const proc = c.processName ? ` (${escapeHtml(c.processName)})` : (c.pid ? ` (PID: ${escapeHtml(c.pid)})` : '');
          const hostname = c.hostname ? ` \u2192 ${escapeHtml(c.hostname)}` : '';
          const service = c.serviceName ? ` [${escapeHtml(c.serviceName)}]` : '';
          const state = getState(c);

          const remoteAddress = firstDefined(c.remoteAddress, c.RemoteAddress);
          const remotePort = firstDefined(c.remotePort, c.RemotePort);
          const localAddress = firstDefined(c.localAddress, c.LocalAddress);
          const localPort = firstDefined(c.localPort, c.LocalPort);

          // Classification badge color
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

          // State badge color (established, listen, time_wait, close_wait, etc.)
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

          const riskDisplay = c.classification === 'UNKNOWN' ? 'UNVERIFIED' : c.classification;

          html += `<div class="list-row connection-row" data-ip="${escapeHtml(remoteAddress)}" data-search="${escapeHtml(searchBlob)}" data-risk="${escapeHtml(c.classification || 'UNKNOWN')}" data-state="${escapeHtml(state)}" style="display:flex; flex-direction:column; gap:4px; padding:12px 16px; border-left:4px solid ${borderColor}; content-visibility:auto; contain-intrinsic-size:0 70px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-weight:600; font-family:monospace; word-break:break-all;">${stateBadge}${escapeHtml(remoteAddress)}:${escapeHtml(remotePort)}${service}${hostname}</div>
                <div class="page-subtitle" style="font-size:0.85rem; word-break:break-all;">Local: ${escapeHtml(localAddress)}:${escapeHtml(localPort)}${proc}</div>
              </div>
              <div style="font-size:0.75rem; font-weight:600; color:${badgeColor}; background:${badgeColor}15; padding:4px 8px; border-radius:4px;">${escapeHtml(riskDisplay)}</div>
            </div>
          </div>`;
        }
        html += '</div>';
        html += '<div id="connectionNoResults" class="empty-state" style="display:none; margin-top:8px;">No connections match your search.</div>';
      }

      content.innerHTML = html;
      this.paintHistoryChart(content).catch(() => {});
      this.renderAlertHits(content).catch(() => {});

      // The world map background (grid overlay + <img>) is static and never
      // changes between refreshes, so instead of letting content.innerHTML
      // tear it down and force the browser to re-decode the image every
      // REFRESH_INTERVAL_MS, build it once and reuse the same DOM node,
      // moving it into the fresh placeholder each time. Moving an already-
      // loaded <img> node doesn't trigger a reload/re-decode.
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

      // Restore scroll position of the connections list so a background
      // refresh doesn't yank the user back to the top of the list.
      if (prevScrollTop) {
        const newScrollEl = content.querySelector('#activeConnectionsList');
        if (newScrollEl) newScrollEl.scrollTop = prevScrollTop;
      }

      // Re-apply the connection search filter, since content.innerHTML was
      // just rebuilt from scratch (this happens on every refresh, not just
      // the first load).
      this.applyConnectionFilter(container);

      // If the user was actively typing in the search box when this refresh
      // landed, restore focus and cursor position on the new input so it
      // doesn't feel like the page yanked focus away mid-keystroke.
      if (searchWasFocused) {
        const newSearchEl = content.querySelector('#connectionSearch');
        if (newSearchEl) {
          newSearchEl.focus();
          if (searchSelectionStart !== null) newSearchEl.setSelectionRange(searchSelectionStart, searchSelectionEnd);
        }
      }
    } catch (e) {
      if (isInitial) {
        content.innerHTML = `<div class="empty-state">Error loading network: ${escapeHtml(e.message)}</div>`;
      } else {
        console.error('Network refresh failed:', e);
      }
    }
  },

  // Shows/hides already-rendered .connection-row elements based on the
  // current search query. No backend calls, no HTML re-parsing — just a
  // display toggle on nodes that already exist, so it's instant.
  applyConnectionFilter(container) {
    const content = container.querySelector('#networkContent');
    if (!content) return;
    const listEl = content.querySelector('#activeConnectionsList');
    const countEl = content.querySelector('#connectionCount');
    const noResultsEl = content.querySelector('#connectionNoResults');
    if (!listEl) return;

    const query = (this._connectionQuery || '').trim().toLowerCase();
    const riskFilter = this._connectionRiskFilter || 'all';
    const stateFilter = this._connectionStateFilter || 'all';
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
        ? `${visible} of ${rows.length} connections`
        : `${rows.length} connection${rows.length === 1 ? '' : 's'}`;
    }
    if (noResultsEl) {
      noResultsEl.style.display = (rows.length > 0 && visible === 0) ? '' : 'none';
    }
  },

  async paintHistoryChart(content) {
    const canvas = content.querySelector('#networkHistoryChart');
    const empty = content.querySelector('#networkHistoryEmpty');
    if (!canvas) return;
    let rows = [];
    try {
      rows = await window.api.invoke('network:history', { hours: 24 }) || [];
    } catch (_) {
      rows = [];
    }
    if (!rows.length) {
      if (empty) empty.style.display = '';
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    if (empty) empty.style.display = 'none';

    // Aggregate all interfaces into one rx/tx series by timestamp bucket.
    const buckets = new Map();
    for (const row of rows) {
      const key = row.recorded_at;
      const cur = buckets.get(key) || { t: key, rx: 0, tx: 0 };
      cur.rx += Number(row.rx_sec) || 0;
      cur.tx += Number(row.tx_sec) || 0;
      buckets.set(key, cur);
    }
    const series = [...buckets.values()].sort((a, b) => a.t.localeCompare(b.t));
    const maxY = Math.max(1, ...series.map((p) => Math.max(p.rx, p.tx)));
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const pad = 12;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(127,127,127,0.25)';
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();

    const plot = (key, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      series.forEach((p, i) => {
        const x = pad + (i / Math.max(1, series.length - 1)) * (w - pad * 2);
        const y = (h - pad) - (p[key] / maxY) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    plot('rx', '#58A6FF');
    plot('tx', '#3FB950');
  },

  async renderAlertHits(content) {
    const list = content.querySelector('#networkAlertsList');
    if (!list) return;
    let status = { recentHits: [] };
    try {
      status = await window.api.invoke('network-alerts:status') || status;
    } catch (_) {}
    const hits = status.recentHits || [];
    if (!hits.length) {
      list.className = 'empty-state';
      list.style.fontSize = '0.85rem';
      list.textContent = 'No blocklisted connections detected this session.';
      return;
    }
    list.className = '';
    list.style.fontSize = '';
    list.innerHTML = hits.slice(0, 8).map((h) => `
      <div class="list-row" style="display:flex; justify-content:space-between; gap:12px; align-items:center; padding:10px 0; border-bottom:1px solid var(--glass-border);">
        <div style="font-size:0.85rem;">
          <div style="font-weight:600; font-family:monospace;">${escapeHtml(h.remoteAddress || '')}${h.remotePort ? ':' + escapeHtml(h.remotePort) : ''}</div>
          <div class="page-subtitle">PID ${escapeHtml(h.pid || 'n/a')} · ${escapeHtml(h.state || '')}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-sm" data-alert-ignore="${escapeHtml(h.key)}">Ignore</button>
          <button class="btn btn-sm" style="color:var(--accent-danger);" data-alert-kill="${escapeHtml(h.pid || '')}" ${h.pid ? '' : 'disabled'}>Kill</button>
        </div>
      </div>
    `).join('');
    this.bindAlertActions(content);
  },

  bindAlertActions(content) {
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
          if (!res || !res.success) alert((res && res.error) || 'Kill failed');
          else btn.closest('.list-row')?.remove();
        } catch (e) {
          alert(e.message || String(e));
        }
      };
    });
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
  }
};