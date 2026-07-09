window.Pages = window.Pages || {};
window.Pages['firewall'] = {
  REFRESH_INTERVAL_MS: 4000,
  _summaryTimer: null,
  _ruleQuery: '',
  _ruleActionFilter: 'all',
  _ruleDirectionFilter: 'all',

  render(container) {
    // Clear any previous auto-refresh timer (e.g. if this page is re-rendered).
    if (this._summaryTimer) {
      clearInterval(this._summaryTimer);
      this._summaryTimer = null;
    }
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Firewall Management</h1>
        <p class="page-subtitle">Windows Firewall Profiles and Rule Summary</p>
      </header>
      <div id="firewallContent">
        <div class="empty-state"><span class="spinner"></span>&nbsp;Loading firewall profiles\u2026</div>
      </div>
    `;
    this.load(container);
  },
  async load(container) {
    const content = container.querySelector('#firewallContent');
    try {
      // Track each IPC individually so the bar progresses as each resolves
      const profilesPromise = window.api.invoke('firewall:status');
      const rulesPromise = window.api.invoke('firewall:rules');

      const profiles = await profilesPromise;
      const rules = await rulesPromise;
      const settings = await Api.getSettings();
      const showPerimeterMap = settings.features.networkPerimeterMap !== false;

      let html = '';

      html += `<div id="firewallSummary">${this._renderSummaryHtml(profiles, rules)}</div>`;

      // ── NETWORK PERIMETER (live visualization) ────────────────────────────
      if (showPerimeterMap) html += `
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
            <span style="font-weight:600; font-size:0.95rem; letter-spacing:0.3px;">Network Perimeter</span>
            <span id="perimeterSummary" style="margin-left:auto; font-size:0.78rem; color:var(--text-muted);"></span>
          </div>

          <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:16px; padding:12px 14px; background:var(--bg-surface-hover); border-radius:8px;">
            <input type="text" id="connSearchInput" placeholder="Search by process, IP, or hostname\u2026"
              style="flex:1; min-width:200px; padding:7px 12px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:var(--text-main);" />
            <label style="font-size:0.8rem; color:var(--text-dim); display:flex; align-items:center; gap:6px; white-space:nowrap;">
              Show on map
              <select id="maxNodesSelect" class="btn btn-sm">
                <option value="20">20</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="all">All</option>
              </select>
            </label>
            <label style="font-size:0.8rem; color:var(--text-dim); display:flex; align-items:center; gap:6px; white-space:nowrap;">
              Direction
              <select id="directionFilterSelect" class="btn btn-sm">
                <option value="all" selected>All</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </label>
            <label style="font-size:0.8rem; color:var(--text-dim); display:flex; align-items:center; gap:6px; white-space:nowrap;">
              Process
              <select id="processFilterSelect" class="btn btn-sm">
                <option value="all" selected>All</option>
              </select>
            </label>
            <div style="display:flex; gap:12px; font-size:0.8rem;">
              <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" id="filterSafe" checked/> <span style="color:var(--ok);">Allowed</span></label>
              <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" id="filterUnknown" checked/> <span style="color:var(--warn);">Unverified</span></label>
              <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" id="filterMalicious" checked/> <span style="color:var(--danger);">Blocked</span></label>
            </div>
          </div>

          <div style="display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">
            <div style="flex:2; min-width:320px;">
              <svg id="perimeterSvg" viewBox="0 0 600 420" style="width:100%; height:auto; display:block;"></svg>
              <div style="display:flex; justify-content:center; gap:20px; margin-top:10px; flex-wrap:wrap; font-size:0.78rem; color:var(--text-dim);">
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ok);margin-right:5px;"></span>Allowed / Trusted</span>
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--warn);margin-right:5px;"></span>Unverified</span>
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--danger);margin-right:5px;"></span>Blocked / High Risk</span>
              </div>
            </div>
            <div style="flex:1; min-width:270px; max-width:340px;" id="connectionDetailPanel"></div>
          </div>

          <div style="margin-top:24px; padding-top:20px; border-top:1px solid var(--glass-border);">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px;">
              <h3 style="margin:0; font-size:0.95rem;">All Connections</h3>
              <span id="connTableCount" style="font-size:0.78rem; color:var(--text-muted);"></span>
            </div>
            <div id="connTableContainer" style="max-height:340px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
              <div class="empty-state">Loading connections\u2026</div>
            </div>
          </div>
        </div>
      `;
      else {
        html += `
        <div class="card" style="margin-top:24px; padding:20px 24px;">
          <div class="empty-state" style="margin:0;">
            Network perimeter map is disabled. Enable it in&nbsp;<a href="#" class="goto-settings" style="color:var(--accent-primary);">Settings</a>.
          </div>
        </div>`;
      }

      // ── FIREWALL RULES (searchable, synced to the live data above) ───────
      html += `
        <div class="card" style="margin-top:24px; padding:20px 24px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
            <h3 style="margin:0;">Firewall Rules</h3>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <select id="ruleActionFilter" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
                <option value="all" ${this._ruleActionFilter === 'all' ? 'selected' : ''}>All Actions</option>
                <option value="Allow" ${this._ruleActionFilter === 'Allow' ? 'selected' : ''}>Allow</option>
                <option value="Block" ${this._ruleActionFilter === 'Block' ? 'selected' : ''}>Block</option>
              </select>
              <select id="ruleDirectionFilter" style="padding:6px 10px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:inherit; font-size:0.85rem;">
                <option value="all" ${this._ruleDirectionFilter === 'all' ? 'selected' : ''}>All Directions</option>
                <option value="Inbound" ${this._ruleDirectionFilter === 'Inbound' ? 'selected' : ''}>Inbound</option>
                <option value="Outbound" ${this._ruleDirectionFilter === 'Outbound' ? 'selected' : ''}>Outbound</option>
              </select>
              <input type="text" id="ruleSearchInput" placeholder="Search by name, app, or address\u2026"
                value="${escapeHtml(this._ruleQuery || '')}"
                style="min-width:240px; padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:var(--text-main);" />
            </div>
          </div>
          <div id="ruleListContainer" style="max-height:380px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
            <div class="empty-state">Loading rules\u2026</div>
          </div>
        </div>
      `;
      content.innerHTML = html;

      const settingsLink = content.querySelector('.goto-settings');
      if (settingsLink) {
        settingsLink.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.AppRouter) window.AppRouter.navigate('settings');
        });
      }

      // Init perimeter (loads trusted IPs, then enriches connections — the slow part)
      if (showPerimeterMap) await this._initPerimeter(container);

      // Init rule list (loads firewall rules from PowerShell)
      await this._initRuleList(container);

      // Delegated so it keeps working even after _refreshSummary() swaps out
      // #firewallSummary's innerHTML on a timer — #firewallContent itself
      // (this `content` element) isn't replaced, only its child is.
      content.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-profile-toggle]');
        if (!btn) return;
        const name = btn.getAttribute('data-profile-toggle');
        const enabled = btn.getAttribute('data-enabled') === 'true';
        this._toggleProfile(container, name, enabled);
      });

      // Keep the "Total Rules / Allow-Block / Enabled-Disabled" tiles and
      // profile cards at the top in sync with reality. Everything else on
      // this page (perimeter map, connections table, rule list) already has
      // its own refresh logic; this one was previously fetched once and
      // never updated again.
      if (this._summaryTimer) clearInterval(this._summaryTimer);
      this._summaryTimer = setInterval(() => {
        if (!document.body.contains(container)) {
          clearInterval(this._summaryTimer);
          this._summaryTimer = null;
          return;
        }
        this._refreshSummary(container);
      }, this.REFRESH_INTERVAL_MS);

    } catch (e) {
      content.innerHTML = `<div class="empty-state">Error loading firewall: ${escapeHtml(e.message)}</div>`;
    }
  },

  // Builds the markup for the top summary tiles + profile cards. Shared by
  // the initial load() and by silent background refreshes so both paths
  // stay in sync.
  _renderSummaryHtml(profiles, rules) {
    const safeRules = rules || {
      total: 0,
      inbound: 0,
      outbound: 0,
      allow: 0,
      block: 0,
      enabled: 0,
      disabled: 0,
      profiles: {
        domain: 0,
        private: 0,
        public: 0
      }
    };

    let html = '';

    // Rules summary
    html += `<div class="grid grid-4" style="margin-bottom:18px;">
      <div class="stat-tile"><div class="stat-label">Total Rules</div><div class="stat-value">${safeRules.total}</div></div>
      <div class="stat-tile"><div class="stat-label">Inbound / Outbound</div><div class="stat-value">${safeRules.inbound} / ${safeRules.outbound}</div></div>
      <div class="stat-tile"><div class="stat-label">Allow / Block</div><div class="stat-value" style="color:var(--ok);">${safeRules.allow} / <span style="color:var(--danger);">${safeRules.block}</span></div></div>
      <div class="stat-tile"><div class="stat-label">Enabled / Disabled</div><div class="stat-value" style="color:var(--ok);">${safeRules.enabled} / <span style="color:var(--text-dim);">${safeRules.disabled}</span></div></div>
    </div>`;
    html += `<div class="grid grid-3" style="margin-bottom:18px;">
      <div class="stat-tile"><div class="stat-label">Domain Rules</div><div class="stat-value">${safeRules.profiles.domain}</div></div>
      <div class="stat-tile"><div class="stat-label">Private Rules</div><div class="stat-value">${safeRules.profiles.private}</div></div>
      <div class="stat-tile"><div class="stat-label">Public Rules</div><div class="stat-value">${safeRules.profiles.public}</div></div>
    </div>`;

    // Profile cards
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
                Status: <span style="color:${enabled ? 'var(--ok)' : 'var(--danger)'}; font-weight:600;">${enabled ? 'ON' : 'OFF'}</span>
              </div>
            </div>
            <button
              class="btn btn-sm"
              style="${enabled ? 'color:var(--danger);' : 'color:var(--ok);'} white-space:nowrap;"
              data-profile-toggle="${escapeHtml(name)}"
              data-enabled="${enabled}"
            >${enabled ? 'Turn Off' : 'Turn On'}</button>
          </div>
        </div>
        ${rules ? `<div style="display:flex; gap:16px; font-size:0.85rem; color:var(--text-dim);">
          <span>Rules affecting this profile: ${rules.profiles[((res.Name || '').toLowerCase())] || 0}</span>
        </div>` : ''}
      </div>`;
    }
    html += '</div>';
    return html;
  },

  // Turns a Windows Firewall profile (Domain/Private/Public) on or off.
  // NOTE: requires a main-process handler for 'firewall:setProfileEnabled'
  // (e.g. wrapping `netsh advfirewall set <profile>profile state on|off`,
  // or the equivalent COM/PowerShell call) — this only wires up the UI side.
  async _toggleProfile(container, profileName, currentlyEnabled) {
    const turningOff = currentlyEnabled;
    const verb = turningOff ? 'Turn OFF' : 'Turn ON';
    const warning = turningOff
      ? `${verb} the ${profileName} firewall profile?\n\nThis disables Windows Firewall protection for this network profile until it's turned back on.`
      : `${verb} the ${profileName} firewall profile?`;
    if (!window.confirm(warning)) return;

    const btn = container.querySelector(`[data-profile-toggle="${CSS.escape(profileName)}"]`);
    if (btn) { btn.disabled = true; btn.textContent = turningOff ? 'Turning off\u2026' : 'Turning on\u2026'; }

    try {
      await window.api.invoke('firewall:setProfileEnabled', { profile: profileName, enabled: !currentlyEnabled });
      await this._refreshSummary(container);
    } catch (e) {
      alert(this._friendlyError(e, `Failed to ${turningOff ? 'disable' : 'enable'} the ${profileName} firewall profile.`));
      if (btn) { btn.disabled = false; btn.textContent = turningOff ? 'Turn Off' : 'Turn On'; }
    }
  },

  // Silently re-fetches firewall status + rule counts and refreshes just the
  // top summary block, leaving the perimeter map / rule list / scroll
  // positions untouched.
  async _refreshSummary(container) {
    const summaryEl = container.querySelector('#firewallSummary');
    if (!summaryEl) return;
    try {
      const [profiles, rules] = await Promise.all([
        window.api.invoke('firewall:status'),
        window.api.invoke('firewall:rules')
      ]);
      summaryEl.innerHTML = this._renderSummaryHtml(profiles, rules);
    } catch (e) {
      // Don't blow away a working display just because one background
      // refresh tick failed (e.g. a transient PowerShell hiccup).
      console.error('Firewall summary refresh failed:', e);
    }
  },

  // ══════════════════════════════════════════════════════════════════════
  // NETWORK PERIMETER — live visualization
  // ══════════════════════════════════════════════════════════════════════

  _perimeterTimer: null,
  _particleRaf: null,
  _perimeterNodes: new Map(),   // key -> { data, angle, radius, blocked, x, y }
  _perimeterNodeEls: new Map(), // key -> { g, blocked, dotEl, lineEl, blockedRingEl, particleEl } -- the actual DOM, reused across refreshes
  _selectedKey: null,
  _trustedIps: [],
  _lastConnections: [],
  _searchQuery: '',
  _riskFilter: { SAFE: true, UNKNOWN: true, MALICIOUS: true },
  _directionFilter: 'all',
  _processFilter: 'all',
  _maxVisualNodes: 50,

  // Explanations for terms shown in the connection details,
  // surfaced as native hover tooltips and in the default glossary panel.
  GLOSSARY: {
    inbound: 'Someone or something out on the internet connected in to a service running on this PC.',
    outbound: 'This PC (or an app on it) reached out to a server elsewhere.',
    established: 'An active, currently open connection — data can flow both ways right now.',
    listen: 'This PC is waiting for incoming connections on this port, but nothing is connected yet.',
    time_wait: 'The connection just closed. Windows keeps it around briefly to make sure no leftover data arrives late.',
    close_wait: 'The other side closed the connection, and this PC is finishing cleanup on its end.',
    bound: 'A port reserved for use, but not actively listening or connected yet.',
    unverified: "Not on a known-safe or known-bad list. Most everyday connections start out this way — it doesn't necessarily mean anything is wrong.",
    pid: 'Process ID \u2014 a temporary number Windows assigns to a running program while it is active.',
    whois: 'Looks up who owns/operates a given IP address, e.g. the company running that server.'
  },

  _riskLabel(risk) {
    return risk === 'SAFE' ? 'Allowed' : risk === 'MALICIOUS' ? 'Blocked' : 'Unverified';
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

  // Used to gate the "Measure Bandwidth" button — that feature only
  // supports IPv4 TCP connections (see ipcHandlers.js's
  // measureConnectionBandwidth for why).
  _isIPv4(ip) {
    return typeof ip === 'string' && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  },

  // Windows doesn't expose true directionality for an already-established TCP
  // connection, so this is a best-effort heuristic: a low/well-known local
  // port paired with a high remote port usually means someone connected IN to
  // a service you're hosting; the common case (you connecting out to a server
  // on a well-known port) is the opposite.
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

  // Last line of defense in case a raw technical error ever slips through
  // from somewhere other than FirewallManager (which already translates its
  // own errors). Keeps the user-facing message short either way.
  _friendlyError(e, fallback) {
    let raw = (e && e.message) || String(e || '');
    // Electron's ipcRenderer.invoke wraps thrown main-process errors like:
    // "Error invoking remote method 'firewall:createRule': Error: <actual message>"
    // Strip that boilerplate so only the real message underneath is shown.
    raw = raw.replace(/^Error invoking remote method '[^']*':\s*/i, '');
    raw = raw.replace(/^Error:\s*/i, '');
    if (!raw || raw.length > 160 || /\bat line:|exception calling|\bstack\b/i.test(raw)) {
      return fallback || 'Something went wrong. Please try again.';
    }
    return raw;
  },

  async _initPerimeter(container) {
    try { this._trustedIps = (await window.api.invoke('firewall:getTrusted')) || []; } catch (_) { this._trustedIps = []; }

    this._renderDetailPanel(container, null); // shows the glossary by default
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
        if (this._particleObserver) { this._particleObserver.disconnect(); this._particleObserver = null; }
        return;
      }
      // network:connections is genuinely expensive on the backend (spawns
      // PowerShell, then runs full enrichment -- reverse DNS, blocklist
      // checks, process resolution -- per connection). Without this guard,
      // if any single poll ever took longer than the interval, the next
      // timer tick would fire anyway and start a second overlapping fetch
      // on top of the first, compounding rather than staying constant.
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
    } catch (_) { /* keep last known nodes on a transient failure */ return; }
    this._lastConnections = connections;
    this._updateProcessFilterOptions(container, connections);
    this._renderPerimeter(container, connections);
    this._renderConnectionsTable(container, connections);
  },

  _classifyRisk(c, key) {
    const remoteAddress = this._field(c, 'remoteAddress', 'RemoteAddress');
    // Blocklist-confirmed malicious always wins, even over a past "trust"
    // mark — trust means "I know this is unverified but I'm okay with it,"
    // not "override actual evidence of malicious activity."
    if (c.classification === 'MALICIOUS') return 'MALICIOUS';
    if (this._trustedIps.includes(remoteAddress)) return 'SAFE';
    if (c.classification === 'SAFE') return 'SAFE';
    return 'UNKNOWN';
  },

  _riskColor(risk) {
    return risk === 'SAFE' ? 'var(--ok)' : risk === 'MALICIOUS' ? 'var(--danger)' : 'var(--warn)';
  },

  // Shared by both the map and the full table so search/filter behave
  // identically in both places.
  _matchesFilters(c, risk) {
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
    // Keep the user's selection if that process is still around; otherwise
    // fall back to "All" rather than silently filtering to nothing.
    if (previousValue && (previousValue === 'all' || names.includes(previousValue))) {
      select.value = previousValue;
    } else {
      select.value = 'all';
      this._processFilter = 'all';
    }
  },

  _renderPerimeter(container, connections) {
    const svg = container.querySelector('#perimeterSvg');
    const summary = container.querySelector('#perimeterSummary');
    if (!svg) return;

    const cx = 300, cy = 210;
    const boundaryR = 175;

    // Priority order also doubles as visual section order (see below):
    // blocked and unverified connections are guaranteed a spot before the
    // node budget gets spent on ordinary allowed traffic.
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

    // Group into risk sections. A section is only carved out of the circle
    // if it actually has members — an all-Allowed map is just one plain
    // circle with no dividers, per how this is meant to read at a glance.
    const sectionOrder = ['MALICIOUS', 'UNKNOWN', 'SAFE'];
    const sectionLabels = { MALICIOUS: 'Blocked', UNKNOWN: 'Unverified', SAFE: 'Allowed' };
    const groups = sectionOrder
      .map((risk) => ({ risk, items: shown.filter((i) => i.risk === risk) }))
      .filter((g) => g.items.length > 0);

    const GAP = groups.length > 1 ? (Math.PI * 2 * 0.02) : 0; // small gap between sections
    const totalGapAngle = GAP * groups.length;
    const availableAngle = Math.PI * 2 - totalGapAngle;
    // Every section gets at least a sliver of arc so a single blocked
    // connection is never squeezed down to nothing next to 190 allowed ones.
    const MIN_SECTION_FRACTION = groups.length > 1 ? 0.08 : 0;
    const totalCount = shown.length || 1;
    let cursor = -Math.PI / 2; // start at the top, go clockwise
    const sectionMeta = [];
    for (const g of groups) {
      const rawFraction = g.items.length / totalCount;
      const fraction = Math.max(rawFraction, MIN_SECTION_FRACTION);
      sectionMeta.push({ ...g, startAngle: cursor, sweep: availableAngle * fraction });
      cursor += availableAngle * fraction + GAP;
    }
    // Fractions above can sum to slightly more than 1 when the min-size
    // floor kicks in for multiple tiny sections — normalize so nothing
    // overruns past a full circle.
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
      // Spread nodes across a few radius bands so a large section (e.g. 190
      // allowed connections) fans out instead of overlapping on one ring.
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

    // If the selected node disappeared (connection closed), close the panel.
    if (this._selectedKey && !newKeys.has(this._selectedKey)) {
      this._selectedKey = null;
      this._renderDetailPanel(container, null);
    }

    const nodeMap = new Map(allItems.map((i) => [i.key, i]));
    this._perimeterNodes = nodeMap;

    // Two persistent layers, created once and never destroyed on refresh:
    // static chrome (boundary ring, hub, section dividers) and the
    // per-connection nodes. Splitting them out is what makes the diffing
    // below possible -- see _createPerimeterNodeEl/_updatePerimeterNodeEl.
    let chromeG = svg.querySelector('#perimStaticChrome');
    let nodesG = svg.querySelector('#perimNodesLayer');
    if (!chromeG || !nodesG) {
      svg.innerHTML = '<g id="perimStaticChrome"></g><g id="perimNodesLayer"></g>';
      chromeG = svg.querySelector('#perimStaticChrome');
      nodesG = svg.querySelector('#perimNodesLayer');
      this._perimeterNodeEls = new Map();
    }

    // Static chrome (boundary ring, center PC, section dividers/labels) --
    // cheap (a handful of elements), not clickable, so rebuilding it
    // wholesale every refresh is fine. The part that actually needs to stay
    // stable under the user's cursor is the nodes layer below.
    let chromeHtml = `
      <circle cx="${cx}" cy="${cy}" r="${boundaryR}" fill="none" stroke="var(--glass-border)" stroke-width="1.5" stroke-dasharray="4 5"/>
      <g>
        <circle cx="${cx}" cy="${cy}" r="30" fill="var(--bg-surface-hover)" stroke="var(--accent-primary)" stroke-width="1.5"/>
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-main)">This PC</text>
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

    // Per-connection nodes: diffed against the previous render instead of
    // being torn down and recreated every refresh. A full rebuild here
    // used to destroy every node's DOM element -- and its click listener --
    // every ~6 seconds. A click landing anywhere near that boundary could
    // have its target vanish mid-click and silently fail to register, which
    // is what "laggy, hard to click" actually was: not a rendering-speed
    // problem, a DOM-churn-eats-your-click problem. Reusing elements in
    // place (just moving/recoloring them) fixes that directly.
    for (const item of allItems) {
      const existing = this._perimeterNodeEls.get(item.key);

      if (existing && existing.blocked === item.blocked) {
        // Same node, same blocked/unblocked shape -- move & recolor in place.
        this._updatePerimeterNodeEl(existing, item, cx, cy);
        item.particleEl = existing.particleEl;
        continue;
      }

      // New node, or one that flipped between blocked/unblocked (a
      // structurally different shape) -- (re)create its element.
      if (existing) existing.g.remove();
      const entering = enteringKeys.has(item.key) && !existing;
      const el = this._createPerimeterNodeEl(item, cx, cy, entering, container, svg);
      nodesG.appendChild(el.g);
      this._perimeterNodeEls.set(item.key, el);
      item.particleEl = el.particleEl;
    }

    // Remove elements for connections that disappeared since last refresh.
    for (const [key, el] of this._perimeterNodeEls) {
      if (!nodeMap.has(key)) {
        el.g.remove();
        this._perimeterNodeEls.delete(key);
      }
    }

    if (summary) {
      const blockedCount = allItems.filter((i) => i.blocked).length;
      const unknownCount = allItems.filter((i) => i.risk === 'UNKNOWN').length;
      // Three distinct numbers, since they can each differ: how many
      // connections exist at all, how many match the current filters, and
      // how many are actually drawn on the map (which the "Show on map" cap
      // can further shrink). Previously only the last of these was shown,
      // which made it look like filtering wasn't doing anything whenever it
      // didn't happen to interact with the cap.
      const totalConnections = connections.length;
      const filteredCount = withMeta.length;
      let countText = `${totalConnections} total connection${totalConnections === 1 ? '' : 's'} \u00b7 ${filteredCount} match current filters`;
      if (hiddenCount > 0) {
        countText += ` \u00b7 ${allItems.length} shown on map (+${hiddenCount} hidden by cap \u2014 raise "Show on map" to see more)`;
      }
      summary.textContent = `${countText} \u00b7 ${blockedCount} blocked \u00b7 ${unknownCount} unverified`;
    }
  },

  // Builds a brand-new node element for a connection we haven't got a DOM
  // element for yet (either genuinely new, or one that just flipped
  // blocked/unblocked state and needs a different internal shape).
  _createPerimeterNodeEl(item, cx, cy, entering, container, svg) {
    const color = this._riskColor(item.risk);
    const label = escapeHtml(this._field(item.c, 'processName') || this._field(item.c, 'remoteAddress', 'RemoteAddress') || 'Unknown');
    const selected = this._selectedKey === item.key ? 'selected' : '';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `perim-node ${entering ? 'entering' : ''} ${selected}`.trim());
    g.setAttribute('data-key', item.key);
    g.setAttribute('transform-origin', `${item.x}px ${item.y}px`);

    let inner = `<title>${label}</title>`;
    if (item.blocked) {
      inner += `<circle class="perim-blocked-ring" cx="${item.x}" cy="${item.y}" r="7" fill="none" stroke="${color}" stroke-width="2"/>`;
    } else {
      // Connecting line + a particle element updated each animation frame.
      // Starts at the edge of the "This PC" circle (radius 30, see above)
      // rather than its exact center, so the line doesn't visually run
      // underneath/through the hub itself.
      const hubR = 32; // circle radius (30) plus a couple px of breathing room
      const lineStartX = cx + Math.cos(item.angle) * hubR;
      const lineStartY = cy + Math.sin(item.angle) * hubR;
      inner += `<line class="perim-line" x1="${lineStartX}" y1="${lineStartY}" x2="${item.x}" y2="${item.y}" stroke="${color}" stroke-width="1" opacity="0.25"/>`;
      inner += `<circle class="perim-particle" data-key="${escapeHtml(item.key)}" cx="${item.x}" cy="${item.y}" r="2.2" fill="${color}" opacity="0.9"/>`;
    }
    // A larger invisible hit-area makes small dots easy to click without
    // needing pixel-perfect precision.
    inner += `<circle class="perim-hit" r="11" cx="${item.x}" cy="${item.y}" fill="transparent"/>`;
    inner += `<circle class="perim-dot" cx="${item.x}" cy="${item.y}" r="6" fill="${color}"/>`;
    g.innerHTML = inner;

    g.addEventListener('click', () => {
      this._selectedKey = item.key;
      svg.querySelectorAll('.perim-node').forEach((n) => n.classList.remove('selected'));
      g.classList.add('selected');
      this._renderDetailPanel(container, this._perimeterNodes.get(item.key));
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

  // Updates an existing node element in place for a refresh where its
  // blocked/unblocked shape hasn't changed -- just position, color, and
  // the selected/label state, via direct attribute writes (no innerHTML,
  // no new element, no lost click listener).
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
    const label = this._field(item.c, 'processName') || this._field(item.c, 'remoteAddress', 'RemoteAddress') || 'Unknown';
    if (titleEl && titleEl.textContent !== label) titleEl.textContent = label;
  },

  // Drives the slow "particle" dots that drift along each connection line.
  // Two things kept this from previously fighting with page scrolling:
  //  1. It ran on every single animation frame (~60/sec) doing DOM attribute
  //     writes for every visible node — way more often than a slow drift
  //     actually needs, and all of it main-thread work.
  //  2. It kept running even while the map was scrolled off-screen.
  // Fix: throttle updates to ~20fps, and pause entirely via IntersectionObserver
  // whenever #perimeterSvg isn't actually visible.
  _startParticleLoop(container) {
    if (this._particleRaf) cancelAnimationFrame(this._particleRaf);
    if (this._particleObserver) { this._particleObserver.disconnect(); this._particleObserver = null; }

    const svg = container.querySelector('#perimeterSvg');
    const cx = 300, cy = 210;
    const hubR = 32; // must match the line start point computed in _renderPerimeter
    const speed = 0.00045; // fraction of the line traveled per ms
    const FRAME_INTERVAL_MS = 50; // ~20fps — plenty smooth for a slow drift, far less main-thread work than 60fps
    let lastFrameTime = 0;
    this._particleVisible = true; // assumed visible until the observer below says otherwise

    const loop = (t) => {
      if (!document.body.contains(container)) {
        if (this._particleObserver) { this._particleObserver.disconnect(); this._particleObserver = null; }
        return; // page navigated away
      }
      if (this._particleVisible && !document.hidden && (t - lastFrameTime) >= FRAME_INTERVAL_MS) {
        lastFrameTime = t;
        for (const [key, item] of this._perimeterNodes) {
          if (item.blocked || !item.particleEl) continue;
          const phase = (key.length * 37) % 1000; // stable per-connection offset so they don't all pulse in sync
          let frac = ((t * speed) + phase / 1000) % 1;
          // Inbound particles travel from the node toward the PC; outbound the reverse.
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
    const panel = container.querySelector('#connectionDetailPanel');
    if (!panel) return;
    if (!item) {
      const g = this.GLOSSARY;
      panel.innerHTML = `
        <div class="card compact" style="display:flex; flex-direction:column; gap:8px;">
          <div style="font-weight:600; font-size:0.85rem;">What am I looking at?</div>
          <div style="font-size:0.78rem; color:var(--text-dim); display:flex; flex-direction:column; gap:6px;">
            <div>Click any dot on the map, or a row below, to see its details and actions here.</div>
            <div style="margin-top:6px;"><span class="glossary-term" title="${escapeHtml(g.unverified)}">Unverified</span> \u2014 not on a known-safe list yet. Most ordinary traffic starts out this way.</div>
            <div><span class="glossary-term" title="${escapeHtml(g.inbound)}">Inbound</span> / <span class="glossary-term" title="${escapeHtml(g.outbound)}">Outbound</span> \u2014 direction of the connection.</div>
            <div><span class="glossary-term" title="${escapeHtml(g.established)}">Established</span>, <span class="glossary-term" title="${escapeHtml(g.listen)}">Listen</span>, <span class="glossary-term" title="${escapeHtml(g.time_wait)}">Time Wait</span> \u2014 hover any term shown in a connection's details for a description.</div>
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
    const processName = this._field(c, 'processName') || '(unknown process)';
    const hostname = this._field(c, 'hostname');
    const service = this._field(c, 'serviceName');
    const state = this._getConnState(c);
    const stateExplain = this.GLOSSARY[state.toLowerCase()] || '';
    const risk = item.risk;
    const riskLabel = this._riskLabel(risk);
    const color = this._riskColor(risk);
    const isTrusted = this._trustedIps.includes(remoteAddress);
    const g = this.GLOSSARY;
    // Bandwidth tracking needs an actively-open TCP connection: Windows
    // returns ERROR_NOT_SUPPORTED for anything already winding down
    // (TIME_WAIT, CLOSE_WAIT, etc.) since there's no live data flow left to
    // sample, and the underlying API only handles IPv4 (see ipcHandlers.js).
    const bandwidthEligible = this._isIPv4(localAddress) && this._isIPv4(remoteAddress) && state === 'ESTABLISHED';

    panel.innerHTML = `
      <div class="card compact" style="display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-weight:600;">${escapeHtml(processName)}</span>
          <span class="glossary-term" title="${escapeHtml(risk === 'UNKNOWN' ? g.unverified : '')}" style="font-size:0.7rem; font-weight:600; color:${color}; background:${color}15; padding:3px 8px; border-radius:4px;">${riskLabel.toUpperCase()}${item.blocked ? ' \u00b7 BLOCKED' : ''}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-dim); display:flex; flex-direction:column; gap:4px;">
          <div>Remote: <span style="color:var(--text-main); font-family:monospace; word-break:break-all;">${escapeHtml(remoteAddress)}:${escapeHtml(remotePort)}</span>${hostname ? ` (${escapeHtml(hostname)})` : ''}</div>
          ${service ? `<div>Service: ${escapeHtml(service)}</div>` : ''}
          <div>Local: <span style="font-family:monospace; word-break:break-all;">${escapeHtml(localAddress)}:${escapeHtml(localPort)}</span></div>
          <div>Direction: <span class="glossary-term" title="${escapeHtml(item.direction === 'inbound' ? g.inbound : g.outbound)}">${item.direction === 'inbound' ? 'Inbound \u2193' : 'Outbound \u2191'}</span> <span style="opacity:0.7;">(best-effort estimate)</span></div>
          <div>State: <span class="glossary-term" title="${escapeHtml(stateExplain)}">${escapeHtml(state)}</span></div>
          <div>PID: <span class="glossary-term" title="${escapeHtml(g.pid)}">${pid ? escapeHtml(pid) : 'unknown'}</span></div>
          ${bandwidthEligible
            ? `<div id="detailBandwidthResult" style="opacity:0.85;">Bandwidth not measured yet.</div>`
            : !this._isIPv4(localAddress) || !this._isIPv4(remoteAddress)
              ? `<div style="opacity:0.7;">Per-connection bandwidth measurement only supports IPv4 TCP connections right now \u2014 this one's IPv6 or another protocol. See the Network Monitor page for interface-level throughput instead.</div>`
              : `<div style="opacity:0.7;">Bandwidth can only be measured on an actively-open connection \u2014 this one is ${escapeHtml(state)}, not ESTABLISHED, so there's no live data flow left to sample.</div>`
          }
        </div>
        <div id="detailWhoisResult" style="font-size:0.78rem; color:var(--text-dim);"></div>
        <div id="detailProcessResult" style="font-size:0.78rem; color:var(--text-dim);"></div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
          ${bandwidthEligible
            ? `<button class="btn btn-sm" data-action="bandwidth" title="Takes ~2 seconds — Windows samples this connection's live throughput.">Measure Bandwidth</button>`
            : ''
          }
          <button class="btn btn-sm" data-action="block-conn">Block This Connection</button>
          <button class="btn btn-sm" data-action="block-ip">Block Remote IP</button>
          <button class="btn btn-sm" data-action="block-app" ${pid ? '' : 'disabled'}>Block Application</button>
          <button class="btn btn-sm" data-action="trust">${isTrusted ? 'Untrust' : 'Mark as Trusted'}</button>
          <button class="btn btn-sm" data-action="whois" title="${escapeHtml(g.whois)}">WHOIS Lookup</button>
          <button class="btn btn-sm" data-action="process" ${pid ? '' : 'disabled'}>View Process Details</button>
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

  // Full, searchable/filterable list of every active connection — the map
  // above only ever shows a curated handful so it doesn't turn into a wall
  // of overlapping dots; this is where "show me everything" lives instead.
  _renderConnectionsTable(container, connections) {
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
      tableEl.innerHTML = '<div class="empty-state">No connections match the current search/filters.</div>';
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
        <span class="log-path" style="flex:1;">${escapeHtml(processName)} \u2014 ${escapeHtml(remoteAddress)}:${escapeHtml(remotePort)}</span>
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
          // Not currently shown on the map (e.g. filtered out by "Show on
          // map" count) — build a lightweight equivalent so details/actions
          // still work from the table.
          const found = withMeta.find((m) => m.key === key);
          if (found) this._renderDetailPanel(container, { ...found, direction: this._getDirection(found.c, this._field(found.c, 'localPort', 'LocalPort'), this._field(found.c, 'remotePort', 'RemotePort')), blocked: found.risk === 'MALICIOUS' });
        }
      });
    });
  },

  async _blockConnection(container, c) {
    const remoteAddress = this._field(c, 'remoteAddress', 'RemoteAddress');
    const remotePort = this._field(c, 'remotePort', 'RemotePort');
    if (!window.confirm(`Block traffic to ${remoteAddress}:${remotePort}?`)) return;
    try {
      await window.api.invoke('firewall:createRule', {
        name: `Block ${remoteAddress}:${remotePort} (Out)`, direction: 'Outbound', action: 'Block',
        protocol: 'TCP', remoteAddress, remotePort
      });
      await window.api.invoke('firewall:createRule', {
        name: `Block ${remoteAddress}:${remotePort} (In)`, direction: 'Inbound', action: 'Block',
        protocol: 'TCP', remoteAddress, remotePort
      });
      alert('Rule created. It will apply to new connections.');
      this._initRuleList(container);
      this._refreshSummary(container);
    } catch (e) { alert(this._friendlyError(e, 'Failed to create rule.')); }
  },

  async _blockIp(container, ip) {
    if (!window.confirm(`Block all traffic to/from ${ip}?`)) return;
    try {
      await window.api.invoke('firewall:createRule', { name: `Block IP ${ip} (Out)`, direction: 'Outbound', action: 'Block', remoteAddress: ip });
      await window.api.invoke('firewall:createRule', { name: `Block IP ${ip} (In)`, direction: 'Inbound', action: 'Block', remoteAddress: ip });
      alert('IP blocked.');
      this._initRuleList(container);
      this._refreshSummary(container);
    } catch (e) { alert(this._friendlyError(e, 'Failed to block IP.')); }
  },

  // process:list's field names aren't confirmed on this end — try every
  // common variant. If none match, callers should say so honestly rather
  // than showing a fake-looking "unknown path" value.
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
    try {
      const processes = await window.api.invoke('process:list');
      const proc = (processes || []).find((p) => String(p.pid ?? p.Pid ?? p.PID) === String(pid));
      const programPath = this._findProcessPath(proc);
      if (!programPath) { alert("Couldn't determine the executable path for this process, so it can't be blocked by path."); return; }
      if (!window.confirm(`Block all network access for ${processName}?\n${programPath}`)) return;
      await window.api.invoke('firewall:createRule', { name: `Block App ${processName} (Out)`, direction: 'Outbound', action: 'Block', program: programPath });
      await window.api.invoke('firewall:createRule', { name: `Block App ${processName} (In)`, direction: 'Inbound', action: 'Block', program: programPath });
      alert('Application blocked.');
      this._initRuleList(container);
      this._refreshSummary(container);
    } catch (e) { alert(this._friendlyError(e, 'Failed to block application.')); }
  },

  async _toggleTrust(container, ip, currentlyTrusted) {
    try {
      this._trustedIps = currentlyTrusted
        ? await window.api.invoke('firewall:untrustConnection', ip)
        : await window.api.invoke('firewall:trustConnection', ip);
      if (this._selectedKey) this._renderDetailPanel(container, this._perimeterNodes.get(this._selectedKey));
    } catch (e) { alert(this._friendlyError(e, 'Failed to update trust list.')); }
  },

  // Kicks off a real, on-demand bandwidth measurement for this one
  // connection via the main process (see ipcHandlers.js's
  // measureConnectionBandwidth). Takes ~2 seconds since Windows needs a
  // moment to produce a reading — the button reflects that while it runs.
  async _measureBandwidth(container, btn, spec) {
    const target = container.querySelector('#detailBandwidthResult');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Measuring\u2026 (~2s)';
    if (target) target.textContent = 'Measuring\u2026';
    try {
      const result = await window.api.invoke('network:measureBandwidth', spec);
      if (target) {
        target.innerHTML = `\u2191 ${result.outboundKBps.toFixed(1)} KB/s out \u00b7 \u2193 ${result.inboundKBps.toFixed(1)} KB/s in <span style="opacity:0.6;">(live sample)</span>`;
      }
    } catch (e) {
      if (target) target.textContent = this._friendlyError(e, 'Bandwidth measurement failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  },

  async _runWhois(container, ip) {
    const target = container.querySelector('#detailWhoisResult');
    if (target) target.textContent = 'Looking up\u2026';
    try {
      const info = await window.api.invoke('network:whois', ip);
      if (!target) return;
      if (!info || !info.found) { target.textContent = 'No WHOIS data found.'; return; }
      target.innerHTML = `WHOIS: ${escapeHtml(info.org || info.isp || 'Unknown org')} \u00b7 ${escapeHtml(info.city || '')}${info.city && info.country ? ', ' : ''}${escapeHtml(info.country || '')}`;
    } catch (e) {
      if (target) target.textContent = this._friendlyError(e, 'WHOIS lookup failed.');
    }
  },

  async _showProcessDetails(container, pid) {
    const target = container.querySelector('#detailProcessResult');
    if (target) target.textContent = 'Loading process info\u2026';
    try {
      const processes = await window.api.invoke('process:list');
      const proc = (processes || []).find((p) => String(p.pid ?? p.Pid ?? p.PID) === String(pid));
      if (!target) return;
      if (!proc) { target.textContent = 'Process not found (it may have exited).'; return; }
      const path = this._findProcessPath(proc);
      const mem = proc.memory;
      const pathHtml = path
        ? `Path: <span style="font-family:monospace;">${escapeHtml(path)}</span>`
        : 'Path not available from Process Inspector for this process.';
      target.innerHTML = `${pathHtml}${mem !== undefined ? ` \u00b7 ${escapeHtml(mem.toFixed ? mem.toFixed(1) : String(mem))}% memory` : ''}`;
    } catch (e) {
      if (target) target.textContent = this._friendlyError(e, 'Unable to load process info.');
    }
  },

  // ══════════════════════════════════════════════════════════════════════
  // FIREWALL RULES — searchable list synced to the same backend
  // ══════════════════════════════════════════════════════════════════════

  _ruleCache: [],

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
    const listEl = container.querySelector('#ruleListContainer');
    if (!listEl) return;
    if (!rules.length) {
      listEl.innerHTML = '<div class="empty-state">No matching rules.</div>';
      return;
    }
    listEl.innerHTML = rules.slice(0, 300).map((r) => {
      const actionColor = r.action === 'Allow' ? 'var(--ok)' : 'var(--danger)';
      const dirLabel = r.direction === 'Inbound' ? 'IN' : 'OUT';
      return `<div class="log-row" style="display:flex; align-items:center; gap:10px; content-visibility:auto; contain-intrinsic-size: 0 30px; ${r.enabled ? '' : 'opacity:0.5;'}">
        <span class="log-tag" style="background:${actionColor}22; color:${actionColor};">${escapeHtml(r.action || '')}</span>
        <span class="log-tag info">${dirLabel}</span>
        <span class="log-path" style="flex:1;">${escapeHtml(r.name || '')}${r.program ? ` \u2014 ${escapeHtml(r.program)}` : ''}${r.remoteAddress ? ` \u2014 ${escapeHtml(r.remoteAddress)}` : ''}</span>
        ${r.managedByApp ? `
          <button class="btn btn-sm" data-rule-toggle="${escapeHtml(r.name)}" data-enabled="${r.enabled}">${r.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-sm" style="color:var(--accent-danger);" data-rule-delete="${escapeHtml(r.name)}">Delete</button>
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
        } catch (e) { alert(this._friendlyError(e, 'Failed to update rule.')); }
      });
    });
    listEl.querySelectorAll('[data-rule-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.getAttribute('data-rule-delete');
        if (!window.confirm(`Delete rule "${name}"?`)) return;
        try {
          await window.api.invoke('firewall:deleteRule', name);
          this._initRuleList(container);
          this._refreshSummary(container);
        } catch (e) { alert(this._friendlyError(e, 'Failed to delete rule.')); }
      });
    });
  }
};