window.Pages = window.Pages || {};
window.Pages['network'] = {
  REFRESH_INTERVAL_MS: 3000,
  CHART_REFRESH_INTERVAL_MS: 30000,
  _connectionQuery: '',
  _historyRangeHours: 24,
  _historyCache: new Map(),
  _historyRequestToken: 0,
  _historyInspectIndex: null,
  _connectionRiskFilter: 'all',
  _connectionStateFilter: 'all',
  _geoCache: {},
  _groupByProcess: true,
  _simpleView: true,
  _expandedGroups: new Set(),
  _minimized: new Set(),
  _vpnSelection: '',
  _vpnPending: null,
  _vpnError: '',
  _heatmapZoom: 1,
  _heatmapPan: { x: 0, y: 0 },
  _heatmapShowArcs: true,
  _heatmapPulseRaf: null,
  _heatmapDrag: null,
  _heatmapSuppressClick: false,
  _heatmapWindowMouseMove: null,
  _heatmapWindowMouseUp: null,
  _heatmapKeydownHandler: null,
  _heatmapWidgetEl: null,
  _heatmapData: null,
  _heatmapClusters: [],
  _heatmapTier: null,
  _heatmapArcSignature: '',
  _selectedClusterId: null,
  _selectedClusterIps: null,
  _selectedClusterLoc: null,
  _userLocation: null, // User's actual geolocation for heatmap origin

  _startHeatmapPulses(content) {
    if (this._heatmapPulseRaf) {
      cancelAnimationFrame(this._heatmapPulseRaf);
      this._heatmapPulseRaf = null;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    const dots = content.querySelectorAll('.heatmap-pulse-dot');
    if (!dots.length) return;
    const items = Array.from(dots).map((el) => ({
      el,
      hx: parseFloat(el.dataset.hx), hy: parseFloat(el.dataset.hy),
      cx0: parseFloat(el.dataset.cx0), cy0: parseFloat(el.dataset.cy0),
      tx: parseFloat(el.dataset.tx), ty: parseFloat(el.dataset.ty),
      dur: parseFloat(el.dataset.dur) || 2,
      delay: parseFloat(el.dataset.delay) || 0
    }));
    const start = performance.now();
    const tick = (now) => {
      const elapsed = (now - start) / 1000;
      for (const it of items) {
        if (!it.el.isConnected) continue;
        const t = (((elapsed + it.delay) % it.dur) / it.dur);
        const mt = 1 - t;
        const x = mt * mt * it.hx + 2 * mt * t * it.cx0 + t * t * it.tx;
        const y = mt * mt * it.hy + 2 * mt * t * it.cy0 + t * t * it.ty;
        it.el.setAttribute('cx', x.toFixed(3));
        it.el.setAttribute('cy', y.toFixed(3));
        const fade = Math.min(1, t * 6, (1 - t) * 6);
        it.el.style.opacity = Math.max(0.15, fade).toFixed(2);
      }
      this._heatmapPulseRaf = requestAnimationFrame(tick);
    };
    this._heatmapPulseRaf = requestAnimationFrame(tick);
  },

  _clampHeatmapPan(zoom, pan, viewportW, viewportH) {
    const minX = viewportW - viewportW * zoom;
    const minY = viewportH - viewportH * zoom;
    return {
      x: Math.min(0, Math.max(minX, pan.x)),
      y: Math.min(0, Math.max(minY, pan.y))
    };
  },

  _applyHeatmapTransform(content) {
    const world = content.querySelector('#heatmapWorld');
    if (world) {
      world.style.transform = `translate(${this._heatmapPan.x}px, ${this._heatmapPan.y}px) scale(${this._heatmapZoom})`;
    }
    const viewport = content.querySelector('#heatmapViewport');
    if (viewport) {
      viewport.style.cursor = this._heatmapZoom > 1.001 ? 'grab' : 'default';
    }
    const label = content.querySelector('#heatmapZoomLabel');
    if (label) label.textContent = `${Math.round(this._heatmapZoom * 100)}%`;
    const resetBtn = content.querySelector('#heatmapZoomReset');
    if (resetBtn) resetBtn.style.display = this._heatmapZoom > 1.001 ? 'flex' : 'none';
  },

  _heatmapTierForZoom(zoom) {
    const value = Math.max(1, Math.min(6, Number(zoom) || 1));
    if (value >= 3.5) return { id: 'street', lonStep: 3, latStep: 2.5, labelLimit: 30, nextZoom: 6 };
    if (value >= 1.75) return { id: 'region', lonStep: 8, latStep: 6, labelLimit: 12, nextZoom: 3.5 };
    return { id: 'world', lonStep: 18, latStep: 12, labelLimit: 0, nextZoom: 1.75 };
  },

  _projectHeatmapCoordinate(lat, lon) {
    return {
      x: Math.max(0, Math.min(100, ((lon + 180) / 360) * 100)),
      y: Math.max(0, Math.min(100, ((90 - lat) / 180) * 100))
    };
  },

  _validHeatmapHome(location = this._userLocation) {
    if (!location || typeof location.lat !== 'number' || typeof location.lon !== 'number' ||
        !Number.isFinite(location.lat) || !Number.isFinite(location.lon) ||
        location.lat < -90 || location.lat > 90 || location.lon < -180 || location.lon > 180) return null;
    return { lat: location.lat, lon: location.lon, ...this._projectHeatmapCoordinate(location.lat, location.lon) };
  },

  _buildHeatmapClusters(connections, geoData, zoom) {
    const tier = this._heatmapTierForZoom(zoom);
    const groups = new Map();
    const value = (connection, camel, pascal) => connection?.[camel] ?? connection?.[pascal] ?? '';
    const riskRank = { SAFE: 0, UNKNOWN: 1, MALICIOUS: 2 };
    const countValue = (bucket, key) => {
      const label = String(key || '').trim();
      if (label) bucket.set(label, (bucket.get(label) || 0) + 1);
    };

    for (const connection of connections || []) {
      const ip = String(value(connection, 'remoteAddress', 'RemoteAddress'));
      const geo = geoData?.[ip];
      const lat = Number(geo?.lat);
      const lon = Number(geo?.lon);
      if (!ip || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      const cellLon = Math.floor((lon + 180) / tier.lonStep);
      const cellLat = Math.floor((lat + 90) / tier.latStep);
      const id = `${tier.id}:${cellLon}:${cellLat}`;
      if (!groups.has(id)) {
        groups.set(id, {
          id, tier: tier.id, count: 0, latTotal: 0, lonTotal: 0,
          ips: new Set(), locations: new Set(), connections: [],
          risks: { SAFE: 0, UNKNOWN: 0, MALICIOUS: 0 }, highestRisk: 'SAFE',
          processes: new Map(), services: new Map(), states: new Map(), ports: new Map()
        });
      }
      const group = groups.get(id);
      const risk = ['SAFE', 'UNKNOWN', 'MALICIOUS'].includes(connection.classification) ? connection.classification : 'UNKNOWN';
      group.count++;
      group.latTotal += lat;
      group.lonTotal += lon;
      group.ips.add(ip);
      group.connections.push(connection);
      group.risks[risk]++;
      if (riskRank[risk] > riskRank[group.highestRisk]) group.highestRisk = risk;
      if (geo.city || geo.country) group.locations.add([geo.city, geo.country].filter(Boolean).join(', '));
      countValue(group.processes, connection.processName || (connection.pid ? `PID ${connection.pid}` : ''));
      countValue(group.services, connection.serviceName || value(connection, 'remotePort', 'RemotePort'));
      countValue(group.states, value(connection, 'state', 'State'));
      countValue(group.ports, value(connection, 'remotePort', 'RemotePort'));
    }

    const clusters = Array.from(groups.values()).map((group) => {
      const lat = group.latTotal / group.count;
      const lon = group.lonTotal / group.count;
      const top = (map) => Array.from(map, ([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return {
        ...group,
        lat, lon,
        ...this._projectHeatmapCoordinate(lat, lon),
        ips: Array.from(group.ips).sort(),
        locations: Array.from(group.locations).sort(),
        processes: top(group.processes), services: top(group.services),
        states: top(group.states), ports: top(group.ports)
      };
    });
    clusters.sort((a, b) => riskRank[b.highestRisk] - riskRank[a.highestRisk] || b.count - a.count || a.id.localeCompare(b.id));
    const labelIds = new Set([...clusters].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, tier.labelLimit).map((c) => c.id));
    for (const cluster of clusters) cluster.showLabel = labelIds.has(cluster.id);
    return { tier, clusters };
  },

  _focusHeatmapTarget(cluster, viewportW, viewportH) {
    const tier = this._heatmapTierForZoom(this._heatmapZoom);
    const zoom = tier.nextZoom;
    const worldX = (cluster.x / 100) * viewportW;
    const worldY = (cluster.y / 100) * viewportH;
    const pan = this._clampHeatmapPan(zoom, {
      x: viewportW / 2 - worldX * zoom,
      y: viewportH / 2 - worldY * zoom
    }, viewportW, viewportH);
    return { zoom, pan };
  },

  _resolveHeatmapSelection(clusters, selectedId, selectedIps) {
    const ips = new Set(selectedIps || []);
    return clusters.find((cluster) => cluster.id === selectedId) ||
      (ips.size ? clusters.find((cluster) => cluster.ips.some((ip) => ips.has(ip))) : null) || null;
  },

  _createHeatmapWidget(t) {
    const widget = document.createElement('div');
    widget.className = 'heatmap-widget card';
    widget.innerHTML = `
      <div id="heatmapViewport" class="heatmap-viewport">
        <div id="heatmapWorld" class="heatmap-world">
          <div class="heatmap-map-skin" aria-hidden="true"></div>
          <svg id="heatmapArcs" class="heatmap-arcs" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <div id="heatmapMarkers" class="heatmap-markers"></div>
          <div id="heatmapHome" class="heatmap-home" aria-hidden="true"></div>
          <div class="heatmap-pan-hint">${escapeHtml(t('network.heatmapPanHint'))}</div>
        </div>
        <div id="heatmapTooltip" class="heatmap-tooltip" role="tooltip"></div>
        <div class="heatmap-controls">
          <div class="heatmap-controls-row">
            <button type="button" id="heatmapArcsToggle" class="heatmap-zoom-btn heatmap-arcs-toggle"><span aria-hidden="true">&#10022;</span><span>${escapeHtml(t('network.heatmapArcsLabel'))}</span></button>
            <button type="button" id="heatmapZoomOut" class="heatmap-zoom-btn" title="${escapeHtml(t('network.heatmapZoomOut'))}" aria-label="${escapeHtml(t('network.heatmapZoomOut'))}">&minus;</button>
            <button type="button" id="heatmapZoomIn" class="heatmap-zoom-btn" title="${escapeHtml(t('network.heatmapZoomIn'))}" aria-label="${escapeHtml(t('network.heatmapZoomIn'))}">+</button>
          </div>
          <button type="button" id="heatmapZoomReset" class="heatmap-zoom-btn heatmap-reset" title="${escapeHtml(t('network.heatmapZoomReset'))}"><span id="heatmapZoomLabel">100%</span>&nbsp;&#8635;</button>
        </div>
      </div>
      <aside id="heatmapClusterPanel" class="heatmap-cluster-panel" hidden></aside>`;
    return widget;
  },

  _mountHeatmapWidget(content, data, t) {
    const mount = content.querySelector('#heatmapWidgetMount');
    if (!mount) return;
    if (!this._heatmapWidgetEl) this._heatmapWidgetEl = this._createHeatmapWidget(t);
    mount.replaceWith(this._heatmapWidgetEl);
    this._updateHeatmapWidget(data, t);
    this._applyHeatmapTransform(content);
  },

  _updateHeatmapWidget(data, t) {
    const widget = this._heatmapWidgetEl;
    if (!widget) return;
    const built = this._buildHeatmapClusters(data.connections, data.geoData, this._heatmapZoom);
    const tierChanged = this._heatmapTier !== built.tier.id;
    this._heatmapTier = built.tier.id;
    this._heatmapClusters = built.clusters;
    const priorIps = new Set(this._selectedClusterIps || []);
    const selected = this._resolveHeatmapSelection(built.clusters, this._selectedClusterId, priorIps);
    if (selected) {
      this._selectedClusterId = selected.id;
      this._selectedClusterIps = selected.ips;
      this._selectedClusterLoc = selected.locations.join(' | ');
    } else {
      this._selectedClusterId = null;
      this._selectedClusterIps = null;
      this._selectedClusterLoc = null;
    }
    this._diffHeatmapMarkers(widget, built.clusters, t, tierChanged);
    this._diffHeatmapArcs(widget, built.clusters, t);
    this._renderHeatmapDrawer(widget, selected, t);
  },

  _diffHeatmapMarkers(widget, clusters, t, tierChanged) {
    const layer = widget.querySelector('#heatmapMarkers');
    if (!layer) return;
    let empty = layer.querySelector('.heatmap-empty');
    if (!clusters.length && !empty) {
      empty = document.createElement('div');
      empty.className = 'heatmap-empty';
      layer.appendChild(empty);
    }
    if (empty) {
      empty.textContent = t('network.heatmapNoMatches');
      empty.hidden = clusters.length > 0;
    }
    const existing = new Map(Array.from(layer.querySelectorAll('.heatmap-marker'), (node) => [node.dataset.clusterId, node]));
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    for (const cluster of clusters) {
      let marker = existing.get(cluster.id);
      const isNew = !marker;
      if (!marker) {
        marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'heatmap-marker';
        marker.innerHTML = '<span class="heatmap-marker-count"></span><span class="heatmap-marker-label"></span>';
        layer.appendChild(marker);
      }
      existing.delete(cluster.id);
      const location = cluster.locations.join(' | ') || t('common.unverifiedLocation');
      const classLabel = this._classificationLabel(cluster.highestRisk);
      const safeStop = (cluster.risks.SAFE / cluster.count) * 100;
      const unknownStop = safeStop + (cluster.risks.UNKNOWN / cluster.count) * 100;
      const size = Math.min(36, 12 + Math.log2(cluster.count + 1) * 5);
      marker.dataset.clusterId = cluster.id;
      marker.dataset.ips = cluster.ips.join(',');
      marker.dataset.loc = location;
      marker.dataset.count = String(cluster.count);
      marker.dataset.classification = cluster.highestRisk;
      marker.dataset.classLabel = classLabel;
      marker.className = `heatmap-marker heatmap-risk-${cluster.highestRisk.toLowerCase()}${this._selectedClusterId === cluster.id ? ' is-selected' : ''}${isNew && !reducedMotion ? ' is-entering' : ''}`;
      marker.style.left = `${cluster.x}%`;
      marker.style.top = `${cluster.y}%`;
      marker.style.setProperty('--cluster-size', `${size}px`);
      marker.style.setProperty('--safe-stop', `${safeStop}%`);
      marker.style.setProperty('--unknown-stop', `${unknownStop}%`);
      marker.setAttribute('aria-label', t('network.heatmapMarkerAria', { location, count: cluster.count, risk: classLabel }));
      marker.title = t('network.heatmapMarkerTitle', { location, count: cluster.count, ips: cluster.ips.length, risk: classLabel });
      marker.querySelector('.heatmap-marker-count').textContent = String(cluster.count);
      const label = marker.querySelector('.heatmap-marker-label');
      label.textContent = location;
      label.hidden = !cluster.showLabel;
      if (tierChanged) marker.classList.add('tier-changing');
    }
    for (const marker of existing.values()) {
      if (reducedMotion) marker.remove();
      else {
        marker.classList.add('is-exiting');
        marker.addEventListener('animationend', () => marker.remove(), { once: true });
      }
    }
  },

  _diffHeatmapArcs(widget, clusters, t) {
    const svg = widget.querySelector('#heatmapArcs');
    const homeEl = widget.querySelector('#heatmapHome');
    const toggle = widget.querySelector('#heatmapArcsToggle');
    const home = this._validHeatmapHome();
    const signature = home ? `${home.lat}:${home.lon}|${clusters.map((cluster) => `${cluster.id}:${cluster.x.toFixed(2)}:${cluster.y.toFixed(2)}:${cluster.highestRisk}`).join('|')}` : '';
    homeEl.hidden = !home;
    svg.hidden = !home || !this._heatmapShowArcs;
    toggle.disabled = !home;
    toggle.title = !home ? t('network.heatmapArcsUnavailable') : (this._heatmapShowArcs ? t('network.heatmapArcsOn') : t('network.heatmapArcsOff'));
    toggle.setAttribute('aria-pressed', this._heatmapShowArcs ? 'true' : 'false');
    toggle.classList.toggle('is-muted', !this._heatmapShowArcs || !home);
    if (!home) {
      svg.replaceChildren();
      this._heatmapArcSignature = '';
      if (this._heatmapPulseRaf) cancelAnimationFrame(this._heatmapPulseRaf);
      this._heatmapPulseRaf = null;
      return;
    }
    homeEl.style.left = `${home.x}%`;
    homeEl.style.top = `${home.y}%`;
    homeEl.title = t('network.heatmapHomeLabel');
    if (signature === this._heatmapArcSignature) return;
    this._heatmapArcSignature = signature;
    const namespace = 'http://www.w3.org/2000/svg';
    const existing = new Map(Array.from(svg.querySelectorAll('[data-cluster-id]'), (node) => [`${node.matches('path') ? 'path' : 'particle'}:${node.dataset.clusterId}`, node]));
    for (const cluster of clusters) {
      const midX = (home.x + cluster.x) / 2;
      const midY = (home.y + cluster.y) / 2;
      const distance = Math.hypot(cluster.x - home.x, cluster.y - home.y);
      const controlY = midY - Math.max(2, Math.min(28, distance * 0.28));
      const pathData = `M ${home.x} ${home.y} Q ${midX} ${controlY} ${cluster.x} ${cluster.y}`;
      const riskClass = `heatmap-risk-${cluster.highestRisk.toLowerCase()}`;
      let path = existing.get(`path:${cluster.id}`);
      if (!path) { path = document.createElementNS(namespace, 'path'); svg.appendChild(path); }
      path.dataset.clusterId = cluster.id;
      path.setAttribute('d', pathData);
      path.setAttribute('class', `heatmap-arc ${riskClass}`);
      existing.delete(`path:${cluster.id}`);
      let dot = existing.get(`particle:${cluster.id}`);
      if (!dot) { dot = document.createElementNS(namespace, 'ellipse'); svg.appendChild(dot); }
      dot.dataset.clusterId = cluster.id;
      dot.setAttribute('class', `heatmap-pulse-dot ${riskClass}`);
      const dotRadius = cluster.highestRisk === 'MALICIOUS' ? 1.05 : 0.75;
      dot.setAttribute('rx', String(dotRadius));
      dot.setAttribute('ry', String(dotRadius * (950 / 620)));
      dot.dataset.hx = String(home.x); dot.dataset.hy = String(home.y);
      dot.dataset.cx0 = String(midX); dot.dataset.cy0 = String(controlY);
      dot.dataset.tx = String(cluster.x); dot.dataset.ty = String(cluster.y);
      dot.dataset.dur = String(Math.max(1.4, Math.min(3.4, 1 + distance / 32)));
      const hash = Array.from(cluster.id).reduce((total, character) => ((total * 31) + character.charCodeAt(0)) | 0, 0);
      dot.dataset.delay = String((Math.abs(hash) % 20) / 10);
      existing.delete(`particle:${cluster.id}`);
    }
    for (const node of existing.values()) node.remove();
    this._startHeatmapPulses(widget);
  },

  _selectHeatmapCluster(clusterId) {
    const selected = this._heatmapClusters.find((cluster) => cluster.id === clusterId) || null;
    this._selectedClusterId = selected?.id || null;
    this._selectedClusterIps = selected?.ips || null;
    this._selectedClusterLoc = selected?.locations.join(' | ') || null;
    this._heatmapWidgetEl?.querySelectorAll('.heatmap-marker').forEach((marker) => marker.classList.toggle('is-selected', marker.dataset.clusterId === this._selectedClusterId));
    this._renderHeatmapDrawer(this._heatmapWidgetEl, selected, (key, vars) => window.I18n?.t(key, vars) ?? key);
  },

  _renderHeatmapDrawer(widget, cluster, t) {
    const panel = widget?.querySelector('#heatmapClusterPanel');
    if (!panel) return;
    if (!cluster) { panel.hidden = true; panel.innerHTML = ''; return; }
    const location = cluster.locations.join(' | ') || t('common.unverifiedLocation');
    const list = (items, empty) => items.length ? items.slice(0, 5).map((item) => `<span>${escapeHtml(item.label)} <b>${item.count}</b></span>`).join('') : `<span>${escapeHtml(empty)}</span>`;
    const endpoints = cluster.connections.map((connection) => {
      const ip = connection.remoteAddress ?? connection.RemoteAddress ?? '';
      const port = connection.remotePort ?? connection.RemotePort ?? '';
      const state = connection.state ?? connection.State ?? '';
      const processName = connection.processName || (connection.pid ? `PID ${connection.pid}` : t('common.unknown'));
      const risk = ['SAFE', 'UNKNOWN', 'MALICIOUS'].includes(connection.classification) ? connection.classification : 'UNKNOWN';
      return `<div class="heatmap-endpoint-row heatmap-risk-${risk.toLowerCase()}"><code>${escapeHtml(ip)}:${escapeHtml(port)}</code><span>${escapeHtml(processName)}</span><small>${escapeHtml(state)}</small></div>`;
    }).join('');
    panel.innerHTML = `
      <div class="heatmap-drawer-header"><div><small>${escapeHtml(t('network.clusterDetails'))}</small><strong>${escapeHtml(location)}</strong></div><button type="button" class="heatmap-infobox-close" aria-label="${escapeHtml(t('network.heatmapCloseDetails'))}">&times;</button></div>
      <div class="heatmap-drawer-body">
        <div class="heatmap-kpis"><span><b>${cluster.count}</b>${escapeHtml(t('network.heatmapConnections'))}</span><span><b>${cluster.ips.length}</b>${escapeHtml(t('network.heatmapUniqueIps'))}</span></div>
        <div class="heatmap-risk-breakdown"><span class="heatmap-risk-safe">${escapeHtml(t('network.heatmapLegendSafe'))} <b>${cluster.risks.SAFE}</b></span><span class="heatmap-risk-unknown">${escapeHtml(t('network.heatmapLegendUnverified'))} <b>${cluster.risks.UNKNOWN}</b></span><span class="heatmap-risk-malicious">${escapeHtml(t('network.heatmapLegendMalicious'))} <b>${cluster.risks.MALICIOUS}</b></span></div>
        <section><h4>${escapeHtml(t('network.heatmapTopProcesses'))}</h4><div class="heatmap-chip-list">${list(cluster.processes, t('network.heatmapNone'))}</div></section>
        <section><h4>${escapeHtml(t('network.heatmapTopServices'))}</h4><div class="heatmap-chip-list">${list(cluster.services, t('network.heatmapNone'))}</div></section>
        <section><h4>${escapeHtml(t('network.heatmapStatesPorts'))}</h4><div class="heatmap-chip-list">${list(cluster.states, t('network.heatmapNone'))}${list(cluster.ports, t('network.heatmapNone'))}</div></section>
        <section><h4>${escapeHtml(t('network.heatmapEndpoints'))}</h4><div class="heatmap-endpoints">${endpoints}</div></section>
        <button type="button" id="heatmapFocusCluster" class="button secondary heatmap-focus">${escapeHtml(t('network.heatmapFocusCluster'))}</button>
      </div>`;
    panel.hidden = false;
  },

  _refreshHeatmapTier(content) {
    const tier = this._heatmapTierForZoom(this._heatmapZoom);
    if (tier.id === this._heatmapTier || !this._heatmapData) return;
    this._updateHeatmapWidget(this._heatmapData, (key, vars) => window.I18n?.t(key, vars) ?? key);
    this._applyHeatmapTransform(content);
  },

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

    this._renderAsync(container, t);
  },

async _renderAsync(container, t) {
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">${escapeHtml(t('network.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('network.subtitle'))}</p>
      </header>
      <div id="networkContent">
        <div class="empty-state">
          <span class="spinner"></span>&nbsp;${escapeHtml(t('network.loading'))}
          <div style="margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
            <img src="../../../assets/soteriosTextLogo.png" alt="Soterios" style="width: 120px; height: auto; filter: drop-shadow(0 0 16px var(--accent-primary));" />
            <div class="loading-wordmark-message" id="networkLoadingMessage">${escapeHtml(t('loading.loadingConnections'))}</div>
          </div>
        </div>
      </div>
    `;
    await this.load(container, true);

    const content = container.querySelector('#networkContent');
    if (content) {
      content.addEventListener('click', (e) => {
        if (window.Pages['network']._heatmapSuppressClick) {
          window.Pages['network']._heatmapSuppressClick = false;
          return;
        }
        const historyRange = e.target.closest('[data-history-hours]');
        if (historyRange) {
          const page = window.Pages['network'];
          const hours = Number(historyRange.dataset.historyHours);
          if (page._historyRangePayload(hours).hours !== page._historyRangeHours) {
            page._historyRangeHours = hours;
            page._historyInspectIndex = null;
            content.querySelectorAll('[data-history-hours]').forEach((button) => {
              const active = Number(button.dataset.historyHours) === hours;
              button.classList.toggle('is-active', active);
              button.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
            page.paintHistoryChart(content).catch(() => {});
          }
          return;
        }
        const zoomIn = e.target.closest('#heatmapZoomIn');
        const zoomOut = e.target.closest('#heatmapZoomOut');
        const zoomReset = e.target.closest('#heatmapZoomReset');
        const arcsToggle = e.target.closest('#heatmapArcsToggle');
        if (zoomIn || zoomOut || zoomReset) {
          const viewport = content.querySelector('#heatmapViewport');
          const rect = viewport ? viewport.getBoundingClientRect() : { width: 0, height: 0 };
          if (zoomReset) {
            window.Pages['network']._heatmapZoom = 1;
            window.Pages['network']._heatmapPan = { x: 0, y: 0 };
          } else {
            const factor = zoomIn ? 1.5 : 1 / 1.5;
            const oldZoom = window.Pages['network']._heatmapZoom;
            const newZoom = Math.max(1, Math.min(6, Math.round(oldZoom * factor * 100) / 100));
            const cx = rect.width / 2, cy = rect.height / 2;
            const pan = window.Pages['network']._heatmapPan;
            const worldX = (cx - pan.x) / oldZoom;
            const worldY = (cy - pan.y) / oldZoom;
            let newPan = { x: cx - worldX * newZoom, y: cy - worldY * newZoom };
            newPan = window.Pages['network']._clampHeatmapPan(newZoom, newPan, rect.width, rect.height);
            window.Pages['network']._heatmapZoom = newZoom;
            window.Pages['network']._heatmapPan = newPan;
          }
          window.Pages['network']._applyHeatmapTransform(content);
          window.Pages['network']._refreshHeatmapTier(content);
          return;
        }
        if (arcsToggle) {
          window.Pages['network']._heatmapShowArcs = !window.Pages['network']._heatmapShowArcs;
          const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
          window.Pages['network']._diffHeatmapArcs(window.Pages['network']._heatmapWidgetEl, window.Pages['network']._heatmapClusters, t);
          return;
        }
        const focusCluster = e.target.closest('#heatmapFocusCluster');
        if (focusCluster) {
          const page = window.Pages['network'];
          const cluster = page._heatmapClusters.find((item) => item.id === page._selectedClusterId);
          const viewport = content.querySelector('#heatmapViewport');
          if (cluster && viewport) {
            const rect = viewport.getBoundingClientRect();
            const target = page._focusHeatmapTarget(cluster, rect.width, rect.height);
            page._heatmapZoom = target.zoom;
            page._heatmapPan = target.pan;
            viewport.classList.add('is-focusing');
            viewport.addEventListener('transitionend', () => viewport.classList.remove('is-focusing'), { once: true });
            page._refreshHeatmapTier(content);
            page._applyHeatmapTransform(content);
          }
          return;
        }
        const marker = e.target.closest('.heatmap-marker');
        if (marker) {
          window.Pages['network']._selectHeatmapCluster(marker.dataset.clusterId);
        } else if (e.target.closest('.heatmap-infobox-close')) {
          window.Pages['network']._selectHeatmapCluster(null);
        } else if (e.target.closest('#heatmapViewport') && window.Pages['network']._selectedClusterIps) {
          // click on empty map background closes the open cluster panel
          window.Pages['network']._selectHeatmapCluster(null);
        }
      });

      content.addEventListener('wheel', (e) => {
        const viewport = e.target.closest('#heatmapViewport');
        if (!viewport) return;
        e.preventDefault();
        const page = window.Pages['network'];
        const rect = viewport.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        const oldZoom = page._heatmapZoom;
        const dir = e.deltaY > 0 ? -1 : 1;
        let newZoom = Math.round((oldZoom + dir * oldZoom * 0.2) * 100) / 100;
        newZoom = Math.max(1, Math.min(6, newZoom));
        if (newZoom === oldZoom) return;
        const worldX = (localX - page._heatmapPan.x) / oldZoom;
        const worldY = (localY - page._heatmapPan.y) / oldZoom;
        let newPan = { x: localX - worldX * newZoom, y: localY - worldY * newZoom };
        newPan = page._clampHeatmapPan(newZoom, newPan, rect.width, rect.height);
        page._heatmapZoom = newZoom;
        page._heatmapPan = newPan;
        page._applyHeatmapTransform(content);
        page._refreshHeatmapTier(content);
      }, { passive: false });

      content.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const viewport = e.target.closest('#heatmapViewport');
        if (!viewport) return;
        if (e.target.closest('.heatmap-marker') || e.target.closest('.heatmap-zoom-btn') || e.target.closest('#heatmapClusterPanel')) return;
        const page = window.Pages['network'];
        page._heatmapDrag = {
          startX: e.clientX,
          startY: e.clientY,
          startPan: { x: page._heatmapPan.x, y: page._heatmapPan.y },
          moved: false,
          rect: viewport.getBoundingClientRect()
        };
        viewport.classList.add('panning');
      });

      window.removeEventListener('mousemove', this._heatmapWindowMouseMove || (() => {}));
      window.removeEventListener('mouseup', this._heatmapWindowMouseUp || (() => {}));
      document.removeEventListener('keydown', this._heatmapKeydownHandler || (() => {}));

      this._heatmapWindowMouseMove = (e) => {
        const page = window.Pages['network'];
        if (!page._heatmapDrag || !document.body.contains(container)) return;
        const st = page._heatmapDrag;
        const dx = e.clientX - st.startX;
        const dy = e.clientY - st.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) st.moved = true;
        if (page._heatmapZoom <= 1.001) return;
        let newPan = { x: st.startPan.x + dx, y: st.startPan.y + dy };
        newPan = page._clampHeatmapPan(page._heatmapZoom, newPan, st.rect.width, st.rect.height);
        page._heatmapPan = newPan;
        page._applyHeatmapTransform(content);
      };
      this._heatmapWindowMouseUp = () => {
        const page = window.Pages['network'];
        const viewport = content.querySelector('#heatmapViewport');
        if (viewport) viewport.classList.remove('panning');
        if (page._heatmapDrag) {
          if (page._heatmapDrag.moved) page._heatmapSuppressClick = true;
          page._heatmapDrag = null;
        }
      };
      this._heatmapKeydownHandler = (e) => {
        if (e.key !== 'Escape') return;
        if (!document.body.contains(container)) {
          document.removeEventListener('keydown', window.Pages['network']._heatmapKeydownHandler);
          return;
        }
        if (window.Pages['network']._selectedClusterIps) {
          window.Pages['network']._selectHeatmapCluster(null);
        }
      };
      window.addEventListener('mousemove', this._heatmapWindowMouseMove);
      window.addEventListener('mouseup', this._heatmapWindowMouseUp);
      document.addEventListener('keydown', this._heatmapKeydownHandler);

      content.addEventListener('mousemove', (e) => {
        const page = window.Pages['network'];
        const tooltip = content.querySelector('#heatmapTooltip');
        const viewport = content.querySelector('#heatmapViewport');
        if (!tooltip || !viewport) return;
        const marker = e.target.closest('.heatmap-marker');
        if (!marker) {
          if (tooltip.style.display !== 'none') tooltip.style.display = 'none';
          return;
        }
        const vpRect = viewport.getBoundingClientRect();
        const localX = e.clientX - vpRect.left;
        const localY = e.clientY - vpRect.top;
        if (tooltip.dataset.forIps !== marker.dataset.ips) {
          tooltip.dataset.forIps = marker.dataset.ips;
          const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
          let classColor = 'var(--ok)';
          if (marker.dataset.classification === 'MALICIOUS') classColor = 'var(--danger)';
          else if (marker.dataset.classification === 'UNKNOWN') classColor = 'var(--warn)';
          tooltip.innerHTML = `
            <div style="font-weight:600; color:var(--text-main); margin-bottom:3px;">${escapeHtml(marker.dataset.loc)}</div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:14px;">
              <span style="color:var(--text-dim);">${escapeHtml(t('network.heatmapTooltipConnections', { count: marker.dataset.count }))}</span>
              <span style="font-weight:600; color:${classColor};">${escapeHtml(marker.dataset.classLabel)}</span>
            </div>`;
        }
        tooltip.style.display = 'block';
        let left = localX + 14;
        let top = localY + 14;
        if (left > vpRect.width - 200) left = localX - 214;
        if (top > vpRect.height - 70) top = localY - 60;
        tooltip.style.left = `${Math.max(4, left)}px`;
        tooltip.style.top = `${Math.max(4, top)}px`;
      });

      content.addEventListener('mouseleave', (e) => {
        if (e.target && e.target.id === 'networkContent') {
          const tooltip = content.querySelector('#heatmapTooltip');
          if (tooltip) tooltip.style.display = 'none';
        }
      }, true);

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
          if (window.Pages['network']._groupByProcess) {
            window.Pages['network']._expandedGroups = new Set();
          }
          window.Pages['network'].load(container, false);
        }
      });
      content.addEventListener('click', (e) => {
        const minimizeBtn = e.target.closest('.card-minimize-btn');
        if (minimizeBtn) {
          const cardId = minimizeBtn.dataset.cardId;
          if (window.Pages['network']._minimized.has(cardId)) {
            window.Pages['network']._minimized.delete(cardId);
          } else {
            window.Pages['network']._minimized.add(cardId);
          }
          window.Pages['network'].load(container, false);
          return;
        }
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
        } else if (e.target.closest('#vpnAddBtn')) {
          console.log('[Network] Add VPN button clicked');
          if (window.VpnAddModal) {
            console.log('[Network] VpnAddModal found, opening...');
            window.VpnAddModal.open({
              onSuccess: () => {
                window.Pages['network'].load(container, false);
              }
            });
          } else {
            console.error('[Network] VpnAddModal NOT found on window');
          }
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

    // Separate timer for traffic history chart (data updates every ~30s)
    this._chartRefreshTimer = setInterval(() => {
      if (!document.body.contains(container)) {
        clearInterval(this._chartRefreshTimer);
        this._chartRefreshTimer = null;
        return;
      }
      const content = container.querySelector('#networkContent');
if (content) this.paintHistoryChart(content).catch(() => {});
    }, this.CHART_REFRESH_INTERVAL_MS);
  },

  async load(container, isInitial = false) {
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

      // Fetch user location on initial load (safely with fallback)
      if (isInitial && !this._userLocation) {
        try {
          this._userLocation = await window.api.invoke('network:getUserLocation');
          // Safety: validate the returned location data
          if (this._userLocation) {
            if (typeof this._userLocation.lat !== 'number' || typeof this._userLocation.lon !== 'number' ||
                this._userLocation.lat < -90 || this._userLocation.lat > 90 ||
                this._userLocation.lon < -180 || this._userLocation.lon > 180) {
              console.warn('Invalid user location data received, using fallback');
              this._userLocation = null;
            }
          }
        } catch (e) {
          console.warn('Failed to fetch user location, using fallback:', e.message || e);
          this._userLocation = null;
        }
      }

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
      const vpnMin = this._minimized.has('vpn');
      html += `<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">`;
      html += `<div>
        <h3 style="margin:0 0 2px; font-size:1rem; display:flex; align-items:center; gap:8px;">
          ${escapeHtml(t('network.vpnTitle'))}
          <button class="card-minimize-btn" data-card-id="vpn" title="${vpnMin ? 'Restore' : 'Minimize'}" style="background:none; border:none; cursor:pointer; color:var(--text-dim); font-size:1rem; padding:0 4px; line-height:1; transition:transform 0.2s;" aria-label="${vpnMin ? 'Restore' : 'Minimize'}">${vpnMin ? '&#9660;' : '&#9650;'}</button>
        </h3>
        <div class="page-subtitle" style="font-size:0.8rem;">${escapeHtml(t('network.vpnSubtitle'))}</div>
      </div>`;
      if (!vpnMin) {
        if (vpns.length === 0) {
        html += `<div style="font-size:0.8rem; color:var(--text-dim); flex:1 1 100%; display:flex; align-items:center; gap:8px;">
          ${escapeHtml(t('network.vpnNoProfiles'))}
          <button id="vpnAddBtn" class="btn btn-sm btn-secondary" data-i18n="network.vpn.addBtn">Add VPN</button>
        </div>`;
      } else {
        // Try to get last VPN profile from settings for pre-selection
        let lastProfile = '';
        try {
          const lastProfileResult = await window.api.invoke('db:getSetting', 'vpn.lastProfile');
          if (lastProfileResult && typeof lastProfileResult === 'string') {
            lastProfile = lastProfileResult;
          }
        } catch (_) {}

        const selectedName = vpns.some((v) => v.name === this._vpnSelection)
          ? this._vpnSelection
          : (lastProfile && vpns.some(v => v.name === lastProfile)
              ? lastProfile
              : (vpns.find((v) => v.connected) || vpns[0]).name);
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
        // Add VPN button
        html += `<button id="vpnAddBtn" class="btn btn-sm btn-secondary" style="margin-left:8px;" data-i18n="network.vpn.addBtn">Add VPN</button>`;
        html += '</div>';
      }
      }
      html += '</div></div>';

      html += '<div style="display:flex; gap:16px; margin-bottom:18px; flex-wrap:wrap; align-items:stretch;">';

      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      const bwMin = this._minimized.has('bandwidth');
      html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:${bwMin ? '0' : '10px'};"><h3 style="margin:0; font-size:1rem;">${escapeHtml(t('network.bandwidth'))}</h3><button class="card-minimize-btn" data-card-id="bandwidth" title="${bwMin ? 'Restore' : 'Minimize'}" style="background:none; border:none; cursor:pointer; color:var(--text-dim); font-size:1rem; padding:0 4px; line-height:1; transition:transform 0.2s;" aria-label="${bwMin ? 'Restore' : 'Minimize'}">${bwMin ? '&#9660;' : '&#9650;'}</button></div>`;
      if (!bwMin) {
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
      }
      html += '</div></div>';

      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      const csMin = this._minimized.has('connStates');
      html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:${csMin ? '0' : '10px'};"><h3 style="margin:0; font-size:1rem;">${escapeHtml(t('network.connectionStates'))}</h3><button class="card-minimize-btn" data-card-id="connStates" title="${csMin ? 'Restore' : 'Minimize'}" style="background:none; border:none; cursor:pointer; color:var(--text-dim); font-size:1rem; padding:0 4px; line-height:1; transition:transform 0.2s;" aria-label="${csMin ? 'Restore' : 'Minimize'}">${csMin ? '&#9660;' : '&#9650;'}</button></div>`;
      if (!csMin) {
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
      }
      html += '</div></div>';

      html += '<div style="flex:1 1 0; min-width:260px; display:flex; flex-direction:column;">';
      html += '<div class="card" style="padding:14px 16px; flex:1;">';
      const sfMin = this._minimized.has('secFlags');
      html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:${sfMin ? '0' : '10px'};"><h3 style="margin:0; font-size:1rem;">${escapeHtml(t('network.securityFlags'))}</h3><button class="card-minimize-btn" data-card-id="secFlags" title="${sfMin ? 'Restore' : 'Minimize'}" style="background:none; border:none; cursor:pointer; color:var(--text-dim); font-size:1rem; padding:0 4px; line-height:1; transition:transform 0.2s;" aria-label="${sfMin ? 'Restore' : 'Minimize'}">${sfMin ? '&#9660;' : '&#9650;'}</button></div>`;
      if (!sfMin) {
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
      }
      html += '</div></div>';

      html += '</div>';

      if (networkTrafficHistoryEnabled) {
        const histMin = this._minimized.has('history');
        const historyMinimizeLabel = histMin ? t('network.historyRestore') : t('common.minimize');
        const historyRanges = [1, 6, 24, 168].map((hours) => {
          const key = hours === 168 ? '7d' : `${hours}h`;
          const active = hours === this._historyRangeHours;
          return `<button type="button" class="history-range-btn${active ? ' is-active' : ''}" data-history-hours="${hours}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(t(`network.historyRange${key}`))}</button>`;
        }).join('');
        html += '<div class="card history-card">';
        html += `<div class="history-heading"><div><h3>${escapeHtml(t('network.historyHeading'))}</h3>${histMin ? '' : `<div class="history-range-selector" role="group" aria-label="${escapeHtml(t('network.historyRangeAria'))}">${historyRanges}</div>`}</div><button class="card-minimize-btn" data-card-id="history" title="${escapeHtml(historyMinimizeLabel)}" aria-label="${escapeHtml(historyMinimizeLabel)}">${histMin ? '&#9660;' : '&#9650;'}</button></div>`;
        if (!histMin) {
          html += '<div id="networkHistoryLegend" class="history-legend"></div>';
          html += '<div id="networkHistoryChartWrap" class="history-chart-wrap">';
          html += `<canvas id="networkHistoryChart" tabindex="0" role="img" aria-describedby="networkHistoryKeyboardHelp"></canvas>`;
          html += '<div id="networkHistoryTooltip" class="history-tooltip" hidden></div>';
          html += '</div>';
          html += `<div id="networkHistoryKeyboardHelp" class="history-keyboard-help">${escapeHtml(t('network.historyKeyboardHelp'))}</div>`;
          html += `<div id="networkHistoryEmpty" class="empty-state history-empty" hidden>${escapeHtml(t('network.historyEmpty'))}</div>`;
        }
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
        const hmMin = this._minimized.has('heatmap');
        const riskCounts = filteredConnections.reduce((counts, connection) => {
          const risk = ['SAFE', 'UNKNOWN', 'MALICIOUS'].includes(connection.classification) ? connection.classification : 'UNKNOWN';
          counts[risk]++;
          return counts;
        }, { SAFE: 0, UNKNOWN: 0, MALICIOUS: 0 });
        const minimizeLabel = hmMin ? t('network.heatmapRestore') : t('common.minimize');
        html += `<div class="heatmap-heading">
          <div><h3>${escapeHtml(t('network.heatmapTitle'))}<button class="card-minimize-btn" data-card-id="heatmap" title="${escapeHtml(minimizeLabel)}" aria-label="${escapeHtml(minimizeLabel)}">${hmMin ? '&#9660;' : '&#9650;'}</button></h3>
          <p>${escapeHtml(t('network.heatmapCounts', { total: totalConnectionsCount, filtered: filteredConnectionsCount, mapped: mappedCount }))}</p></div>
          ${hmMin ? '' : `<div class="heatmap-legend"><span class="heatmap-risk-safe">${riskCounts.SAFE} ${escapeHtml(t('network.heatmapLegendSafe'))}</span><span class="heatmap-risk-unknown">${riskCounts.UNKNOWN} ${escapeHtml(t('network.heatmapLegendUnverified'))}</span><span class="heatmap-risk-malicious">${riskCounts.MALICIOUS} ${escapeHtml(t('network.heatmapLegendMalicious'))}</span></div>`}
        </div>`;
        if (!hmMin) html += '<div id="heatmapWidgetMount"></div>';
        this._heatmapData = { connections: filteredConnections, geoData };
      } else {
        this._heatmapData = null;
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
      if (this._heatmapData && !this._minimized.has('heatmap')) {
        this._mountHeatmapWidget(content, this._heatmapData, t);
      } else if (this._minimized.has('heatmap') && this._heatmapPulseRaf) {
        cancelAnimationFrame(this._heatmapPulseRaf);
        this._heatmapPulseRaf = null;
        this._heatmapArcSignature = '';
      }

      const alertsPanelMount = content.querySelector('#networkAlertsPanel');
      if (alertsPanelMount) {
        if (!this._alertsPanelEl) {
          this._alertsPanelEl = document.createElement('div');
          this._alertsPanelEl.id = 'networkAlertsPanel';
          this._alertsPanelEl.className = 'card';
          this._alertsPanelEl.style.cssText = 'padding:10px 12px; margin-bottom:18px; display:none;';
          this._alertsPanelEl.innerHTML = `
            <h3 style="margin-bottom:6px; font-size:0.9rem;">${escapeHtml(t('network.alertsTitle'))}</h3>
            <div id="networkAlertsList" class="empty-state" style="font-size:0.8rem;">${escapeHtml(t('network.alertsLoading'))}</div>
          `;
        }
        alertsPanelMount.replaceWith(this._alertsPanelEl);
        this.renderAlertHits(content).catch((err) => {
          console.error('Failed to render network alert hits:', err);
          if (this._alertsPanelEl) {
            this._alertsPanelEl.style.display = 'block';
            const listEl = this._alertsPanelEl.querySelector('#networkAlertsList');
            if (listEl) {
              listEl.className = 'empty-state';
              listEl.textContent = t('network.alertsLoadFailed');
            }
          }
        });
      }

      if (prevScrollTop) {
        const newScrollEl = content.querySelector('#activeConnectionsList');
        if (newScrollEl) newScrollEl.scrollTop = prevScrollTop;
      }

      this.applyConnectionFilter(container);

      // Paint traffic history chart after rendering (if enabled)
      if (networkTrafficHistoryEnabled && !this._minimized.has('history')) {
        this.paintHistoryChart(content).catch(() => {});
      }

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

  _historyRangePayload(hours = this._historyRangeHours) {
    const value = Number(hours);
    return { hours: [1, 6, 24, 168].includes(value) ? value : 24 };
  },

  _beginHistoryRequest(hours = this._historyRangeHours) {
    const payload = this._historyRangePayload(hours);
    return { token: ++this._historyRequestToken, hours: payload.hours, payload };
  },

  _resolveHistoryRequest(request, rows, failed = false) {
    if (!request || request.token !== this._historyRequestToken) return { stale: true, rows: [] };
    if (failed) return { stale: false, rows: this._historyCache.get(request.hours) || [], fromCache: true };
    const safeRows = Array.isArray(rows) ? rows : [];
    this._historyCache.set(request.hours, safeRows);
    return { stale: false, rows: safeRows, fromCache: false };
  },

  _normalizeHistoryRows(rows) {
    const buckets = new Map();
    for (const row of rows || []) {
      const rawTime = row?.recorded_at ?? row?.t;
      const ms = rawTime instanceof Date ? rawTime.getTime() : Date.parse(rawTime);
      if (!Number.isFinite(ms)) continue;
      const point = buckets.get(ms) || { t: new Date(ms).toISOString(), ms, rx: 0, tx: 0 };
      point.rx += Math.max(0, Number(row.rx_sec ?? row.rx) || 0);
      point.tx += Math.max(0, Number(row.tx_sec ?? row.tx) || 0);
      buckets.set(ms, point);
    }
    return Array.from(buckets.values()).sort((a, b) => a.ms - b.ms);
  },

  _historyMetrics(series) {
    if (!series.length) return null;
    let rxTotal = 0, txTotal = 0;
    let rxPeak = { value: -1, index: 0, point: series[0] };
    let txPeak = { value: -1, index: 0, point: series[0] };
    series.forEach((point, index) => {
      rxTotal += point.rx;
      txTotal += point.tx;
      if (point.rx > rxPeak.value) rxPeak = { value: point.rx, index, point };
      if (point.tx > txPeak.value) txPeak = { value: point.tx, index, point };
    });
    return {
      current: series[series.length - 1],
      average: { rx: rxTotal / series.length, tx: txTotal / series.length },
      peak: { rx: rxPeak, tx: txPeak }
    };
  },

  _downsampleHistory(series, maxBuckets) {
    const limit = Math.max(1, Math.floor(Number(maxBuckets) || 1));
    if (series.length <= limit) {
      return series.map((point, index) => ({
        ...point, rawStart: index, rawEnd: index,
        rxPeak: { value: point.rx, index, point },
        txPeak: { value: point.tx, index, point }
      }));
    }
    const result = [];
    for (let bucketIndex = 0; bucketIndex < limit; bucketIndex++) {
      const start = Math.floor((bucketIndex / limit) * series.length);
      const endExclusive = Math.floor(((bucketIndex + 1) / limit) * series.length);
      const end = Math.max(start, endExclusive - 1);
      const slice = series.slice(start, end + 1);
      if (!slice.length) continue;
      let rx = 0, tx = 0, ms = 0;
      let rxPeak = { value: -1, index: start, point: slice[0] };
      let txPeak = { value: -1, index: start, point: slice[0] };
      slice.forEach((point, offset) => {
        const rawIndex = start + offset;
        rx += point.rx;
        tx += point.tx;
        ms += point.ms;
        if (point.rx > rxPeak.value) rxPeak = { value: point.rx, index: rawIndex, point };
        if (point.tx > txPeak.value) txPeak = { value: point.tx, index: rawIndex, point };
      });
      const averageMs = ms / slice.length;
      result.push({
        t: new Date(averageMs).toISOString(), ms: averageMs,
        rx: rx / slice.length, tx: tx / slice.length,
        rawStart: start, rawEnd: end, rxPeak, txPeak
      });
    }
    return result;
  },

  _historyLabelMode(hours = this._historyRangeHours) {
    return Number(hours) === 168 ? 'date' : 'time';
  },

  _formatHistoryTimestamp(value, hours = this._historyRangeHours, detailed = false) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    if (this._historyLabelMode(hours) === 'date') {
      return date.toLocaleString([], detailed
        ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { month: 'short', day: 'numeric' });
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  async paintHistoryChart(content) {
    return this._paintHistoryCanvas(content);
  },
  async _paintHistoryCanvas(content) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const canvas = content.querySelector('#networkHistoryChart');
    const empty = content.querySelector('#networkHistoryEmpty');
    const legend = content.querySelector('#networkHistoryLegend');
    const tooltip = content.querySelector('#networkHistoryTooltip');
    if (!canvas) return;
    const enabled = await window.api.invoke('db:getSetting', 'feature.networkTrafficHistory', true);
    if (!enabled || !canvas.isConnected) return;

    const hours = this._historyRangePayload().hours;
    const request = this._beginHistoryRequest(hours);
    let rows = [];
    let failed = false;
    try {
      rows = await window.api.invoke('network:history', request.payload) || [];
    } catch (_) {
      failed = true;
    }
    const resolved = this._resolveHistoryRequest(request, rows, failed);
    if (resolved.stale || !canvas.isConnected) return;
    const series = this._normalizeHistoryRows(resolved.rows);
    if (!series.length) {
      if (empty) empty.hidden = false;
      canvas.hidden = true;
      if (legend) legend.innerHTML = '';
      if (tooltip) tooltip.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    canvas.hidden = false;

    const metrics = this._historyMetrics(series);
    const rangeKey = hours === 168 ? '7d' : `${hours}h`;
    const rate = (value) => `${formatBytes(value)}/s`;
    if (legend) {
      const legendRow = (directionClass, label, current, average, peak) => `
        <div class="history-legend-series ${directionClass}">
          <span class="history-legend-name"><i></i>${escapeHtml(label)}</span>
          <span>${escapeHtml(t('network.historyCurrent', { value: rate(current) }))}</span>
          <span>${escapeHtml(t('network.historyAverage', { value: rate(average) }))}</span>
          <span>${escapeHtml(t('network.historyPeak', { value: rate(peak) }))}</span>
        </div>`;
      legend.innerHTML =
        legendRow('history-download', t('network.historyDownload'), metrics.current.rx, metrics.average.rx, metrics.peak.rx.value) +
        legendRow('history-upload', t('network.historyUpload'), metrics.current.tx, metrics.average.tx, metrics.peak.tx.value);
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width) || canvas.parentElement.clientWidth || 600);
    const cssH = Math.max(1, Math.round(rect.height) || 220);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padL = 64, padR = 12, padT = 38, padB = 23;
    const plotW = Math.max(1, cssW - padL - padR);
    const plotH = Math.max(1, cssH - padT - padB);
    const rendered = this._downsampleHistory(series, Math.max(1, Math.round(plotW)));
    const startMs = series[0].ms;
    const endMs = series[series.length - 1].ms;
    const timeSpan = endMs - startMs;
    const xAtMs = (ms) => timeSpan > 0 ? padL + ((ms - startMs) / timeSpan) * plotW : padL + plotW / 2;
    const axisMax = this._niceAxisMax(Math.max(metrics.peak.rx.value, metrics.peak.tx.value));
    const yAt = (value) => padT + plotH - (Math.max(0, value) / axisMax) * plotH;

    const rootStyle = getComputedStyle(canvas);
    const cssVar = (name, fallbackName) => {
      const value = rootStyle.getPropertyValue(name).trim();
      if (value && !value.includes('var(')) return value;
      return fallbackName ? rootStyle.getPropertyValue(fallbackName).trim() : '';
    };
    const colorRx = cssVar('--accent-primary', '--text-main');
    const colorTx = cssVar('--ok', '--accent-primary');
    const textDim = cssVar('--text-dim', '--text-muted');
    const textMain = cssVar('--text-main', '--text-primary');
    const gridColor = cssVar('--glass-border', '--text-dim');
    const surfaceColor = cssVar('--bg-surface', '--bg-base');
    const fontFamily = rootStyle.fontFamily || 'sans-serif';

    const pathThrough = (points) => {
      const path = new Path2D();
      if (!points.length) return path;
      path.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length - 1; index++) {
        const midpointX = (points[index].x + points[index + 1].x) / 2;
        const midpointY = (points[index].y + points[index + 1].y) / 2;
        path.quadraticCurveTo(points[index].x, points[index].y, midpointX, midpointY);
      }
      if (points.length > 1) {
        const beforeLast = points[points.length - 2];
        const last = points[points.length - 1];
        path.quadraticCurveTo(beforeLast.x, beforeLast.y, last.x, last.y);
      }
      return path;
    };

    const rxPoints = rendered.map((point) => ({ x: xAtMs(point.ms), y: yAt(point.rx) }));
    const txPoints = rendered.map((point) => ({ x: xAtMs(point.ms), y: yAt(point.tx) }));
    const drawArea = (points, color) => {
      if (!points.length) return;
      const path = new Path2D(pathThrough(points));
      path.lineTo(points[points.length - 1].x, padT + plotH);
      path.lineTo(points[0].x, padT + plotH);
      path.closePath();
      ctx.save();
      ctx.globalAlpha = .12;
      ctx.fillStyle = color;
      ctx.fill(path);
      ctx.restore();
    };
    const drawLine = (points, color) => {
      if (!points.length) return;
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 7;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(pathThrough(points));
      ctx.restore();
    };
    const drawPoint = (x, y, color, radius = 3) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    const drawCallout = (x, y, label, color) => {
      ctx.save();
      ctx.font = `10px ${fontFamily}`;
      const width = Math.min(plotW, ctx.measureText(label).width + 14);
      const left = Math.max(padL, Math.min(padL + plotW - width, x - width / 2));
      const top = Math.max(3, y - 27);
      ctx.fillStyle = surfaceColor;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(left, top, width, 18, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = textMain;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, left + width / 2, top + 9, width - 8);
      ctx.restore();
    };
    const renderedBucketIndex = (rawIndex) => rendered.findIndex((bucket) => rawIndex >= bucket.rawStart && rawIndex <= bucket.rawEnd);

    const draw = (inspectIndex = null) => {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.font = `11px ${fontFamily}`;
      ctx.textBaseline = 'middle';
      [0, .5, 1].forEach((fraction) => {
        const y = yAt(axisMax * fraction);
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(y) + .5);
        ctx.lineTo(padL + plotW, Math.round(y) + .5);
        ctx.stroke();
        ctx.fillStyle = textDim;
        ctx.textAlign = 'right';
        ctx.fillText(rate(axisMax * fraction), padL - 8, y);
      });

      const tickCount = Math.min(5, series.length);
      ctx.fillStyle = textDim;
      ctx.textBaseline = 'alphabetic';
      for (let tick = 0; tick < tickCount; tick++) {
        const index = tickCount > 1 ? Math.round((tick / (tickCount - 1)) * (series.length - 1)) : 0;
        ctx.textAlign = tick === 0 ? 'left' : (tick === tickCount - 1 ? 'right' : 'center');
        ctx.fillText(this._formatHistoryTimestamp(series[index].t, hours), xAtMs(series[index].ms), cssH - 5);
      }
      ctx.textBaseline = 'middle';

      drawArea(txPoints, colorTx);
      drawArea(rxPoints, colorRx);
      drawLine(txPoints, colorTx);
      drawLine(rxPoints, colorRx);
      drawPoint(xAtMs(metrics.current.ms), yAt(metrics.current.tx), colorTx, 3.2);
      drawPoint(xAtMs(metrics.current.ms), yAt(metrics.current.rx), colorRx, 3.2);

      const rxBucket = renderedBucketIndex(metrics.peak.rx.index);
      const txBucket = renderedBucketIndex(metrics.peak.tx.index);
      if (rxBucket === txBucket) {
        const peakX = (xAtMs(metrics.peak.rx.point.ms) + xAtMs(metrics.peak.tx.point.ms)) / 2;
        const peakY = Math.min(yAt(metrics.peak.rx.value), yAt(metrics.peak.tx.value));
        drawPoint(xAtMs(metrics.peak.rx.point.ms), yAt(metrics.peak.rx.value), colorRx, 4);
        drawPoint(xAtMs(metrics.peak.tx.point.ms), yAt(metrics.peak.tx.value), colorTx, 4);
        drawCallout(peakX, peakY, t('network.historyPeakBoth', { time: this._formatHistoryTimestamp(rendered[rxBucket].t, hours, true) }), colorRx);
      } else {
        const peaks = [
          { metric: metrics.peak.rx, color: colorRx, label: t('network.historyDownload') },
          { metric: metrics.peak.tx, color: colorTx, label: t('network.historyUpload') }
        ];
        peaks.forEach(({ metric, color, label }) => {
          const x = xAtMs(metric.point.ms), y = yAt(metric.value);
          drawPoint(x, y, color, 4);
          drawCallout(x, y, t('network.historyPeakCallout', { label, time: this._formatHistoryTimestamp(metric.point.t, hours, true) }), color);
        });
      }

      if (inspectIndex != null && series[inspectIndex]) {
        const point = series[inspectIndex];
        const x = xAtMs(point.ms);
        ctx.save();
        ctx.strokeStyle = textDim;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.restore();
        drawPoint(x, yAt(point.rx), colorRx, 4);
        drawPoint(x, yAt(point.tx), colorTx, 4);
      }
    };

    const showInspection = (index) => {
      const safeIndex = Math.max(0, Math.min(series.length - 1, index));
      this._historyInspectIndex = safeIndex;
      draw(safeIndex);
      if (!tooltip) return;
      const point = series[safeIndex];
      tooltip.innerHTML = `
        <div class="history-tooltip-time">${escapeHtml(this._formatHistoryTimestamp(point.t, hours, true))}</div>
        <div class="history-download"><i></i>${escapeHtml(t('network.historyDownload'))} <strong>${escapeHtml(rate(point.rx))}</strong></div>
        <div class="history-upload"><i></i>${escapeHtml(t('network.historyUpload'))} <strong>${escapeHtml(rate(point.tx))}</strong></div>`;
      tooltip.style.left = `${Math.max(55, Math.min(cssW - 55, xAtMs(point.ms)))}px`;
      tooltip.style.top = `${Math.max(48, Math.min(yAt(point.rx), yAt(point.tx)))}px`;
      tooltip.hidden = false;
    };

    draw(this._historyInspectIndex);
    const summary = t('network.historySummary', {
      range: t(`network.historyRange${rangeKey}`),
      downloadCurrent: rate(metrics.current.rx), uploadCurrent: rate(metrics.current.tx),
      downloadAverage: rate(metrics.average.rx), uploadAverage: rate(metrics.average.tx),
      downloadPeak: rate(metrics.peak.rx.value), uploadPeak: rate(metrics.peak.tx.value)
    });
    canvas.setAttribute('aria-label', summary);

    let framePending = false;
    canvas.onmousemove = (event) => {
      if (framePending) return;
      framePending = true;
      requestAnimationFrame(() => {
        framePending = false;
        const bounds = canvas.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left - padL) / plotW));
        showInspection(Math.round(ratio * (series.length - 1)));
      });
    };
    canvas.onmouseleave = () => {
      this._historyInspectIndex = null;
      draw(null);
      if (tooltip) tooltip.hidden = true;
    };
    canvas.onkeydown = (event) => {
      const current = this._historyInspectIndex == null ? series.length - 1 : this._historyInspectIndex;
      let next = current;
      if (event.key === 'ArrowLeft') next--;
      else if (event.key === 'ArrowRight') next++;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = series.length - 1;
      else return;
      event.preventDefault();
      showInspection(next);
    };
  },

async renderAlertHits(content) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
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
      this._alertsPanelEl.style.display = 'none';
      return;
    }

    this._alertsPanelEl.style.display = 'block';
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
          await window.api.invoke('firewall:createRule', { name: `Block IP ${ip} (Out)`, direction: 'Outbound', action: 'Block', remoteAddress: ip });
          await window.api.invoke('firewall:createRule', { name: `Block IP ${ip} (In)`, direction: 'Inbound', action: 'Block', remoteAddress: ip });
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
    if (this._chartRefreshTimer) {
      clearInterval(this._chartRefreshTimer);
      this._chartRefreshTimer = null;
    }
    if (this._heatmapPulseRaf) {
      cancelAnimationFrame(this._heatmapPulseRaf);
      this._heatmapPulseRaf = null;
    }
    if (this._heatmapWindowMouseMove) window.removeEventListener('mousemove', this._heatmapWindowMouseMove);
    if (this._heatmapWindowMouseUp) window.removeEventListener('mouseup', this._heatmapWindowMouseUp);
    if (this._heatmapKeydownHandler) document.removeEventListener('keydown', this._heatmapKeydownHandler);
    this._heatmapWindowMouseMove = null;
    this._heatmapWindowMouseUp = null;
    this._heatmapKeydownHandler = null;
    this._heatmapDrag = null;
    this._heatmapSuppressClick = false;
    this._heatmapZoom = 1;
    this._heatmapPan = { x: 0, y: 0 };
    this._connectionQuery = '';
    this._connectionRiskFilter = 'all';
    this._connectionStateFilter = 'all';
    this._geoCache = {};
    this._selectedClusterIps = null;
    this._selectedClusterLoc = null;
    this._selectedClusterId = null;
    this._heatmapClusters = [];
    this._heatmapTier = null;
    this._heatmapData = null;
    this._heatmapArcSignature = '';
    this._heatmapWidgetEl = null;
    this._historyRequestToken++;
    this._historyRangeHours = 24;
    this._historyCache.clear();
    this._historyInspectIndex = null;
    this._alertsPanelEl = null;
    this._alertsExpanded = false;
    this._lastAlertHitsKey = null;
    this._vpnPending = null;
    this._vpnError = '';
  }
};
