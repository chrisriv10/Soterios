window.Pages = window.Pages || {};
window.Pages['network'] = {
  REFRESH_INTERVAL_MS: 3000,
  render(container) {
    // Clear any previous auto-refresh timer (e.g. if this page is re-rendered)
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    container.innerHTML = `
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
    let progressTimer = null;
    const setLoadingState = (active) => {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      if (!progressBar) return;
      if (!active) {
        progressBar.style.opacity = '0';
        progressBar.style.width = '100%';
        return;
      }
      progressBar.style.opacity = '1';
      progressBar.style.width = '8%';
      let currentWidth = 8;
      progressTimer = setInterval(() => {
        currentWidth = Math.min(currentWidth + Math.random() * 12 + 4, 88);
        progressBar.style.width = `${currentWidth}%`;
      }, 180);
    };
    // Only show the loading spinner/progress bar on the very first load.
    // Background refreshes update silently so the UI doesn't flicker every
    // few seconds.
    if (isInitial) setLoadingState(true);
    // Preserve the connection list's scroll position across silent refreshes.
    const prevScrollEl = content?.querySelector('#activeConnectionsList');
    const prevScrollTop = prevScrollEl ? prevScrollEl.scrollTop : 0;
    try {
      const [statsResult, connectionsResult] = await Promise.allSettled([
        window.api.invoke('network:stats'),
        window.api.invoke('network:connections')
      ]);
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

      // Active connections list
      html += '<h3 style="margin-bottom:10px; font-size:1rem;">Active Connections</h3>';
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

          html += `<div class="card" style="display:flex; flex-direction:column; gap:4px; padding:12px 16px; border-left:4px solid ${borderColor};">
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
      }

      content.innerHTML = html + '<div class="loading-progress" style="margin-top:16px;"><div class="loading-progress-bar" style="width:100%;opacity:1"></div></div>';

      // Restore scroll position of the connections list so a background
      // refresh doesn't yank the user back to the top of the list.
      if (prevScrollTop) {
        const newScrollEl = content.querySelector('#activeConnectionsList');
        if (newScrollEl) newScrollEl.scrollTop = prevScrollTop;
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
  }
};