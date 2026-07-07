window.Pages = window.Pages || {};
window.Pages['network'] = {
  REFRESH_INTERVAL_MS: 3000,
  _connectionQuery: '', // persists the active-connections search across refreshes
  _connectionRiskFilter: 'all',
  _connectionStateFilter: 'all',
  render(container) {
    // Clear any previous auto-refresh timer (e.g. if this page is re-rendered)
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    container.innerHTML = `
      <style>
        @keyframes heatmapPulseMalicious {
          0% { box-shadow: 0 0 0 0 rgba(232, 95, 92, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(232, 95, 92, 0); }
          100% { box-shadow: 0 0 0 0 rgba(232, 95, 92, 0); }
        }
        .heatmap-pulse-malicious {
          animation: heatmapPulseMalicious 2s infinite;
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
        <div class="empty-state">Loading network stats\u2026</div>
        <div class="loading-progress" style="margin-top:8px;">
          <div class="loading-progress-bar"></div>
        </div>
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
    const progressBar = content?.querySelector('.loading-progress-bar');
    const setLoadingState = (active) => {
      if (!progressBar) return;
      if (!active) {
        progressBar.style.opacity = '0';
        progressBar.style.width = '100%';
        return;
      }
      progressBar.style.opacity = '1';
      progressBar.style.width = '8%';
    };
    // Only show the loading spinner/progress bar on the very first load.
    // Background refreshes update silently so the UI doesn't flicker every
    // few seconds.
    if (isInitial) setLoadingState(true);
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
      const removeProgressListener = window.api.on('network:connections:progress', (data) => {
        if (!progressBar) return;
        const pct = Math.max(8, Math.min((data.completed / data.total) * 100, 100));
        progressBar.style.width = `${pct}%`;
        progressBar.style.opacity = '1';
      });

      const [statsResult, connectionsResult] = await Promise.allSettled([
        window.api.invoke('network:stats'),
        window.api.invoke('network:connections')
      ]);

      if (removeProgressListener) removeProgressListener();
      
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
          <span style="display:flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:var(--warn); display:inline-block;"></span>Unknown</span>
          <span style="font-weight:600; color:var(--warn);">${unknownCount}</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="display:flex; align-items:center; gap:6px;"><span style="width:9px; height:9px; border-radius:50%; background:var(--danger); display:inline-block;"></span>Malicious</span>
          <span style="font-weight:600; color:var(--danger);">${maliciousCount}</span>
        </div>
      </div>`;
      html += '</div></div>';

      html += '</div>'; // end bandwidth/pie/flags row

      // Heat Map
      const uniqueIps = [...new Set(connections ? connections.map(c => firstDefined(c.remoteAddress, c.RemoteAddress)).filter(Boolean) : [])];
      let geoData = {};
      try {
        geoData = await window.api.invoke('network:geo', uniqueIps);
      } catch (e) {
        console.error('Geo lookup failed', e);
      }

      if (Object.keys(geoData).length > 0) {
        html += '<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px;">';
        html += '<h3 style="margin:0; font-size:1rem;">Active Connections Heat Map</h3>';
        html += `<div style="display:flex; gap:12px; font-size:0.75rem; font-weight:600;">
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--ok);"></span> Safe</span>
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--warn);"></span> Unknown</span>
          <span style="display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:50%; background:var(--danger);"></span> Malicious</span>
        </div>`;
        html += '</div>';

        html += `<div class="card" style="padding:0; margin-bottom:18px; position:relative; background-color:var(--bg-panel); overflow:hidden; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
          <div style="position:absolute; top:0; left:0; right:0; bottom:0; background-image: linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px); background-size: 20px 20px; pointer-events:none; z-index:1;"></div>
          <img src="../img/world-map.svg" alt="World Map" style="width:100%; height:auto; opacity:0.35; display:block; pointer-events:none; user-select:none;" />
          <div style="position:absolute; top:0; left:0; bottom:0; right:0; pointer-events:none; z-index:2;">`;

        const clusters = {};
        for (const c of (connections || [])) {
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
          const locList = Array.from(c.locations).join(' | ') || 'Unknown Location';
          
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
          const matchingConns = (connections || []).filter(c => {
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

          html += `<div class="card connection-row" data-ip="${escapeHtml(remoteAddress)}" data-search="${escapeHtml(searchBlob)}" data-risk="${escapeHtml(c.classification || 'UNKNOWN')}" data-state="${escapeHtml(state)}" style="display:flex; flex-direction:column; gap:4px; padding:12px 16px; border-left:4px solid ${borderColor};">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-weight:600; font-family:monospace; word-break:break-all;">${stateBadge}${escapeHtml(remoteAddress)}:${escapeHtml(remotePort)}${service}${hostname}</div>
                <div class="page-subtitle" style="font-size:0.85rem; word-break:break-all;">Local: ${escapeHtml(localAddress)}:${escapeHtml(localPort)}${proc}</div>
              </div>
              <div style="font-size:0.75rem; font-weight:600; color:${badgeColor}; background:${badgeColor}15; padding:4px 8px; border-radius:4px;">${escapeHtml(c.classification || 'UNKNOWN')}</div>
            </div>
          </div>`;
        }
        html += '</div>';
        html += '<div id="connectionNoResults" class="empty-state" style="display:none; margin-top:8px;">No connections match your search.</div>';
      }

      content.innerHTML = html + '<div class="loading-progress" style="margin-top:16px;"><div class="loading-progress-bar" style="width:100%;opacity:1"></div></div>';

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
        // Don't blow away a working display just because one background
        // refresh tick failed (e.g. a transient PowerShell hiccup).
        console.error('Network refresh failed:', e);
      }
    } finally {
      if (isInitial) setLoadingState(false);
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
  }
};