window.Pages = window.Pages || {};
window.Pages['audit'] = {
  _cachedResults: null,
  _cacheTimestamp: null,
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  t(key, vars) {
    return window.I18n?.t(key, vars) ?? key;
  },

  // Translation map for audit check results from backend
  auditTranslations: {
    'Windows Defender Antivirus': 'audit.check.defender.name',
    'Real-Time Protection': 'audit.check.rtp.name',
    'Tamper Protection': 'audit.check.tamper.name',
    'Cloud-delivered Protection': 'audit.check.cloudProtection.name',
    'Network Protection': 'audit.check.networkProtection.name',
    'User Account Control (UAC)': 'audit.check.uac.name',
    'Windows Updates': 'audit.check.updates.name',
    'BitLocker Drive Encryption': 'audit.check.bitlocker.name',
    'BitLocker': 'audit.check.bitlocker.shortName',
    'PowerShell Execution Policy': 'audit.check.execPolicy.name',
    'Secure Boot': 'audit.check.secureBoot.name',
    'SMBv1': 'audit.check.smb1.name',
    'Automatic Logon': 'audit.check.autoLogon.name',
    'Remote Desktop': 'audit.check.remoteDesktop.name',
    'LSA Protection': 'audit.check.lsaProtection.name',
    'Password Policy': 'audit.check.passwordPolicy.name',
    'Guest Account': 'audit.check.guest.name',
    'Defender antivirus is enabled and running.': 'audit.check.defender.enabled.msg',
    'Defender antivirus is disabled!': 'audit.check.defender.disabled.msg',
    'Antivirus protection is turned off.': 'audit.check.defender.disabled.detail',
    'Real-time protection is active.': 'audit.check.rtp.active.msg',
    'Real-time protection is off!': 'audit.check.rtp.off.msg',
    'Threats are blocked as they appear.': 'audit.check.rtp.active.detail',
    'Your system is vulnerable to active threats.': 'audit.check.rtp.off.detail',
    'Tamper protection is enabled.': 'audit.check.tamper.enabled.msg',
    'Tamper protection is off!': 'audit.check.tamper.disabled.msg',
    'Malware cannot disable Defender protections.': 'audit.check.tamper.enabled.detail',
    'Malware can disable Defender protections without warning.': 'audit.check.tamper.disabled.detail',
    'Tamper protection status could not be determined.': 'audit.check.tamper.unknown.msg',
    'This check may not be supported on this system.': 'audit.check.tamper.unknown.detail',
    'Enable tamper protection in Windows Security > Virus & threat protection > Manage settings.': 'audit.check.tamper.rec',
    'Cloud-delivered protection is active.': 'audit.check.cloudProtection.active.msg',
    'Cloud-delivered protection is off!': 'audit.check.cloudProtection.off.msg',
    'New threats are blocked using up-to-the-minute cloud intelligence.': 'audit.check.cloudProtection.active.detail',
    'Protection relies only on locally installed signatures.': 'audit.check.cloudProtection.off.detail',
    'Turn on cloud-delivered protection in Windows Security > Virus & threat protection > Manage settings.': 'audit.check.cloudProtection.rec',
    'Network protection is on.': 'audit.check.networkProtection.on.msg',
    'Network protection is off!': 'audit.check.networkProtection.off.msg',
    'Malicious connections and phishing sites are blocked.': 'audit.check.networkProtection.on.detail',
    'Malicious network connections are not blocked.': 'audit.check.networkProtection.off.detail',
    'Network protection status could not be determined.': 'audit.check.networkProtection.unknown.msg',
    'This setting is not available on this system.': 'audit.check.networkProtection.unknown.detail',
    'Enable network protection in Windows Security > App & browser control.': 'audit.check.networkProtection.rec',
    'Could not query Defender hardening settings.': 'audit.check.hardening.queryError.msg',
    'The Get-MpPreference cmdlet may not be available on this system.': 'audit.check.hardening.queryError.detail',
    'UAC is enabled.': 'audit.check.uac.enabled.msg',
    'UAC is disabled! This is a severe security risk.': 'audit.check.uac.disabled.msg',
    'UAC prompts before making system-level changes.': 'audit.check.uac.enabled.detail',
    'All programs run with full administrator privileges.': 'audit.check.uac.disabled.detail',
    'No pending updates.': 'audit.check.updates.none.msg',
    'All available updates are installed.': 'audit.check.updates.none.detail',
    'System drive is encrypted.': 'audit.check.bitlocker.encrypted.msg',
    'Your data is protected if the device is lost or stolen.': 'audit.check.bitlocker.encrypted.detail',
    'System drive is NOT encrypted.': 'audit.check.bitlocker.notEncrypted.msg',
    'BitLocker status unavailable.': 'audit.check.bitlocker.unavailable.msg',
    'Anyone with physical access can read your data.': 'audit.check.bitlocker.notEncrypted.detail',
    'Could not determine BitLocker protection status.': 'audit.check.bitlocker.unknown.detail',
    'BitLocker status could not be determined.': 'audit.check.bitlocker.unknown.msg',
    'Unexpected BitLocker response format.': 'audit.check.bitlocker.unexpected.detail',
    'BitLocker is not available on this system.': 'audit.check.bitlocker.na.msg',
    'Requires Windows Pro/Enterprise and a TPM chip.': 'audit.check.bitlocker.na.detail',
    'Policy: RemoteSigned': 'audit.check.execPolicy.remoteSigned.msg',
    'Policy: Restricted': 'audit.check.execPolicy.restricted.msg',
    'Policy: AllSigned': 'audit.check.execPolicy.allSigned.msg',
    'Only signed or locally authored scripts can run.': 'audit.check.execPolicy.secure.detail',
    'Less restrictive execution policy may allow untrusted scripts.': 'audit.check.execPolicy.insecure.detail',
    'Secure Boot is enabled.': 'audit.check.secureBoot.enabled.msg',
    'Secure Boot is disabled!': 'audit.check.secureBoot.disabled.msg',
    'Only trusted bootloaders can run during system startup.': 'audit.check.secureBoot.enabled.detail',
    'System is vulnerable to bootkit attacks.': 'audit.check.secureBoot.disabled.detail',
    'SMBv1 is disabled.': 'audit.check.smb1.disabled.msg',
    'SMBv1 is enabled!': 'audit.check.smb1.enabled.msg',
    'The legacy SMBv1 protocol with known wormable vulnerabilities is off.': 'audit.check.smb1.disabled.detail',
    'SMBv1 has known wormable vulnerabilities (WannaCry, SMBGhost).': 'audit.check.smb1.enabled.detail',
    'SMBv1 may be enabled.': 'audit.check.smb1.unknown.msg',
    'SMBv1 status could not be determined.': 'audit.check.smb1.queryError.msg',
    'Could not confirm SMBv1 is disabled — it may be enabled by default.': 'audit.check.smb1.unknown.detail',
    'Disable SMBv1: Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart': 'audit.check.smb1.rec',
    'Check SMBv1 status: Get-SmbServerConfiguration | Select SMB1Protocol': 'audit.check.smb1.rec2',
    'Automatic logon is disabled.': 'audit.check.autoLogon.off.msg',
    'Automatic logon is enabled.': 'audit.check.autoLogon.on.msg',
    'Automatic logon stores a plaintext password!': 'audit.check.autoLogon.password.msg',
    'Automatic logon status could not be determined.': 'audit.check.autoLogon.unknown.msg',
    'Users must sign in manually at startup.': 'audit.check.autoLogon.off.detail',
    'Windows signs in automatically at startup without a prompt.': 'audit.check.autoLogon.on.detail',
    'Login credentials are stored in plaintext in the registry — anyone with access can read them.': 'audit.check.autoLogon.password.detail',
    'Consider disabling automatic logon in User Accounts (netplwiz) settings.': 'audit.check.autoLogon.rec',
    'Disable automatic logon: Set-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" -Name AutoAdminLogon -Value 0': 'audit.check.autoLogon.rec2',
    'Remote Desktop is disabled.': 'audit.check.remoteDesktop.off.msg',
    'Remote Desktop is enabled (NLA on).': 'audit.check.remoteDesktop.nla.msg',
    'Remote Desktop is enabled WITHOUT Network Level Authentication!': 'audit.check.remoteDesktop.noNla.msg',
    'Remote Desktop status could not be determined.': 'audit.check.remoteDesktop.unknown.msg',
    'No remote desktop attack surface is exposed.': 'audit.check.remoteDesktop.off.detail',
    'Remote connections require network-level authentication.': 'audit.check.remoteDesktop.nla.detail',
    'Attackers can attempt password brute force over the network.': 'audit.check.remoteDesktop.noNla.detail',
    'Turn off Remote Desktop when not needed: Settings > System > Remote Desktop.': 'audit.check.remoteDesktop.rec',
    'Enable NLA: Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name UserAuthentication -Value 1': 'audit.check.remoteDesktop.rec2',
    'LSA protection is enabled.': 'audit.check.lsaProtection.on.msg',
    'LSA protection is off!': 'audit.check.lsaProtection.off.msg',
    'LSA protection status could not be determined.': 'audit.check.lsaProtection.unknown.msg',
    'Credential-dumping tools cannot read Local Security Authority memory.': 'audit.check.lsaProtection.on.detail',
    'Credential-theft tools can read LSA memory and steal password hashes.': 'audit.check.lsaProtection.off.detail',
    'Enable LSA protection: Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa" -Name RunAsPPL -Value 1': 'audit.check.lsaProtection.rec',
    'Password policy meets recommendations.': 'audit.check.passwordPolicy.pass.msg',
    'Password policy could be stronger.': 'audit.check.passwordPolicy.warn.msg',
    'Password policy is weak.': 'audit.check.passwordPolicy.fail.msg',
    'Password policy could not be determined.': 'audit.check.passwordPolicy.queryError.msg',
    'Require longer passwords and a lockout threshold: net accounts /minpwlen:12 /lockoutthreshold:5': 'audit.check.passwordPolicy.rec',
    'Consider requiring longer passwords: net accounts /minpwlen:12': 'audit.check.passwordPolicy.rec2',
    'Check the policy: net accounts': 'audit.check.passwordPolicy.rec3',
    'Guest account is disabled.': 'audit.check.guest.disabled.msg',
    'Guest account is enabled!': 'audit.check.guest.enabled.msg',
    'Guest account status could not be determined.': 'audit.check.guest.unknown.msg',
    'No anonymous local access to this PC.': 'audit.check.guest.disabled.detail',
    'Anonymous users can log on locally.': 'audit.check.guest.enabled.detail',
    'Could not query the local Guest account.': 'audit.check.guest.unknown.detail',
    'Disable the Guest account: net user Guest /active:no': 'audit.check.guest.rec',
    'Could not parse Defender status.': 'audit.check.defender.parseError.msg',
    'Failed to query Defender status.': 'audit.check.defender.queryError.msg',
    'The Get-MpComputerStatus cmdlet may not be available on this system.': 'audit.check.defender.queryError.detail',
    'Could not check UAC status.': 'audit.check.uac.error.msg',
    'Could not parse update status.': 'audit.check.updates.parseError.msg',
    'Unexpected response from Windows Update query.': 'audit.check.updates.parseError.detail',
    'Could not query update status.': 'audit.check.updates.queryError.msg',
    'Windows Update may be disabled or the COM query timed out.': 'audit.check.updates.queryError.detail',
    'BitLocker status unavailable (may not be supported on this edition).': 'audit.check.bitlocker.info.msg',
    'BitLocker requires Windows Pro or Enterprise.': 'audit.check.bitlocker.info.detail',
    'PowerShell execution policy query failed.': 'audit.check.execPolicy.error.msg',
    'Unable to query execution policy.': 'audit.check.execPolicy.error.detail',
    'Secure Boot status could not be determined.': 'audit.check.secureBoot.unknown.msg',
    'This check may not be supported on virtual machines or older hardware.': 'audit.check.secureBoot.unknown.detail',
    'Enable real-time protection in Windows Security settings.': 'audit.check.rtp.rec',
    'Enable UAC via Control Panel > User Accounts > Change User Account Control settings.': 'audit.check.uac.rec',
    'Open Settings > Windows Update and install pending updates.': 'audit.check.updates.rec',
    'Enable BitLocker via Control Panel > BitLocker Drive Encryption.': 'audit.check.bitlocker.rec',
    'Consider setting to RemoteSigned: Set-ExecutionPolicy RemoteSigned -Scope LocalMachine': 'audit.check.execPolicy.rec',
    'Enable Secure Boot in your UEFI/BIOS firmware settings.': 'audit.check.secureBoot.rec',
    'Check execution policy with Get-ExecutionPolicy -List in PowerShell.': 'audit.check.execPolicy.rec2',
    'Check BitLocker status in Windows settings.': 'audit.check.bitlocker.rec2'
  },

  // Section keys emitted by the backend, mapped to translatable labels.
  sectionMap: {
    antivirus: 'audit.section.antivirus',
    system: 'audit.section.system',
    accounts: 'audit.section.accounts',
    updates: 'audit.section.updates'
  },
  SECTION_ORDER: ['antivirus', 'system', 'accounts', 'updates'],

  // Shared handler for the generic Manage button: open a settings URI or a
  // special action (open-powershell) exposed by the backend result.
  bindManageButtons(scope) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    scope.querySelectorAll('.audit-open-settings').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        if (btn.dataset.action === 'open-powershell') {
          await window.soterios.shell.openPowerShell();
        } else if (btn.dataset.uri) {
          // Control Panel applets (e.g. "control userpasswords2") are not
          // URLs and cannot go through shell.openExternal.
          if (/^control(\s|$)/i.test(btn.dataset.uri)) {
            await window.soterios.shell.openControlPanel(btn.dataset.uri);
          } else {
            await window.soterios.shell.openExternal(btn.dataset.uri);
          }
        }
      } catch (err) {
        alert(err.message || t('audit.openSettingsError'));
      }
    }));
  },

  render(container) {
    container.innerHTML = `
      <header class="page-header">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <h1 class="page-title">${escapeHtml(this.t('audit.title'))}</h1>
            <p class="page-subtitle">${escapeHtml(this.t('audit.subtitle'))}</p>
          </div>
          <button id="auditRefreshBtn" class="btn btn-secondary" style="font-size:0.85rem; padding:6px 12px;" title="${escapeHtml(this.t('audit.refreshTooltip'))}">
            ${escapeHtml(this.t('audit.refresh'))}
          </button>
        </div>
      </header>
      <div id="auditContent">
        <div class="empty-state">${escapeHtml(this.t('audit.running'))}</div>
        <div class="loading-progress" style="margin-top:8px;">
          <div class="loading-progress-bar"></div>
        </div>
        <div id="auditProgressLabel" class="page-subtitle" style="margin-top:6px; font-size:0.8rem; opacity:0.85;"></div>
      </div>
    `;
    const refreshBtn = container.querySelector('#auditRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.load(container, true));
    }
    this.load(container, false);
  },
  async load(container, forceRefresh = false) {
    const self = this;
    const content = container.querySelector('#auditContent');
    const progressBar = content?.querySelector('.loading-progress-bar');
    let creepTimer = null;
    let currentPct = 0;
    let ceilingPct = 4;
    let unsubscribeProgress = null;
    let lastProgress = null;

    // Check cache first (unless forced)
    const now = Date.now();
    const cacheFresh = self._cachedResults && self._cacheTimestamp && (now - self._cacheTimestamp) < self.CACHE_TTL_MS;
    if (!forceRefresh && cacheFresh) {
      // Use cached results directly
      const ignored = await window.api.invoke('warnings:listIgnored');
      const ignoredIds = new Set((ignored || []).map((w) => w.id));
      self._currentTranslatedResults = self._cachedResults;
      self.renderCachedResults(container, self._cachedResults, ignoredIds);
      return;
    }

    const stopCreeping = () => {
      if (creepTimer) {
        clearInterval(creepTimer);
        creepTimer = null;
      }
    };

    const startCreeping = () => {
      stopCreeping();
      creepTimer = setInterval(() => {
        if (currentPct < ceilingPct) {
          currentPct = Math.min(ceilingPct, currentPct + 1);
          if (progressBar) progressBar.style.width = `${currentPct}%`;
        }
      }, 200);
    };

    const setLoadingState = (active) => {
      if (active) {
        startCreeping();
        if (progressBar) progressBar.style.opacity = '1';
      } else {
        stopCreeping();
        if (progressBar) progressBar.style.opacity = '0';
      }
    };

    setLoadingState(true);
    unsubscribeProgress = window.api.on('audit:progress', (event) => {
      const labelEl = container.querySelector('#auditProgressLabel');
      if (!event) return;
      lastProgress = event;
      const { type, label, completed, total } = event;
      if (labelEl) {
        const translatedLabel = this.translateAuditLabel(label);
        labelEl.textContent = type === 'complete'
          ? this.t('audit.completed', { label: translatedLabel, completed, total })
          : this.t('audit.checking', { label: translatedLabel });
      }
      if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
        if (type === 'complete') {
          // Use actual progress percentage instead of creeping animation for accuracy
          currentPct = Math.max(4, Math.round((completed / total) * 100));
          if (progressBar) progressBar.style.width = `${currentPct}%`;
          // Set ceiling to actual progress to prevent bar from jumping ahead
          ceilingPct = currentPct;
        }
        const nextMilestone = Math.min(total, completed + 1);
        // Only set ceiling for next milestone if we haven't completed all checks
        if (nextMilestone < total) {
          ceilingPct = Math.max(currentPct + 1, Math.round((nextMilestone / total) * 100) - 1);
        }
      }
    });
    
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;

    try {
      const [results, ignored] = await Promise.all([
        window.api.invoke('audit:run'),
        window.api.invoke('warnings:listIgnored')
      ]);
      const ignoredIds = new Set((ignored || []).map((w) => w.id));
      if (!results || results.length === 0) {
        content.innerHTML = `<div class="empty-state">${escapeHtml(this.t('audit.noResults'))}</div>`;
        return;
      }

      // Translate audit results from backend
      const translatedResults = results.map(r => this.translateAuditResult(r));
      self._currentTranslatedResults = translatedResults;
      // Cache the results
      self._cachedResults = translatedResults;
      self._cacheTimestamp = Date.now();

      let pass = 0, fail = 0, warn = 0, err = 0;
      const visibleResults = translatedResults.filter((r) => !ignoredIds.has(this.warningId(r)));
      visibleResults.forEach(r => { if (r.status === 'pass') pass++; else if (r.status === 'fail') fail++; else if (r.status === 'warn') warn++; else if (r.status === 'error') err++; });
      let html = `<div class="grid grid-4" style="margin-bottom:18px;">
        <div class="stat-tile"><div class="stat-label">${escapeHtml(this.t('audit.passed'))}</div><div class="stat-value" style="color:var(--ok);">${pass}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(this.t('audit.failed'))}</div><div class="stat-value" style="color:var(--danger);">${fail}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(this.t('audit.warnings'))}</div><div class="stat-value" style="color:var(--warn);">${warn}</div></div>
        <div class="stat-tile"><div class="stat-label">${escapeHtml(this.t('audit.errors'))}</div><div class="stat-value" style="color:var(--text-dim);">${err}</div></div>
      </div>`;
      html += '<div id="auditResultsContainer" style="max-height:calc(100vh - 260px); overflow-y:auto; padding-right:8px; display:flex; flex-direction:column; gap:12px;">';
      html += `<div class="dashboard-grid">${this.buildResultsGrid(visibleResults)}</div>`;
      html += '</div>';
      if ((ignored || []).some((w) => String(w.id || '').startsWith('audit:'))) {
        html += `<div class="panel" style="margin-top:18px;"><div class="panel-title">${escapeHtml(this.t('audit.ignoredWarnings'))}</div>
          <div class="history-list">${ignored.filter((w) => String(w.id || '').startsWith('audit:')).map((w) => `
            <div class="history-item"><div><div class="history-title">${escapeHtml(w.title)}</div><div class="history-meta">${escapeHtml(w.detail || '')}</div></div>
            <button class="btn btn-sm audit-restore" data-id="${escapeHtml(w.id)}">${escapeHtml(this.t('audit.restore'))}</button></div>`).join('')}</div></div>`;
      }

      // The final progress event (e.g. "6/6") and the audit:run reply arrive in
      // the same IPC batch, so replacing the content here would wipe the bar
      // before it ever painted a frame. Hold the finished state long enough
      // for one paint, then swap in the results.
      const labelEl = content.querySelector('#auditProgressLabel');
      if (lastProgress && lastProgress.type === 'complete'
        && typeof lastProgress.completed === 'number' && typeof lastProgress.total === 'number'
        && lastProgress.total > 0 && lastProgress.completed >= lastProgress.total) {
        stopCreeping();
        currentPct = 100;
        ceilingPct = 100;
        if (progressBar) {
          progressBar.style.width = '100%';
          progressBar.style.opacity = '1';
        }
        if (labelEl) {
          labelEl.textContent = this.t('audit.completed', {
            label: this.translateAuditLabel(lastProgress.label),
            completed: lastProgress.completed,
            total: lastProgress.total
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (!container.isConnected) return;
      }

      content.innerHTML = html;
      content.querySelectorAll('.copy-command-btn').forEach((btn) => btn.addEventListener('click', async () => {
        const codeEl = content.querySelector(`#${btn.dataset.target}`);
        if (!codeEl) return;
        try {
          await navigator.clipboard.writeText(codeEl.textContent);
          const original = btn.textContent;
          btn.textContent = t('audit.copied');
          setTimeout(() => { btn.textContent = original; }, 1500);
        } catch (err) {
          alert(t('audit.copyError'));
        }
      }));
      self.bindManageButtons(content);
      content.querySelectorAll('.audit-ignore').forEach((btn) => btn.addEventListener('click', async () => {
        const card = btn.closest('.card');
        btn.disabled = true;
        try {
          await window.api.invoke('warnings:ignore', { id: btn.dataset.id, title: btn.dataset.title, detail: btn.dataset.detail });
          if (card) card.remove();
          // Update ignored warnings section immediately without re-running audit
          self.updateIgnoredWarningsSection(container);
        } catch (err) {
          btn.disabled = false;
          alert(err.message || t('audit.ignoreError'));
        }
      }));
      content.querySelectorAll('.audit-restore').forEach((btn) => btn.addEventListener('click', async () => {
        const item = btn.closest('.history-item');
        btn.disabled = true;
        try {
          await window.api.invoke('warnings:unignore', btn.dataset.id);
          if (item) item.remove();
          // Update UI immediately without re-running full audit
          const ignored = await window.api.invoke('warnings:listIgnored');
          const ignoredIds = new Set((ignored || []).map((w) => w.id));
          self._currentTranslatedResults = self._currentTranslatedResults || [];
          const visibleResults = self._currentTranslatedResults.filter((r) => !ignoredIds.has(self.warningId(r)));
          self.renderResults(container, visibleResults);
          self.updateIgnoredWarningsSection(container);
        } catch (err) {
          btn.disabled = false;
          alert(err.message || t('audit.restoreError'));
        }
      }));
    } catch (e) {
      content.innerHTML = `<div class="empty-state">${escapeHtml(t('audit.error', { error: e.message }))}</div>`;
    } finally {
      if (typeof unsubscribeProgress === 'function') unsubscribeProgress();
      setLoadingState(false);
    }
  },

  // Render cached results without loading state
  renderCachedResults(container, translatedResults, ignoredIds) {
    const self = this;
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const content = container.querySelector('#auditContent');
    if (!content) return;

    self._currentTranslatedResults = translatedResults;

    let pass = 0, fail = 0, warn = 0, err = 0;
    const visibleResults = translatedResults.filter((r) => !ignoredIds.has(this.warningId(r)));
    visibleResults.forEach(r => { if (r.status === 'pass') pass++; else if (r.status === 'fail') fail++; else if (r.status === 'warn') warn++; else if (r.status === 'error') err++; });

    let html = `<div class="grid grid-4" style="margin-bottom:18px;">
      <div class="stat-tile"><div class="stat-label">${escapeHtml(this.t('audit.passed'))}</div><div class="stat-value" style="color:var(--ok);">${pass}</div></div>
      <div class="stat-tile"><div class="stat-label">${escapeHtml(this.t('audit.failed'))}</div><div class="stat-value" style="color:var(--danger);">${fail}</div></div>
      <div class="stat-tile"><div class="stat-label">${escapeHtml(this.t('audit.warnings'))}</div><div class="stat-value" style="color:var(--warn);">${warn}</div></div>
      <div class="stat-tile"><div class="stat-label">${escapeHtml(this.t('audit.errors'))}</div><div class="stat-value" style="color:var(--text-dim);">${err}</div></div>
    </div>`;
    html += '<div id="auditResultsContainer" style="max-height:calc(100vh - 260px); overflow-y:auto; padding-right:8px; display:flex; flex-direction:column; gap:12px;">';
    html += `<div class="dashboard-grid">${self.buildResultsGrid(visibleResults)}</div>`;
    html += '</div>';

    // Ignored warnings section
    if ((ignoredIds && ignoredIds.size > 0)) {
      // Note: we don't have the full ignored objects here, just IDs
      // We'll let updateIgnoredWarningsSection handle fetching and rendering
      html += `<div class="panel" style="margin-top:18px;"><div class="panel-title">${escapeHtml(this.t('audit.ignoredWarnings'))}</div>
        <div class="history-list" id="ignoredWarningsList"></div></div>`;
    }

    content.innerHTML = html;

    // Bind event listeners for the rendered content
    content.querySelectorAll('.copy-command-btn').forEach((btn) => btn.addEventListener('click', async () => {
      const codeEl = content.querySelector(`#${btn.dataset.target}`);
      if (!codeEl) return;
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        const original = btn.textContent;
        btn.textContent = t('audit.copied');
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (err) {
        alert(t('audit.copyError'));
      }
    }));
    self.bindManageButtons(content);
    content.querySelectorAll('.audit-ignore').forEach((btn) => btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      btn.disabled = true;
      try {
        await window.api.invoke('warnings:ignore', { id: btn.dataset.id, title: btn.dataset.title, detail: btn.dataset.detail });
        if (card) card.remove();
        self.updateIgnoredWarningsSection(container);
      } catch (err) {
        btn.disabled = false;
        alert(err.message || t('audit.ignoreError'));
      }
    }));

    // Load and render ignored warnings section
    self.updateIgnoredWarningsSection(container);
  },

  // Render audit results into the container (incremental update)
  renderResults(container, visibleResults) {
    const self = this;
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const resultsContainer = container.querySelector('#auditResultsContainer .dashboard-grid');
    if (!resultsContainer) return;

    resultsContainer.innerHTML = self.buildResultsGrid(visibleResults);

    // Re-bind event listeners for newly added buttons
    self.bindManageButtons(resultsContainer);
    resultsContainer.querySelectorAll('.copy-command-btn').forEach((btn) => btn.addEventListener('click', async () => {
      const codeEl = container.querySelector(`#${btn.dataset.target}`);
      if (!codeEl) return;
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        const original = btn.textContent;
        btn.textContent = t('audit.copied');
        setTimeout(() => { btn.textContent = original; }, 1500);
      } catch (err) {
        alert(t('audit.copyError'));
      }
    }));
    resultsContainer.querySelectorAll('.audit-ignore').forEach((btn) => btn.addEventListener('click', async () => {
      const card = btn.closest('.card');
      btn.disabled = true;
      try {
        await window.api.invoke('warnings:ignore', { id: btn.dataset.id, title: btn.dataset.title, detail: btn.dataset.detail });
        if (card) card.remove();
        self.updateIgnoredWarningsSection(container);
      } catch (err) {
        btn.disabled = false;
        alert(err.message || t('audit.ignoreError'));
      }
    }));
  },

  // Update the ignored warnings section at the bottom of the audit page
  updateIgnoredWarningsSection(container) {
    const self = this;
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const content = container.querySelector('#auditContent');
    if (!content) return;

    // Re-fetch ignored warnings and update the section
    window.api.invoke('warnings:listIgnored').then(ignored => {
      const auditIgnored = (ignored || []).filter((w) => String(w.id || '').startsWith('audit:'));
      let ignoredSection = content.querySelector('.panel:has(.history-list)'); // more specific selector

      if (auditIgnored.length > 0) {
        // Create the section if it doesn't exist
        if (!ignoredSection) {
          ignoredSection = document.createElement('div');
          ignoredSection.className = 'panel';
          ignoredSection.style.marginTop = '18px';
          content.appendChild(ignoredSection);
        }
        ignoredSection.innerHTML = `
          <div class="panel-title">${escapeHtml(self.t('audit.ignoredWarnings'))}</div>
          <div class="history-list">${auditIgnored.map((w) => `
            <div class="history-item"><div><div class="history-title">${escapeHtml(w.title)}</div><div class="history-meta">${escapeHtml(w.detail || '')}</div></div>
            <button class="btn btn-sm audit-restore" data-id="${escapeHtml(w.id)}">${escapeHtml(self.t('audit.restore'))}</button></div>`).join('')}
          `;

        // Re-bind restore buttons for the ignored section
        ignoredSection.querySelectorAll('.audit-restore').forEach((btn) => btn.addEventListener('click', async () => {
          const item = btn.closest('.history-item');
          btn.disabled = true;
          try {
            await window.api.invoke('warnings:unignore', btn.dataset.id);
            if (item) item.remove();
            const ignored = await window.api.invoke('warnings:listIgnored');
            const ignoredIds = new Set((ignored || []).map((w) => w.id));
            const visibleResults = self._currentTranslatedResults.filter((r) => !ignoredIds.has(self.warningId(r)));
            self.renderResults(container, visibleResults);
            self.updateIgnoredWarningsSection(container);
          } catch (err) {
            btn.disabled = false;
            alert(err.message || self.t('audit.restoreError'));
          }
        }));
      } else if (ignoredSection) {
        ignoredSection.remove();
      }
    });
  },

  warningId(result) {
    // Prefer the stable id captured from the untranslated backend result
    // (see translateAuditResult) so ignored warnings don't depend on locale.
    if (result._ignoreId) return result._ignoreId;
    return 'audit:' + String(result.name || result.message || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  },

  translateAuditResult(result) {
    // Compute the stable ignore id from the raw, untranslated backend fields
    // BEFORE any translation is applied, so it stays consistent across locales.
    const ignoreId = this.warningId(result);
    const translated = { ...result, _ignoreId: ignoreId };
    const map = this.auditTranslations;

    // Translate name
    if (map[result.name]) {
      translated.name = this.t(map[result.name]);
    }

    // Translate message
    if (map[result.message]) {
      translated.message = this.t(map[result.message]);
    }

    // Translate detail
    if (result.detail && map[result.detail]) {
      translated.detail = this.t(map[result.detail]);
    }

    // Translate recommendation
    if (result.recommendation && map[result.recommendation]) {
      translated.recommendation = this.t(map[result.recommendation]);
    }

    return translated;
  },

  translateAuditLabel(label) {
    const labelMap = {
      'Windows Defender': 'audit.check.defender.name',
      'Defender hardening': 'audit.check.defenderHardening.name',
      'User Account Control (UAC)': 'audit.check.uac.name',
      'Windows Update': 'audit.check.updates.name',
      'BitLocker': 'audit.check.bitlocker.shortName',
      'PowerShell execution policy': 'audit.check.execPolicy.name',
      'Secure Boot': 'audit.check.secureBoot.name',
      'SMBv1': 'audit.check.smb1.name',
      'Automatic Logon': 'audit.check.autoLogon.name',
      'Remote Desktop': 'audit.check.remoteDesktop.name',
      'LSA protection': 'audit.check.lsaProtection.name',
      'Local accounts': 'audit.check.accounts.name'
    };
    if (labelMap[label]) {
      return this.t(labelMap[label]);
    }
    return label;
  },

  // Single result card. Shared by buildResultsGrid so the loaded, cached and
  // incremental render paths all produce identical markup.
  buildResultCard(res) {
    let iconClass = 'info';
    let iconSvg = '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>';
    let statusLabel = this.t('common.info');
    if (res.status === 'pass') { iconClass = 'safe'; iconSvg = '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'; statusLabel = this.t('audit.statusPassed'); }
    else if (res.status === 'fail') { iconClass = 'danger'; iconSvg = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'; statusLabel = this.t('audit.statusFailed'); }
    else if (res.status === 'warn') { iconClass = 'warning'; iconSvg = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/>'; statusLabel = this.t('audit.statusWarning'); }
    else if (res.status === 'error') { iconClass = 'danger'; iconSvg = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'; statusLabel = this.t('audit.statusError'); }
    return `<div class="card" style="display:flex; flex-direction:column; gap:12px;">
      <div style="display:flex; align-items:center; gap:16px;">
        <div class="status-icon ${iconClass}" style="width:40px;height:40px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;">${iconSvg}</svg>
        </div>
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:600; font-size:1.1rem;">${escapeHtml(res.name)}</div>
            <span style="font-size:0.8rem; font-weight:600; text-transform:uppercase; color:${iconClass === 'safe' ? 'var(--ok)' : iconClass === 'danger' ? 'var(--danger)' : 'var(--warn)'};">${statusLabel}</span>
          </div>
          <div class="page-subtitle" style="font-size:0.9rem; margin-top:4px;">${escapeHtml(res.message)}</div>
        </div>
      </div>
      ${res.detail ? `<div style="font-size:0.85rem; color:var(--text-dim); padding:8px; background:var(--bg-surface); border-radius:6px; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; white-space:pre-wrap; word-break:break-word;">${escapeHtml(res.detail)}</div>` : ''}
      ${res.recommendation ? this.renderRecommendation(res.recommendation) : ''}
      ${(res.actionUri || res.manageAction) ? `<button class="btn btn-sm audit-open-settings" data-uri="${escapeHtml(res.actionUri || '')}" data-action="${escapeHtml(res.manageAction || '')}">${escapeHtml(this.t('audit.manage'))}</button>` : ''}
      ${res.status === 'warn' || res.status === 'fail' ? `<button class="btn btn-sm audit-ignore" data-id="${escapeHtml(this.warningId(res))}" data-title="${escapeHtml(res.name)}" data-detail="${escapeHtml(res.message || res.detail || '')}">${escapeHtml(this.t('audit.ignoreWarning'))}</button>` : ''}
    </div>`;
  },

  // Build the whole results grid, grouped under section headers. Results are
  // grouped by their backend `section` key in a fixed order so the layout is
  // stable across locales, cache hits and ignore/restore re-renders.
  buildResultsGrid(results) {
    const groups = {};
    const seen = [];
    for (const res of results) {
      const key = res.section || 'system';
      if (!groups[key]) { groups[key] = []; seen.push(key); }
      groups[key].push(res);
    }
    const ordered = [...this.SECTION_ORDER.filter((k) => groups[k]), ...seen.filter((k) => !this.SECTION_ORDER.includes(k))];
    let html = '';
    for (const key of ordered) {
      html += `<div class="audit-section-title">${escapeHtml(this.t(this.sectionMap[key] || 'audit.section.system'))}</div>`;
      html += groups[key].map((res) => this.buildResultCard(res)).join('');
    }
    return html;
  },

  // Some recommendations are "<plain-English explanation>: <PowerShell command>"
  // (e.g. "Consider setting to RemoteSigned: Set-ExecutionPolicy RemoteSigned
  // -Scope LocalMachine"). Running the command into the sentence makes it read
  // like one long instruction instead of an explanation plus an action. This
  // splits any recommendation ending in a recognizable cmdlet into readable
  // prose plus its own copyable code block.
  renderRecommendation(rec) {
    const match = String(rec).match(/^(.*?):\s*((?:Set|Get|Enable|Disable|Add|Remove|New|Start|Stop|Restart|Install|Uninstall)-[A-Za-z]+\b[\s\S]*)$/);
    if (!match) {
      return `<div style="font-size:0.85rem;"><strong>${escapeHtml(this.t('audit.recommendation', { rec }))}</strong></div>`;
    }
    const prose = match[1].trim();
    const command = match[2].trim();
    const commandId = `cmd-${Math.random().toString(36).slice(2, 9)}`;
    return `
      <div style="font-size:0.85rem;">
        <div><strong>${escapeHtml(this.t('audit.recommendation', { rec: prose }))}</strong></div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:6px; background:var(--bg-surface); border:1px solid var(--glass-border); border-radius:6px; padding:8px 10px;">
          <code id="${commandId}" style="flex:1; font-family:'Cascadia Code','Fira Code',monospace; font-size:0.82rem; white-space:pre-wrap; word-break:break-word; color:var(--text-main);">${escapeHtml(command)}</code>
          <button type="button" class="btn btn-sm copy-command-btn" data-target="${commandId}" style="flex-shrink:0;">${escapeHtml(this.t('audit.copy'))}</button>
        </div>
      </div>`;
  },

  renderMaintenanceHistory(rows) {
    if (!rows || !rows.length) {
      return `<div class="panel" style="margin-top:18px;">
        <div class="panel-title">${escapeHtml(this.t('audit.maintenanceHistory'))}</div>
        <div class="page-subtitle" style="font-size:0.9rem;">${escapeHtml(this.t('audit.noMaintenance'))}</div>
      </div>`;
    }
    const items = rows.map((row) => {
      const when = row.started_at || row.timestamp;
      const whenLabel = when ? new Date(when).toLocaleString() : this.t('common.unknown');
      const mode = row.dry_run ? this.t('audit.dryRun') : this.t('audit.liveRun');
      const detail = (row.results || []).map((r) => `${r.scriptId}: ${r.ok ? this.t('common.ok') : (r.error || this.t('common.failed'))}`).join('; ');
      return `<div class="history-item">
        <div>
          <div class="history-title">${escapeHtml(this.t('audit.maintenanceRun', { ok: row.ok_count || 0, total: row.total_count || 0, mode }))}</div>
          <div class="history-meta">${escapeHtml(whenLabel)}${detail ? ` — ${escapeHtml(detail)}` : ''}</div>
        </div>
      </div>`;
    }).join('');
    return `<div class="panel" style="margin-top:18px;">
      <div class="panel-title">${escapeHtml(this.t('audit.maintenanceHistory'))}</div>
      <div class="history-list">${items}</div>
    </div>`;
  }
};