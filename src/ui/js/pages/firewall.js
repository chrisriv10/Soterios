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
      </div>
    `;
    this.load(container);
  },
  async load(container) {
    const content = container.querySelector('#firewallContent');
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

      // ── PERIMETER MAP VISUALIZER ──────────────────────────────────────────
      html += `
        <div class="card" id="perimeterMapCard" style="margin-top:24px; padding:24px 28px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:18px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" style="width:18px;height:18px;flex-shrink:0;">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span style="font-weight:600; font-size:0.95rem; letter-spacing:0.3px;">Network Perimeter Map</span>
            <span style="margin-left:auto; font-size:0.78rem; color:var(--text-muted); letter-spacing:0.5px; text-transform:uppercase;">Live Rule Distribution</span>
          </div>
          <canvas id="perimeterCanvas" style="display:block; width:100%; max-width:680px; margin:0 auto; cursor:default;" height="340"></canvas>
          <div id="perimeterLegend" style="display:flex; justify-content:center; gap:28px; margin-top:16px; flex-wrap:wrap;"></div>
        </div>
      `;

      content.innerHTML = html;

      // Boot the canvas visualizer after DOM is ready
      requestAnimationFrame(() => this._initPerimeterMap(safeRules, list));

    } catch (e) {
      content.innerHTML = `<div class="empty-state">Error loading firewall: ${escapeHtml(e.message)}</div>`;
    }
  },

  // ── Perimeter Map Canvas Engine ───────────────────────────────────────────
  _initPerimeterMap(rules, profiles) {
    const canvas = document.getElementById('perimeterCanvas');
    if (!canvas) return;

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

    const card = document.getElementById('perimeterMapCard');
    const cardWidth = card ? card.clientWidth - 56 : 680;
    canvas.width = Math.min(cardWidth, 680);
    canvas.height = 340;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2 + 10;

    // Profile ring data
    const profileNames = ['domain', 'private', 'public'];
    const profileColors = ['#58A6FF', '#3FB950', '#D29922'];
    const profileLabels = ['Domain', 'Private', 'Public'];
    const radii = [68, 108, 148];

    const profileRuleCounts = profileNames.map(n => (safeRules.profiles && safeRules.profiles[n]) || 0);
    const maxCount = Math.max(...profileRuleCounts, 1);

    // Determine enabled status per profile
    const enabledByName = {};
    (Array.isArray(profiles) ? profiles : [profiles]).forEach(p => {
      if (p && p.Name) {
        enabledByName[p.Name.toLowerCase()] = p.Enabled === 1 || p.Enabled === true;
      }
    });

    // Particles
    const PARTICLE_COUNT = 38;
    const particles = [];

    function spawnParticle() {
      // Pick a profile ring weighted by rule count
      const weights = profileRuleCounts.map(c => Math.max(c, 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      let ring = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) { ring = i; break; }
      }

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.003 + Math.random() * 0.005;
      const isInbound = Math.random() > 0.5;
      const color = profileColors[ring];

      return {
        ring,
        angle,
        speed: isInbound ? -speed : speed, // inbound = clockwise inward feel
        radius: radii[ring] + (Math.random() - 0.5) * 10,
        alpha: 0,
        maxAlpha: 0.55 + Math.random() * 0.35,
        size: 1.8 + Math.random() * 2,
        color,
        life: 0,
        maxLife: 120 + Math.random() * 160,
        isInbound
      };
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = spawnParticle();
      p.life = Math.floor(Math.random() * p.maxLife); // stagger starts
      particles.push(p);
    }

    // Build legend
    const legend = document.getElementById('perimeterLegend');
    if (legend) {
      legend.innerHTML = profileLabels.map((label, i) => {
        const count = profileRuleCounts[i];
        const pct = Math.round((count / Math.max(safeRules.total, 1)) * 100);
        const isEnabled = enabledByName[profileNames[i]];
        const status = isEnabled === undefined ? '' :
          `<span style="color:${isEnabled ? '#3FB950' : '#F85149'};font-size:0.72rem;margin-left:5px;">${isEnabled ? '● ON' : '○ OFF'}</span>`;
        return `<div style="display:flex;align-items:center;gap:7px;font-size:0.8rem;color:var(--text-muted);">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${profileColors[i]};box-shadow:0 0 6px ${profileColors[i]}88;"></span>
          <span style="color:#c9d1d9;">${label}</span>
          <span style="color:#6e7681;">${count} rules · ${pct}%</span>
          ${status}
        </div>`;
      }).join('');
    }

    // Inbound / outbound arc fractions
    const inboundFrac = safeRules.total > 0 ? safeRules.inbound / safeRules.total : 0.5;
    const allowFrac = safeRules.total > 0 ? safeRules.allow / safeRules.total : 0.5;

    let frame = 0;
    let animId;

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Background subtle radial glow
      const glow = ctx.createRadialGradient(cx, cy, 20, cx, cy, 200);
      glow.addColorStop(0, 'rgba(88,166,255,0.04)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // Draw rings
      for (let i = 0; i < radii.length; i++) {
        const r = radii[i];
        const col = profileColors[i];
        const count = profileRuleCounts[i];
        const frac = count / maxCount;
        const isEnabled = enabledByName[profileNames[i]];
        const opacity = isEnabled === false ? 0.2 : 0.18 + frac * 0.22;

        // Ring track
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = col + '33';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Filled arc proportional to rule count
        if (count > 0) {
          const startAngle = -Math.PI / 2 + (frame * 0.002 * (i % 2 === 0 ? 1 : -1));
          const sweep = (count / rules.total) * Math.PI * 2;

          ctx.beginPath();
          ctx.arc(cx, cy, r, startAngle, startAngle + sweep);
          ctx.strokeStyle = col;
          ctx.lineWidth = isEnabled === false ? 1 : 2.5;
          ctx.globalAlpha = opacity + 0.15;
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Glow on the arc tip
          if (isEnabled !== false) {
            const tipAngle = startAngle + sweep;
            const tx = cx + Math.cos(tipAngle) * r;
            const ty = cy + Math.sin(tipAngle) * r;
            const tipGlow = ctx.createRadialGradient(tx, ty, 0, tx, ty, 8);
            tipGlow.addColorStop(0, col + 'cc');
            tipGlow.addColorStop(1, col + '00');
            ctx.fillStyle = tipGlow;
            ctx.beginPath();
            ctx.arc(tx, ty, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Center shield icon (drawn as polygon)
      const shieldR = 26;
      ctx.save();
      ctx.translate(cx, cy);
      // Shield shape
      ctx.beginPath();
      ctx.moveTo(0, -shieldR);
      ctx.bezierCurveTo(shieldR * 0.8, -shieldR * 0.8, shieldR, -shieldR * 0.2, shieldR, shieldR * 0.1);
      ctx.bezierCurveTo(shieldR, shieldR * 0.6, shieldR * 0.5, shieldR * 0.9, 0, shieldR);
      ctx.bezierCurveTo(-shieldR * 0.5, shieldR * 0.9, -shieldR, shieldR * 0.6, -shieldR, shieldR * 0.1);
      ctx.bezierCurveTo(-shieldR, -shieldR * 0.2, -shieldR * 0.8, -shieldR * 0.8, 0, -shieldR);
      ctx.closePath();

      const shieldGrad = ctx.createLinearGradient(0, -shieldR, 0, shieldR);
      shieldGrad.addColorStop(0, 'rgba(88,166,255,0.25)');
      shieldGrad.addColorStop(1, 'rgba(88,166,255,0.08)');
      ctx.fillStyle = shieldGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(88,166,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Checkmark or cross inside shield based on any profile disabled
      const anyDisabled = Object.values(enabledByName).some(v => v === false);
      ctx.strokeStyle = anyDisabled ? '#F85149' : '#3FB950';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      if (anyDisabled) {
        ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-2, 7); ctx.lineTo(9, -6); ctx.stroke();
      }
      ctx.restore();

      // Center labels
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8B949E';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText(`${safeRules.total} rules`, cx, cy + shieldR + 18);

      // Profile labels on rings
      for (let i = 0; i < radii.length; i++) {
        const labelAngle = -Math.PI / 2 - 0.18;
        const lx = cx + Math.cos(labelAngle) * (radii[i] + 14);
        const ly = cy + Math.sin(labelAngle) * (radii[i] + 14);
        ctx.fillStyle = profileColors[i];
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.globalAlpha = 0.85;
        ctx.fillText(profileLabels[i].toUpperCase(), lx, ly + 4);
        ctx.globalAlpha = 1;
      }

      // Inbound / outbound split arc (outermost decorative ring)
      const outerR = 178;
      const splitStart = -Math.PI / 2;
      // Inbound arc
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, splitStart, splitStart + inboundFrac * Math.PI * 2);
      ctx.strokeStyle = 'rgba(88,166,255,0.35)';
      ctx.lineWidth = 3;
      ctx.stroke();
      // Outbound arc
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, splitStart + inboundFrac * Math.PI * 2, splitStart + Math.PI * 2);
      ctx.strokeStyle = 'rgba(248,81,73,0.25)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Outer ring labels at midpoints
      function arcLabel(label, startFrac, endFrac, col, isRight) {
        const midAngle = splitStart + (startFrac + (endFrac - startFrac) / 2) * Math.PI * 2;
        const lx = cx + Math.cos(midAngle) * (outerR + 18);
        const ly = cy + Math.sin(midAngle) * (outerR + 18);
        ctx.fillStyle = col;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.75;
        ctx.fillText(label, lx, ly + 4);
        ctx.globalAlpha = 1;
      }
      arcLabel(`↓ IN ${safeRules.inbound}`, 0, inboundFrac, 'rgba(88,166,255,0.9)');
      arcLabel(`↑ OUT ${safeRules.outbound}`, inboundFrac, 1, 'rgba(248,81,73,0.8)');

      // Allow/block arc (second outermost)
      const allowR = 192;
      ctx.beginPath();
      ctx.arc(cx, cy, allowR, splitStart, splitStart + allowFrac * Math.PI * 2);
      ctx.strokeStyle = 'rgba(63,185,80,0.22)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, allowR, splitStart + allowFrac * Math.PI * 2, splitStart + Math.PI * 2);
      ctx.strokeStyle = 'rgba(248,81,73,0.18)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Particles
      for (const p of particles) {
        p.life++;
        p.angle += p.speed;

        // Fade in/out
        const halfLife = p.maxLife / 2;
        if (p.life < halfLife) {
          p.alpha = (p.life / halfLife) * p.maxAlpha;
        } else {
          p.alpha = ((p.maxLife - p.life) / halfLife) * p.maxAlpha;
        }

        if (p.life >= p.maxLife) {
          Object.assign(p, spawnParticle());
          p.life = 0;
          continue;
        }

        const px = cx + Math.cos(p.angle) * p.radius;
        const py = cy + Math.sin(p.angle) * p.radius;

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Trail
        ctx.globalAlpha = p.alpha * 0.3;
        const trailAngle = p.angle - p.speed * 8;
        const tx = cx + Math.cos(trailAngle) * p.radius;
        const ty = cy + Math.sin(trailAngle) * p.radius;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.7;
        ctx.stroke();

        ctx.globalAlpha = 1;
      }

      frame++;
      animId = requestAnimationFrame(draw);
    }

    draw();

    // Cleanup on navigation away
    const observer = new MutationObserver(() => {
      if (!document.getElementById('perimeterCanvas')) {
        cancelAnimationFrame(animId);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
};
