'use strict';

window.Pages = window.Pages || {};

window.Pages['lockdown'] = {
  async render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${escapeHtml(t('lockdown.title'))}</h1>
        <div class="page-subtitle">${escapeHtml(t('lockdown.description'))}</div>
      </div>

      <div class="panel" style="margin-top:16px;">
        <div class="panel-title" style="color:var(--warning);font-size:16px;text-transform:uppercase;">${escapeHtml(t('lockdown.warning'))}</div>
      </div>

      <div class="grid grid-2" style="margin-top:16px;">
        <div class="panel">
          <div class="panel-title">${escapeHtml(t('lockdown.title'))}</div>
          <div class="lockdown-status" id="lockdownStatus">
            <div class="status-indicator" id="lockdownIndicator">
              <div class="status-icon" id="lockdownIcon"></div>
              <div class="status-text">
                <div class="status-label" id="lockdownLabel">${escapeHtml(t('lockdown.checking'))}</div>
                <div class="status-detail" id="lockdownDetail"></div>
              </div>
            </div>
          </div>
          <div class="lockdown-actions">
            <button class="btn btn-danger" id="lockdownBtn" disabled style="width:100%;margin-top:12px;">
              <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              ${escapeHtml(t('lockdown.activate'))}
            </button>
            <button class="btn btn-primary" id="restoreBtn" disabled style="width:100%;margin-top:8px;">
              <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M21 12a9 9 0 1 1-9 9 9.75 9.75 0 0 1 6.74-2.74L21 16" />
                <path d="M21 21v-5h-5" />
              </svg>
              ${escapeHtml(t('lockdown.restore'))}
            </button>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">${escapeHtml(t('lockdown.changes'))}</div>
          <div id="lockdownDetails" style="display:none;">
            <div class="field">
              <label class="field-label">${escapeHtml(t('lockdown.network'))}</label>
              <div class="lockdown-list" id="networkList"></div>
            </div>
            <div class="field">
              <label class="field-label">${escapeHtml(t('lockdown.services'))}</label>
              <div class="lockdown-list" id="serviceList"></div>
            </div>
            <div class="field" id="skippedInterfacesSection" style="display:none;">
              <label class="field-label">${escapeHtml(t('lockdown.skippedInterfaces'))}</label>
              <div class="lockdown-list" id="skippedInterfacesList"></div>
            </div>
            <div class="field" id="skippedServicesSection" style="display:none;">
              <label class="field-label">${escapeHtml(t('lockdown.skippedServices'))}</label>
              <div class="lockdown-list" id="skippedServicesList"></div>
            </div>
            <div class="field" id="errorSection" style="display:none;">
              <label class="field-label">${escapeHtml(t('lockdown.errors'))}</label>
              <div class="lockdown-list lockdown-errors" id="errorList"></div>
            </div>
          </div>
          <div id="noDetailsMessage" style="color:var(--text-dim);font-size:13px;padding:20px 0;">
            ${escapeHtml(t('lockdown.normalDetail'))}
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:16px;">
        <div class="panel-title">${escapeHtml(t('lockdown.allowlist.title'))}</div>
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:12px;">${escapeHtml(t('lockdown.allowlist.description'))}</div>
        
        <div class="grid grid-3" style="gap:16px;">
          <!-- Interfaces Allowlist -->
          <div class="panel" style="margin:0;">
            <div class="panel-title" style="font-size:13px;">${escapeHtml(t('lockdown.allowlist.interfaces'))}</div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
              <input type="text" id="allowlistInterfaceInput" list="interfacesDatalist" placeholder="${escapeHtml(t('lockdown.allowlist.addPlaceholder'))}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--input-bg);color:var(--text);font-size:13px;">
              <button class="btn btn-primary" id="addAllowlistInterfaceBtn" style="padding:6px 12px;font-size:12px;">${escapeHtml(t('lockdown.allowlist.add'))}</button>
            </div>
            <div class="lockdown-list" id="allowlistInterfacesList" style="max-height:150px;overflow-y:auto;"></div>
          </div>

          <!-- Services Allowlist -->
          <div class="panel" style="margin:0;">
            <div class="panel-title" style="font-size:13px;">${escapeHtml(t('lockdown.allowlist.services'))}</div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
              <input type="text" id="allowlistServiceInput" list="servicesDatalist" placeholder="${escapeHtml(t('lockdown.allowlist.addPlaceholder'))}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--input-bg);color:var(--text);font-size:13px;">
              <button class="btn btn-primary" id="addAllowlistServiceBtn" style="padding:6px 12px;font-size:12px;">${escapeHtml(t('lockdown.allowlist.add'))}</button>
            </div>
            <div class="lockdown-list" id="allowlistServicesList" style="max-height:150px;overflow-y:auto;"></div>
          </div>

          <!-- IPs Allowlist -->
          <div class="panel" style="margin:0;">
            <div class="panel-title" style="font-size:13px;">${escapeHtml(t('lockdown.allowlist.ips'))}</div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
              <input type="text" id="allowlistIpInput" list="ipsDatalist" placeholder="${escapeHtml(t('lockdown.allowlist.ipPlaceholder'))}" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;background:var(--input-bg);color:var(--text);font-size:13px;">
              <button class="btn btn-primary" id="addAllowlistIpBtn" style="padding:6px 12px;font-size:12px;">${escapeHtml(t('lockdown.allowlist.add'))}</button>
            </div>
            <div class="lockdown-list" id="allowlistIpsList" style="max-height:150px;overflow-y:auto;"></div>
          </div>
        </div>

        <datalist id="interfacesDatalist"></datalist>
        <datalist id="servicesDatalist"></datalist>
        <datalist id="ipsDatalist"></datalist>
      </div>
    `;

    this._initLockdownPage();
  },

  _initLockdownPage() {
    const lockdownBtn = document.getElementById('lockdownBtn');
    const restoreBtn = document.getElementById('restoreBtn');
    const lockdownIndicator = document.getElementById('lockdownIndicator');
    const lockdownIcon = document.getElementById('lockdownIcon');
    const lockdownLabel = document.getElementById('lockdownLabel');
    const lockdownDetail = document.getElementById('lockdownDetail');
    const lockdownDetails = document.getElementById('lockdownDetails');
    const noDetailsMessage = document.getElementById('noDetailsMessage');
    const networkList = document.getElementById('networkList');
    const serviceList = document.getElementById('serviceList');
    const errorSection = document.getElementById('errorSection');
    const errorList = document.getElementById('errorList');

    // Allowlist elements
    const allowlistInterfaceInput = document.getElementById('allowlistInterfaceInput');
    const addAllowlistInterfaceBtn = document.getElementById('addAllowlistInterfaceBtn');
    const allowlistInterfacesList = document.getElementById('allowlistInterfacesList');
    const allowlistServiceInput = document.getElementById('allowlistServiceInput');
    const addAllowlistServiceBtn = document.getElementById('addAllowlistServiceBtn');
    const allowlistServicesList = document.getElementById('allowlistServicesList');
    const allowlistIpInput = document.getElementById('allowlistIpInput');
    const addAllowlistIpBtn = document.getElementById('addAllowlistIpBtn');
    const allowlistIpsList = document.getElementById('allowlistIpsList');

    // Load initial status
    this._updateLockdownStatus();
    this._loadAllowlist();
    this._loadSuggestions();

    // Allowlist event listeners
    addAllowlistInterfaceBtn.addEventListener('click', () => this._addToAllowlist('interfaces', allowlistInterfaceInput.value.trim()));
    allowlistInterfaceInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this._addToAllowlist('interfaces', allowlistInterfaceInput.value.trim()); });

    addAllowlistServiceBtn.addEventListener('click', () => this._addToAllowlist('services', allowlistServiceInput.value.trim()));
    allowlistServiceInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this._addToAllowlist('services', allowlistServiceInput.value.trim()); });

    addAllowlistIpBtn.addEventListener('click', () => this._addToAllowlist('ips', allowlistIpInput.value.trim()));
    allowlistIpInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this._addToAllowlist('ips', allowlistIpInput.value.trim()); });

    lockdownBtn.addEventListener('click', async () => {
      if (!confirm(window.I18n.t('lockdown.confirmActivate'))) return;
      
      lockdownBtn.disabled = true;
      restoreBtn.disabled = true;
      lockdownLabel.textContent = window.I18n.t('lockdown.activating');
      
      try {
        const result = await window.soterios.lockdown.activate();
        if (result.ok) {
          await this._updateLockdownStatus();
          this._showLockdownDetails(result.data);
        } else {
          lockdownLabel.textContent = window.I18n.t('lockdown.error');
          lockdownDetail.textContent = result.error;
        }
      } catch (err) {
        lockdownLabel.textContent = window.I18n.t('lockdown.error');
        lockdownDetail.textContent = err.message;
      }
      
      lockdownBtn.disabled = false;
      restoreBtn.disabled = false;
    });

    restoreBtn.addEventListener('click', async () => {
      if (!confirm(window.I18n.t('lockdown.confirmRestore'))) return;
      
      lockdownBtn.disabled = true;
      restoreBtn.disabled = true;
      lockdownLabel.textContent = window.I18n.t('lockdown.restoring');
      
      try {
        const result = await window.soterios.lockdown.restore();
        if (result.ok) {
          await this._updateLockdownStatus();
          lockdownDetails.style.display = 'none';
          noDetailsMessage.style.display = 'block';
        } else {
          lockdownLabel.textContent = window.I18n.t('lockdown.error');
          lockdownDetail.textContent = result.error;
        }
      } catch (err) {
        lockdownLabel.textContent = window.I18n.t('lockdown.error');
        lockdownDetail.textContent = err.message;
      }
      
      lockdownBtn.disabled = false;
      restoreBtn.disabled = false;
    });
  },

  async _loadAllowlist() {
    try {
      const result = await window.soterios.lockdown.getAllowlist();
      if (result.ok) {
        this._renderAllowlist(result.data);
      }
    } catch (err) {
      console.error('Failed to load allowlist:', err);
    }
  },

  async _loadSuggestions() {
    const [ifacesRes, svcsRes, ipsRes] = await Promise.allSettled([
      window.soterios.lockdown.getInterfaces(),
      window.soterios.lockdown.getServices(),
      window.soterios.lockdown.getLocalIPs()
    ]);

    const interfacesList = document.getElementById('interfacesDatalist');
    if (interfacesList && ifacesRes.status === 'fulfilled' && ifacesRes.value.ok) {
      const interfaces = ifacesRes.value.data || [];
      interfacesList.innerHTML = interfaces.map(iface =>
        `<option value="${escapeHtml(iface.name)}"></option>`
      ).join('');
    }

    const servicesList = document.getElementById('servicesDatalist');
    if (servicesList && svcsRes.status === 'fulfilled' && svcsRes.value.ok) {
      const services = svcsRes.value.data || [];
      servicesList.innerHTML = services.map(svc =>
        `<option value="${escapeHtml(svc.name)}">${escapeHtml(svc.displayName || '')}</option>`
      ).join('');
    }

    const ipsList = document.getElementById('ipsDatalist');
    if (ipsList && ipsRes.status === 'fulfilled' && ipsRes.value.ok) {
      const ips = ipsRes.value.data || [];
      ipsList.innerHTML = ips.map(entry =>
        `<option value="${escapeHtml(entry.ip)}"></option>`
      ).join('');
    }
  },

  _isValidIp(value) {
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/\d{1,2})?$/;
    if (ipv4.test(value)) {
      return value.split('/')[0].split('.').every(octet => {
        const n = Number(octet);
        return n >= 0 && n <= 255;
      });
    }
    return /^[0-9a-fA-F:]+$/.test(value) && value.includes(':');
  },

  _renderAllowlist(allowlist) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    
    // Render interfaces
    const interfacesList = document.getElementById('allowlistInterfacesList');
    if (interfacesList) {
      interfacesList.innerHTML = (allowlist.interfaces || []).map(iface => 
        `<div class="tag tag-info" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span>${escapeHtml(iface)}</span>
          <button class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:11px;" data-type="interfaces" data-value="${escapeHtml(iface)}">${t('lockdown.allowlist.remove')}</button>
        </div>`
      ).join('') || '<div style="color:var(--text-dim);font-size:12px;">' + t('lockdown.allowlist.empty') + '</div>';
      
      // Add remove listeners
      interfacesList.querySelectorAll('button[data-type]').forEach(btn => {
        btn.addEventListener('click', () => this._removeFromAllowlist(btn.dataset.type, btn.dataset.value));
      });
    }

    // Render services
    const servicesList = document.getElementById('allowlistServicesList');
    if (servicesList) {
      servicesList.innerHTML = (allowlist.services || []).map(svc => 
        `<div class="tag tag-info" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span>${escapeHtml(svc)}</span>
          <button class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:11px;" data-type="services" data-value="${escapeHtml(svc)}">${t('lockdown.allowlist.remove')}</button>
        </div>`
      ).join('') || '<div style="color:var(--text-dim);font-size:12px;">' + t('lockdown.allowlist.empty') + '</div>';
      
      servicesList.querySelectorAll('button[data-type]').forEach(btn => {
        btn.addEventListener('click', () => this._removeFromAllowlist(btn.dataset.type, btn.dataset.value));
      });
    }

    // Render IPs
    const ipsList = document.getElementById('allowlistIpsList');
    if (ipsList) {
      ipsList.innerHTML = (allowlist.ips || []).map(ip => 
        `<div class="tag tag-info" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span>${escapeHtml(ip)}</span>
          <button class="btn btn-sm btn-ghost" style="padding:2px 6px;font-size:11px;" data-type="ips" data-value="${escapeHtml(ip)}">${t('lockdown.allowlist.remove')}</button>
        </div>`
      ).join('') || '<div style="color:var(--text-dim);font-size:12px;">' + t('lockdown.allowlist.empty') + '</div>';
      
      ipsList.querySelectorAll('button[data-type]').forEach(btn => {
        btn.addEventListener('click', () => this._removeFromAllowlist(btn.dataset.type, btn.dataset.value));
      });
    }
  },

  async _addToAllowlist(type, value) {
    if (!value) return;
    if (type === 'ips' && !this._isValidIp(value)) {
      alert(`Invalid IP address: ${value}`);
      return;
    }
    const inputMap = {
      interfaces: document.getElementById('allowlistInterfaceInput'),
      services: document.getElementById('allowlistServiceInput'),
      ips: document.getElementById('allowlistIpInput')
    };
    try {
      const result = await window.soterios.lockdown.addToAllowlist(type, value);
      if (result.ok) {
        inputMap[type].value = '';
        this._renderAllowlist(result.data);
      } else {
        alert(result.error || 'Failed to add to allowlist');
      }
    } catch (err) {
      alert(err.message);
    }
  },

  async _removeFromAllowlist(type, value) {
    try {
      const result = await window.soterios.lockdown.removeFromAllowlist(type, value);
      if (result.ok) {
        this._renderAllowlist(result.data);
      } else {
        alert(result.error || 'Failed to remove from allowlist');
      }
    } catch (err) {
      alert(err.message);
    }
  },

  async _updateLockdownStatus() {
    const lockdownIndicator = document.getElementById('lockdownIndicator');
    const lockdownIcon = document.getElementById('lockdownIcon');
    const lockdownLabel = document.getElementById('lockdownLabel');
    const lockdownDetail = document.getElementById('lockdownDetail');
    const lockdownBtn = document.getElementById('lockdownBtn');
    const restoreBtn = document.getElementById('restoreBtn');
    
    try {
      const result = await window.soterios.lockdown.getStatus();
      if (result.ok) {
        const status = result.data;
        if (status.isLockedDown) {
          lockdownIndicator.className = 'status-indicator status-danger';
          lockdownIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M12 17v2"/><path d="M12 11v2"/></svg>';
          lockdownLabel.textContent = window.I18n.t('lockdown.active');
          lockdownDetail.textContent = window.I18n.t('lockdown.activeDetail');
          lockdownBtn.disabled = true;
          restoreBtn.disabled = false;
        } else {
          lockdownIndicator.className = 'status-indicator status-success';
          lockdownIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
          lockdownLabel.textContent = window.I18n.t('lockdown.normal');
          lockdownDetail.textContent = window.I18n.t('lockdown.normalDetail');
          lockdownBtn.disabled = false;
          restoreBtn.disabled = true;
        }
      } else {
        // Handle unsuccessful status response
        lockdownIndicator.className = 'status-indicator status-warning';
        lockdownIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        lockdownLabel.textContent = window.I18n.t('lockdown.error');
        lockdownDetail.textContent = result.error || 'Failed to get lockdown status';
        // Keep unsafe controls disabled
        lockdownBtn.disabled = true;
        restoreBtn.disabled = true;
      }
    } catch (err) {
      lockdownIndicator.className = 'status-indicator status-warning';
      lockdownIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
      lockdownLabel.textContent = window.I18n.t('lockdown.error');
      lockdownDetail.textContent = err.message;
      // Keep unsafe controls disabled
      lockdownBtn.disabled = true;
      restoreBtn.disabled = true;
    }
  },

_showLockdownDetails(data) {
    const lockdownDetails = document.getElementById('lockdownDetails');
    const noDetailsMessage = document.getElementById('noDetailsMessage');
    const networkList = document.getElementById('networkList');
    const serviceList = document.getElementById('serviceList');
    const skippedInterfacesSection = document.getElementById('skippedInterfacesSection');
    const skippedInterfacesList = document.getElementById('skippedInterfacesList');
    const skippedServicesSection = document.getElementById('skippedServicesSection');
    const skippedServicesList = document.getElementById('skippedServicesList');
    const errorSection = document.getElementById('errorSection');
    const errorList = document.getElementById('errorList');
    
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    
    lockdownDetails.style.display = 'block';
    noDetailsMessage.style.display = 'none';
    
    // Network interfaces
    networkList.innerHTML = data.results.disabledInterfaces.map(iface => 
      `<div class="tag tag-danger">${escapeHtml(iface)}</div>`
    ).join('') || `<div style="color:var(--text-dim);font-size:12px;">${t('lockdown.none')}</div>`;
    
    // Services
    serviceList.innerHTML = data.results.stoppedServices.map(svc => 
      `<div class="tag tag-danger">${escapeHtml(svc)}</div>`
    ).join('') || `<div style="color:var(--text-dim);font-size:12px;">${t('lockdown.none')}</div>`;
    
    // Skipped interfaces (allowlisted)
    if (data.results.skippedInterfaces && data.results.skippedInterfaces.length > 0) {
      skippedInterfacesSection.style.display = 'block';
      skippedInterfacesList.innerHTML = data.results.skippedInterfaces.map(iface => 
        `<div class="tag tag-info">${escapeHtml(iface)}</div>`
      ).join('');
    } else {
      skippedInterfacesSection.style.display = 'none';
    }
    
    // Skipped services (allowlisted)
    if (data.results.skippedServices && data.results.skippedServices.length > 0) {
      skippedServicesSection.style.display = 'block';
      skippedServicesList.innerHTML = data.results.skippedServices.map(svc => 
        `<div class="tag tag-info">${escapeHtml(svc)}</div>`
      ).join('');
    } else {
      skippedServicesSection.style.display = 'none';
    }
    
    // Errors
    if (data.results.errors && data.results.errors.length > 0) {
      errorSection.style.display = 'block';
      errorList.innerHTML = data.results.errors.map(err => 
        `<div class="tag tag-warning">${escapeHtml(err)}</div>`
      ).join('');
    } else {
      errorSection.style.display = 'none';
    }
  },

  destroy() {
    // Cleanup if needed
  }
};

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
