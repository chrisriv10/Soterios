window.Pages = window.Pages || {};
window.Pages['firewall'] = {
  render(container) {
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Firewall Management</h1>
        <p class="page-subtitle">Windows Firewall Profiles and Rule Summary</p>
      </header>
      <div id="firewallContent">
        <div class="empty-state">Loading firewall profiles\u2026</div>
        <div class="loading-progress" style="margin-top:8px;">
          <div class="loading-progress-bar"></div>
        </div>
      </div>
    `;
    this.load(container);
  },
  async load(container) {
    const content = container.querySelector('#firewallContent');
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
    setLoadingState(true);
    try {
      const [profiles, rules] = await Promise.all([
        window.api.invoke('firewall:status'),
        window.api.invoke('firewall:rules')
      ]);

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
            <div style="flex:1; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-weight:600; font-size:1.1rem;">${escapeHtml(res.Name || 'Profile')}</div>
                <div class="page-subtitle" style="font-size:0.85rem; margin-top:2px;">
                  Status: <span style="color:${enabled ? 'var(--ok)' : 'var(--danger)'}; font-weight:600;">${enabled ? 'ON' : 'OFF'}</span>
                </div>
              </div>
            </div>
          </div>
          ${rules ? `<div style="display:flex; gap:16px; font-size:0.85rem; color:var(--text-dim);">
            <span>Rules affecting this profile: ${rules.profiles[((res.Name || '').toLowerCase())] || 0}</span>
          </div>` : ''}
        </div>`;
      }
      html += '</div>';

      // ── NETWORK PERIMETER (live visualization) ────────────────────────────
      html += `
        <div class="card" id="perimeterCard" style="margin-top:24px; padding:24px 28px;">
          <style>
            #perimeterCard .perim-node { cursor:pointer; transition: opacity 0.5s ease; }
            #perimeterCard .perim-node.entering circle.perim-dot { animation: perimPop 0.4s ease; }
            #perimeterCard .perim-node.selected circle.perim-dot { stroke:#fff; stroke-width:2; }
            #perimeterCard .perim-blocked-ring { animation: perimPulse 1.6s ease-out infinite; }
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
          <div style="display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start;">
            <div style="flex:2; min-width:320px;">
              <svg id="perimeterSvg" viewBox="0 0 600 420" style="width:100%; height:auto; display:block;"></svg>
              <div style="display:flex; justify-content:center; gap:20px; margin-top:10px; flex-wrap:wrap; font-size:0.78rem; color:var(--text-dim);">
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ok);margin-right:5px;"></span>Allowed / Trusted</span>
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--warn);margin-right:5px;"></span>Unknown / Unusual</span>
                <span><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--danger);margin-right:5px;"></span>Blocked / High Risk</span>
              </div>
            </div>
            <div style="flex:1; min-width:270px; max-width:340px;" id="connectionDetailPanel">
              <div class="empty-state" style="font-size:0.85rem;">Click a connection to see details and actions.</div>
            </div>
          </div>
        </div>
      `;

      // ── FIREWALL RULES (searchable, synced to the live data above) ───────
      html += `
        <div class="card" style="margin-top:24px; padding:20px 24px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
            <h3 style="margin:0;">Firewall Rules</h3>
            <input type="text" id="ruleSearchInput" placeholder="Search by name, app, or address\u2026"
              style="min-width:240px; padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border); background:var(--bg-surface); color:var(--text-main);" />
          </div>
          <div id="ruleListContainer" style="max-height:380px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
            <div class="empty-state">Loading rules\u2026</div>
          </div>
        </div>
      `;

      content.innerHTML = html + '<div class="loading-progress" style="margin-top:16px;"><div class="loading-progress-bar" style="width:100%;opacity:1"></div></div>';

      requestAnimationFrame(() => {
        this._initPerimeter(container);
        this._initRuleList(container);
      });

    } catch (e) {
      content.innerHTML = `<div class="empty-state">Error loading firewall: ${escapeHtml(e.message)}</div>`;
    } finally {
      setLoadingState(false);
    }
  },

  // ══════════════════════════════════════════════════════════════════════
  // NETWORK PERIMETER — live visualization
  // ══════════════════════════════════════════════════════════════════════

  _perimeterTimer: null,
  _particleRaf: null,
  _perimeterNodes: new Map(),   // key -> { data, angle, radius, blocked, x, y }
  _selectedKey: null,
  _trustedIps: [],

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

  async _initPerimeter(container) {
    try { this._trustedIps = (await window.api.invoke('firewall:getTrusted')) || []; } catch (_) { this._trustedIps = []; }

    await this._pollPerimeter(container);
    this._startParticleLoop(container);

    if (this._perimeterTimer) clearInterval(this._perimeterTimer);
    this._perimeterTimer = setInterval(() => {
      if (!document.body.contains(container)) {
        clearInterval(this._perimeterTimer);
        this._perimeterTimer = null;
        if (this._particleRaf) cancelAnimationFrame(this._particleRaf);
        return;
      }
      this._pollPerimeter(container);
    }, 4000);
  },

  async _pollPerimeter(container) {
    const svg = container.querySelector('#perimeterSvg');
    if (!svg) return;
    let connections = [];
    try {
      const res = await window.api.invoke('network:connections');
      connections = Array.isArray(res) ? res : [];
    } catch (_) { /* keep last known nodes on a transient failure */ return; }
    this._renderPerimeter(container, connections);
  },

  _classifyRisk(c, key) {
    const remoteAddress = this._field(c, 'remoteAddress', 'RemoteAddress');
    if (this._trustedIps.includes(remoteAddress)) return 'SAFE';
    if (c.classification === 'MALICIOUS') return 'MALICIOUS';
    if (c.classification === 'SAFE') return 'SAFE';
    return 'UNKNOWN';
  },

  _riskColor(risk) {
    return risk === 'SAFE' ? 'var(--ok)' : risk === 'MALICIOUS' ? 'var(--danger)' : 'var(--warn)';
  },

  _renderPerimeter(container, connections) {
    const svg = container.querySelector('#perimeterSvg');
    const summary = container.querySelector('#perimeterSummary');
    if (!svg) return;

    const cx = 300, cy = 210;
    const boundaryR = 175;
    const allowedR = 138;

    // Only show a bounded number of connections so this stays a map, not a
    // spreadsheet. Prioritize what matters: malicious, then unknown, then a
    // sample of safe ones.
    const priority = { MALICIOUS: 0, UNKNOWN: 1, SAFE: 2 };
    const withMeta = connections.map((c) => {
      const key = this._connKey(c);
      const risk = this._classifyRisk(c, key);
      return { c, key, risk };
    });
    withMeta.sort((a, b) => priority[a.risk] - priority[b.risk]);
    const MAX_NODES = 26;
    const shown = withMeta.slice(0, MAX_NODES);
    const hiddenCount = Math.max(0, withMeta.length - shown.length);

    const inbound = [];
    const outbound = [];
    for (const item of shown) {
      const localPort = this._field(item.c, 'localPort', 'LocalPort');
      const remotePort = this._field(item.c, 'remotePort', 'RemotePort');
      const dir = this._getDirection(item.c, localPort, remotePort);
      item.direction = dir;
      (dir === 'inbound' ? inbound : outbound).push(item);
    }

    const place = (list, side) => {
      // side: -1 = left (inbound), 1 = right (outbound)
      const count = list.length;
      list.forEach((item, i) => {
        const spread = Math.min(Math.PI * 0.72, Math.PI * 0.16 + count * 0.05);
        const t = count <= 1 ? 0.5 : i / (count - 1);
        // Left side is centered on angle PI (pointing left), right side on 0 (pointing right)
        const finalAngle = side < 0
          ? Math.PI + (t - 0.5) * spread
          : (t - 0.5) * spread;
        const blocked = item.risk === 'MALICIOUS';
        const radius = blocked ? boundaryR : allowedR - (item.risk === 'UNKNOWN' ? 10 : 0);
        item.angle = finalAngle;
        item.radius = radius;
        item.blocked = blocked;
        item.x = cx + Math.cos(finalAngle) * radius;
        item.y = cy + Math.sin(finalAngle) * radius;
      });
    };
    place(inbound, -1);
    place(outbound, 1);

    const allItems = [...inbound, ...outbound];
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

    // Static chrome (boundary ring, allowed ring, center PC) + dynamic nodes
    let svgHtml = `
      <circle cx="${cx}" cy="${cy}" r="${boundaryR}" fill="none" stroke="var(--glass-border)" stroke-width="1.5" stroke-dasharray="4 5"/>
      <circle cx="${cx}" cy="${cy}" r="${allowedR}" fill="none" stroke="var(--glass-border)" stroke-width="1" opacity="0.4"/>
      <g>
        <circle cx="${cx}" cy="${cy}" r="30" fill="var(--bg-surface-hover)" stroke="var(--accent-primary)" stroke-width="1.5"/>
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-main)">This PC</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="var(--text-dim)">${allItems.length} active</text>
      </g>
    `;

    for (const item of allItems) {
      const color = this._riskColor(item.risk);
      const entering = enteringKeys.has(item.key) ? 'entering' : '';
      const selected = this._selectedKey === item.key ? 'selected' : '';
      const label = escapeHtml((this._field(item.c, 'processName') || this._field(item.c, 'remoteAddress', 'RemoteAddress') || '').slice(0, 14));

      svgHtml += `<g class="perim-node ${entering} ${selected}" data-key="${escapeHtml(item.key)}" transform-origin="${item.x}px ${item.y}px">`;
      if (item.blocked) {
        svgHtml += `<circle class="perim-blocked-ring" cx="${item.x}" cy="${item.y}" r="7" fill="none" stroke="${color}" stroke-width="2"/>`;
      } else {
        // Connecting line + a particle element updated each animation frame
        svgHtml += `<line x1="${cx}" y1="${cy}" x2="${item.x}" y2="${item.y}" stroke="${color}" stroke-width="1" opacity="0.25"/>`;
        svgHtml += `<circle class="perim-particle" data-key="${escapeHtml(item.key)}" cx="${item.x}" cy="${item.y}" r="2.2" fill="${color}" opacity="0.9"/>`;
      }
      svgHtml += `<circle class="perim-dot" cx="${item.x}" cy="${item.y}" r="6" fill="${color}"/>`;
      svgHtml += `<text x="${item.x}" y="${item.y - 12}" text-anchor="middle" font-size="8" fill="var(--text-dim)">${label}</text>`;
      svgHtml += `</g>`;
    }

    svg.innerHTML = svgHtml;
    svg.querySelectorAll('.perim-node').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-key');
        this._selectedKey = key;
        svg.querySelectorAll('.perim-node').forEach((n) => n.classList.remove('selected'));
        el.classList.add('selected');
        this._renderDetailPanel(container, this._perimeterNodes.get(key));
      });
    });

    if (summary) {
      const blockedCount = allItems.filter((i) => i.blocked).length;
      const unknownCount = allItems.filter((i) => i.risk === 'UNKNOWN').length;
      summary.textContent = `${allItems.length} shown${hiddenCount ? ` (+${hiddenCount} more)` : ''} \u00b7 ${blockedCount} blocked \u00b7 ${unknownCount} unusual`;
    }
  },

  _startParticleLoop(container) {
    if (this._particleRaf) cancelAnimationFrame(this._particleRaf);
    const cx = 300, cy = 210;
    const speed = 0.00045; // fraction of the line traveled per ms
    const loop = (t) => {
      const svg = container.querySelector('#perimeterSvg');
      if (!svg || !document.body.contains(container)) return; // page navigated away
      for (const [key, item] of this._perimeterNodes) {
        if (item.blocked) continue;
        const particle = svg.querySelector(`.perim-particle[data-key="${CSS.escape(key)}"]`);
        if (!particle) continue;
        const phase = (key.length * 37) % 1000; // stable per-connection offset so they don't all pulse in sync
        let frac = ((t * speed) + phase / 1000) % 1;
        // Inbound particles travel from the node toward the PC; outbound the reverse.
        const travel = item.direction === 'inbound' ? (1 - frac) : frac;
        particle.setAttribute('cx', cx + (item.x - cx) * travel);
        particle.setAttribute('cy', cy + (item.y - cy) * travel);
      }
      this._particleRaf = requestAnimationFrame(loop);
    };
    this._particleRaf = requestAnimationFrame(loop);
  },

  _renderDetailPanel(container, item) {
    const panel = container.querySelector('#connectionDetailPanel');
    if (!panel) return;
    if (!item) {
      panel.innerHTML = '<div class="empty-state" style="font-size:0.85rem;">Click a connection to see details and actions.</div>';
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
    const risk = item.risk;
    const color = this._riskColor(risk);
    const isTrusted = this._trustedIps.includes(remoteAddress);

    panel.innerHTML = `
      <div class="card compact" style="display:flex; flex-direction:column; gap:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-weight:600;">${escapeHtml(processName)}</span>
          <span style="font-size:0.7rem; font-weight:600; color:${color}; background:${color}15; padding:3px 8px; border-radius:4px;">${risk}${item.blocked ? ' \u00b7 BLOCKED' : ''}</span>
        </div>
        <div style="font-size:0.8rem; color:var(--text-dim); display:flex; flex-direction:column; gap:4px;">
          <div>Remote: <span style="color:var(--text-main); font-family:monospace;">${escapeHtml(remoteAddress)}:${escapeHtml(remotePort)}</span>${hostname ? ` (${escapeHtml(hostname)})` : ''}</div>
          ${service ? `<div>Service: ${escapeHtml(service)}</div>` : ''}
          <div>Local: <span style="font-family:monospace;">${escapeHtml(localAddress)}:${escapeHtml(localPort)}</span></div>
          <div>Direction: ${item.direction === 'inbound' ? 'Inbound \u2193' : 'Outbound \u2191'} <span style="opacity:0.7;">(best-effort estimate)</span></div>
          <div>State: ${escapeHtml(state)}</div>
          <div>PID: ${pid ? escapeHtml(pid) : 'unknown'}</div>
          <div style="opacity:0.7;">Per-connection bandwidth isn't exposed by Windows without extra instrumentation \u2014 see the Network Monitor page for interface-level throughput.</div>
        </div>
        <div id="detailWhoisResult" style="font-size:0.78rem; color:var(--text-dim);"></div>
        <div id="detailProcessResult" style="font-size:0.78rem; color:var(--text-dim);"></div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
          <button class="btn btn-sm" data-action="block-conn">Block This Connection</button>
          <button class="btn btn-sm" data-action="block-ip">Block Remote IP</button>
          <button class="btn btn-sm" data-action="block-app" ${pid ? '' : 'disabled'}>Block Application</button>
          <button class="btn btn-sm" data-action="trust">${isTrusted ? 'Untrust' : 'Mark as Trusted'}</button>
          <button class="btn btn-sm" data-action="whois">WHOIS Lookup</button>
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
    } catch (e) { alert(e.message || 'Failed to create rule.'); }
  },

  async _blockIp(container, ip) {
    if (!window.confirm(`Block all traffic to/from ${ip}?`)) return;
    try {
      await window.api.invoke('firewall:createRule', { name: `Block IP ${ip} (Out)`, direction: 'Outbound', action: 'Block', remoteAddress: ip });
      await window.api.invoke('firewall:createRule', { name: `Block IP ${ip} (In)`, direction: 'Inbound', action: 'Block', remoteAddress: ip });
      alert('IP blocked.');
      this._initRuleList(container);
    } catch (e) { alert(e.message || 'Failed to block IP.'); }
  },

  async _blockApp(container, pid, processName) {
    try {
      const processes = await window.api.invoke('process:list');
      const proc = (processes || []).find((p) => String(p.pid ?? p.Pid ?? p.PID) === String(pid));
      const programPath = proc && (proc.path || proc.execPath || proc.exe || proc.ExecutablePath);
      if (!programPath) { alert('Could not determine the executable path for this process.'); return; }
      if (!window.confirm(`Block all network access for ${processName}?\n${programPath}`)) return;
      await window.api.invoke('firewall:createRule', { name: `Block App ${processName} (Out)`, direction: 'Outbound', action: 'Block', program: programPath });
      await window.api.invoke('firewall:createRule', { name: `Block App ${processName} (In)`, direction: 'Inbound', action: 'Block', program: programPath });
      alert('Application blocked.');
      this._initRuleList(container);
    } catch (e) { alert(e.message || 'Failed to block application.'); }
  },

  async _toggleTrust(container, ip, currentlyTrusted) {
    try {
      this._trustedIps = currentlyTrusted
        ? await window.api.invoke('firewall:untrustConnection', ip)
        : await window.api.invoke('firewall:trustConnection', ip);
      if (this._selectedKey) this._renderDetailPanel(container, this._perimeterNodes.get(this._selectedKey));
    } catch (e) { alert(e.message || 'Failed to update trust list.'); }
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
      if (target) target.textContent = e.message || 'WHOIS lookup failed.';
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
      const path = proc.path || proc.execPath || proc.exe || proc.ExecutablePath || 'unknown path';
      const mem = proc.memoryMB || proc.memory || proc.WorkingSetMB;
      target.innerHTML = `Path: <span style="font-family:monospace;">${escapeHtml(path)}</span>${mem ? ` \u00b7 ${escapeHtml(String(mem))} MB` : ''}`;
    } catch (e) {
      if (target) target.textContent = e.message || 'Unable to load process info.';
    }
  },

  // ══════════════════════════════════════════════════════════════════════
  // FIREWALL RULES — searchable list synced to the same backend
  // ══════════════════════════════════════════════════════════════════════

  _ruleCache: [],

  async _initRuleList(container) {
    const listEl = container.querySelector('#ruleListContainer');
    const searchInput = container.querySelector('#ruleSearchInput');
    if (!listEl) return;
    try {
      this._ruleCache = (await window.api.invoke('firewall:listRules')) || [];
      this._renderRuleList(container, this._ruleCache);
    } catch (e) {
      listEl.innerHTML = `<div class="empty-state">Error loading rules: ${escapeHtml(e.message)}</div>`;
      return;
    }
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        const filtered = !q ? this._ruleCache : this._ruleCache.filter((r) =>
          (r.name || '').toLowerCase().includes(q) ||
          (r.program || '').toLowerCase().includes(q) ||
          (r.remoteAddress || '').toLowerCase().includes(q)
        );
        this._renderRuleList(container, filtered);
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
        } catch (e) { alert(e.message || 'Failed to update rule.'); }
      });
    });
    listEl.querySelectorAll('[data-rule-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.getAttribute('data-rule-delete');
        if (!window.confirm(`Delete rule "${name}"?`)) return;
        try {
          await window.api.invoke('firewall:deleteRule', name);
          this._initRuleList(container);
        } catch (e) { alert(e.message || 'Failed to delete rule.'); }
      });
    });
  }
};