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

      <div class="grid grid-2">
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
            <button class="btn btn-success" id="restoreBtn" disabled style="width:100%;margin-top:8px;">
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
        <div class="panel-title" style="color:var(--warning);">${escapeHtml(t('lockdown.warning'))}</div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--warning-bg);border-radius:6px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style="font-size:13px;color:var(--warning-text);">${escapeHtml(t('lockdown.warning'))}</span>
        </div>
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

    // Load initial status
    this._updateLockdownStatus();

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
      }
    } catch (err) {
      lockdownLabel.textContent = window.I18n.t('lockdown.error');
      lockdownDetail.textContent = err.message;
    }
  },

  _showLockdownDetails(data) {
    const lockdownDetails = document.getElementById('lockdownDetails');
    const noDetailsMessage = document.getElementById('noDetailsMessage');
    const networkList = document.getElementById('networkList');
    const serviceList = document.getElementById('serviceList');
    const errorSection = document.getElementById('errorSection');
    const errorList = document.getElementById('errorList');
    
    lockdownDetails.style.display = 'block';
    noDetailsMessage.style.display = 'none';
    
    // Network interfaces
    networkList.innerHTML = data.results.disabledInterfaces.map(iface => 
      `<div class="tag tag-danger">${escapeHtml(iface)}</div>`
    ).join('') || '<div style="color:var(--text-dim);font-size:12px;">None</div>';
    
    // Services
    serviceList.innerHTML = data.results.stoppedServices.map(svc => 
      `<div class="tag tag-danger">${escapeHtml(svc)}</div>`
    ).join('') || '<div style="color:var(--text-dim);font-size:12px;">None</div>';
    
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
