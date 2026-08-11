/**
 * VPN Add Modal Component
 * Provides a modal for adding a new VPN connection from a provider
 */
(function() {
  'use strict';

  // Modal state
  let modalEl = null;
  let onCloseCallback = null;
  let onSuccessCallback = null;
  let providers = [];
  let currentProvider = null;
  let currentServer = null;

  function createModal() {
    if (modalEl) return modalEl;

    modalEl = document.createElement('div');
    modalEl.className = 'vpn-add-modal-overlay';
    modalEl.innerHTML = `
      <div class="vpn-add-modal" role="dialog" aria-modal="true" aria-labelledby="vpnAddModalTitle">
        <div class="vpn-add-modal-header">
          <h2 id="vpnAddModalTitle" data-i18n="network.vpn.addTitle">Add VPN Connection</h2>
          <button class="vpn-add-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="vpn-add-modal-body">
          <div class="vpn-add-step" data-step="provider">
            <h3 data-i18n="network.vpn.stepProvider">Choose Provider</h3>
            <p data-i18n="network.vpn.stepProviderDesc">Select your VPN provider from the list below.</p>
            <div class="vpn-provider-grid" id="providerGrid"></div>
          </div>

          <div class="vpn-add-step hidden" data-step="server">
            <h3 data-i18n="network.vpn.stepServer">Choose Server</h3>
            <p data-i18n="network.vpn.stepServerDesc">Select a server location for your VPN connection.</p>
            <div id="providerHint" class="vpn-hint hidden"></div>
            <div class="vpn-field">
              <label for="serverSelect" data-i18n="network.vpn.serverLabel">Server</label>
              <select id="serverSelect" class="vpn-select">
                <option value="" disabled selected data-i18n="network.vpn.serverPlaceholder">Select a server&hellip;</option>
              </select>
            </div>
            <div class="vpn-field">
              <label for="customServer" class="hidden" data-i18n="network.vpn.customServerLabel">Custom Server Address</label>
              <input type="text" id="customServer" class="vpn-input hidden" placeholder="vpn.example.com" data-i18n-placeholder="network.vpn.customServerPlaceholder" />
            </div>
          </div>

          <div class="vpn-add-step hidden" data-step="credentials">
            <h3 data-i18n="network.vpn.stepCredentials">Enter Credentials</h3>
            <p data-i18n="network.vpn.stepCredentialsDesc">Enter your VPN username and password. These are passed directly to Windows and not stored by Soterios.</p>
            <div class="vpn-field">
              <label for="vpnUsername" data-i18n="network.vpn.usernameLabel">Username</label>
              <input type="text" id="vpnUsername" class="vpn-input" placeholder="" data-i18n-placeholder="network.vpn.usernamePlaceholder" autocomplete="username" />
            </div>
            <div class="vpn-field">
              <label for="vpnPassword" data-i18n="network.vpn.passwordLabel">Password</label>
              <input type="password" id="vpnPassword" class="vpn-input" placeholder="" data-i18n-placeholder="network.vpn.passwordPlaceholder" autocomplete="current-password" />
            </div>
          </div>

          <div class="vpn-add-step hidden" data-step="creating">
            <div class="vpn-spinner"></div>
            <p id="creatingText" data-i18n="network.vpn.creatingProfile">Creating VPN profile&hellip;</p>
          </div>

          <div class="vpn-add-step hidden" data-step="success">
            <div class="vpn-success-icon">&#10003;</div>
            <h3 data-i18n="network.vpn.profileCreated">VPN Profile Created</h3>
            <p id="successMessage"></p>
            <p class="vpn-hint" data-i18n="network.vpn.profileCreatedHint">You can now connect from the Network page or the tray menu.</p>
          </div>

          <div class="vpn-add-step hidden" data-step="error">
            <div class="vpn-error-icon">&#10007;</div>
            <h3 data-i18n="network.vpn.profileFailed">Failed to Create Profile</h3>
            <p id="errorMessage" style="color: var(--danger);"></p>
          </div>
        </div>
        <div class="vpn-add-modal-footer">
          <button class="vpn-btn vpn-btn-secondary vpn-btn-back hidden" data-i18n="common.back">Back</button>
          <button class="vpn-btn vpn-btn-primary vpn-btn-next" data-i18n="common.next">Next</button>
          <button class="vpn-btn vpn-btn-primary vpn-btn-create hidden" data-i18n="network.vpn.createProfile">Create Profile</button>
          <button class="vpn-btn vpn-btn-secondary vpn-btn-close hidden" data-i18n="common.close">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);

    // Bind events
    modalEl.querySelector('.vpn-add-modal-close').onclick = () => close();
    modalEl.querySelector('.vpn-btn-back').onclick = () => goBack();
    modalEl.querySelector('.vpn-btn-next').onclick = () => goNext();
    modalEl.querySelector('.vpn-btn-create').onclick = () => createProfile();
    modalEl.querySelector('.vpn-btn-close').onclick = () => close();

    // Close on overlay click
    modalEl.onclick = (e) => {
      if (e.target === modalEl) close();
    };

    // Server select change
    modalEl.querySelector('#serverSelect').onchange = (e) => {
      const customServerInput = modalEl.querySelector('#customServer');
      if (e.target.value === '__custom__') {
        customServerInput.classList.remove('hidden');
        customServerInput.focus();
      } else {
        customServerInput.classList.add('hidden');
      }
    };

    return modalEl;
  }

  function translateModal() {
    if (!modalEl) return;
    const t = window.I18n?.t.bind(window.I18n) ?? ((key) => key);
    modalEl.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (el.tagName === 'INPUT' && el.getAttribute('data-i18n-placeholder')) {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
      } else {
        el.textContent = t(key);
      }
    });
  }

  function showStep(step) {
    if (!modalEl) return;
    modalEl.querySelectorAll('.vpn-add-step').forEach(el => el.classList.add('hidden'));
    const stepEl = modalEl.querySelector(`.vpn-add-step[data-step="${step}"]`);
    if (stepEl) stepEl.classList.remove('hidden');

    const backBtn = modalEl.querySelector('.vpn-btn-back');
    const nextBtn = modalEl.querySelector('.vpn-btn-next');
    const createBtn = modalEl.querySelector('.vpn-btn-create');
    const closeBtn = modalEl.querySelector('.vpn-btn-close');

    backBtn.classList.add('hidden');
    nextBtn.classList.add('hidden');
    createBtn.classList.add('hidden');
    closeBtn.classList.add('hidden');

    if (step === 'provider') {
      nextBtn.classList.remove('hidden');
    } else if (step === 'server') {
      backBtn.classList.remove('hidden');
      nextBtn.classList.remove('hidden');
    } else if (step === 'credentials') {
      backBtn.classList.remove('hidden');
      createBtn.classList.remove('hidden');
    } else if (step === 'creating') {
      // No buttons
    } else if (step === 'success') {
      closeBtn.classList.remove('hidden');
    } else if (step === 'error') {
      closeBtn.classList.remove('hidden');
    }
  }

   async function loadProviders() {
     try {
       const result = await window.api.invoke('network:vpn:getProviders');
       if (result && Array.isArray(result)) {
         providers = result;
         renderProviders();
       }
     } catch (err) {
       console.error('Failed to load VPN providers:', err);
     }
   }

   function openWindowsVpnSettings() {
     window.api.invoke('shell:openExternal', 'ms-settings:network-vpn');
   }

   function renderProviders() {
     const grid = modalEl.querySelector('#providerGrid');
     if (!grid) return;

     const providerButtons = providers.map(p => `
       <button class="vpn-provider-card" data-provider="${p.id}" tabindex="0">
         <span class="vpn-provider-name">${p.name}</span>
         <span class="vpn-provider-protocol">${p.protocol}</span>
       </button>
     `).join('');

     grid.innerHTML = providerButtons + `
       <button class="vpn-provider-card vpn-provider-settings" data-action="open-windows-settings" tabindex="0">
         <span class="vpn-provider-name" data-i18n="network.vpn.openWindowsSettings">Windows Settings</span>
         <span class="vpn-provider-protocol">VPN</span>
       </button>
     `;

     grid.querySelectorAll('.vpn-provider-card[data-provider]').forEach(btn => {
       btn.onclick = () => selectProvider(btn.getAttribute('data-provider'));
       btn.onkeydown = (e) => {
         if (e.key === 'Enter' || e.key === ' ') selectProvider(btn.getAttribute('data-provider'));
       };
     });

     const settingsBtn = grid.querySelector('.vpn-provider-card[data-action="open-windows-settings"]');
     if (settingsBtn) {
       settingsBtn.onclick = openWindowsVpnSettings;
       settingsBtn.onkeydown = (e) => {
         if (e.key === 'Enter' || e.key === ' ') openWindowsVpnSettings();
       };
     }
   }

  async function selectProvider(providerId) {
    currentProvider = providers.find(p => p.id === providerId);
    if (!currentProvider) return;

    const serverSelect = modalEl.querySelector('#serverSelect');
    const customServerInput = modalEl.querySelector('#customServer');
    const providerHint = modalEl.querySelector('#providerHint');

    if (currentProvider.servers && currentProvider.servers.length > 0) {
      // Predefined servers
      serverSelect.innerHTML = '<option value="" disabled selected data-i18n="network.vpn.serverPlaceholder">Select a server&hellip;</option>' +
        currentProvider.servers.map(s => `<option value="${s.id}">${s.name}</option>`).join('') +
        '<option value="__custom__" data-i18n="network.vpn.customServerOption">Custom server&hellip;</option>';
      customServerInput.classList.add('hidden');
      providerHint.classList.add('hidden');
    } else {
      // Custom only — helper text tells the user where to find a hostname
      serverSelect.innerHTML = '<option value="__custom__" selected data-i18n="network.vpn.customServerOption">Custom server&hellip;</option>';
      customServerInput.classList.remove('hidden');
      if (currentProvider.id !== 'custom') {
        providerHint.textContent = (window.I18n?.t('network.vpn.builtInServerHint') || 'Soterios no longer ships built-in server lists for {provider} because their hostnames change often and stale entries fail to connect. Paste an IKEv2 server hostname from your {provider} account/setup page instead.')
          .replaceAll('{provider}', currentProvider.name);
        providerHint.classList.remove('hidden');
      } else {
        providerHint.classList.add('hidden');
      }
      customServerInput.focus();
    }

    showStep('server');
    translateModal();
  }

  async function loadServersForProvider(providerId) {
    if (providerId === 'custom') return;
    try {
      const servers = await window.api.invoke('network:vpn:getServers', providerId);
      // Servers are already in provider object
    } catch (_) {}
  }

  function goNext() {
    const activeStep = modalEl.querySelector('.vpn-add-step:not(.hidden)');
    if (!activeStep) return;
    const step = activeStep.getAttribute('data-step');

    if (step === 'provider') {
      if (!currentProvider) {
        alert(window.I18n?.t('network.vpn.selectProviderFirst') || 'Please select a provider first');
        return;
      }
      showStep('server');
    } else if (step === 'server') {
      const serverSelect = modalEl.querySelector('#serverSelect');
      const customServerInput = modalEl.querySelector('#customServer');
      let serverId = serverSelect.value;

      if (serverId === '__custom__') {
        const customHost = customServerInput.value.trim();
        if (!customHost) {
          alert(window.I18n?.t('network.vpn.enterCustomServer') || 'Please enter a custom server address');
          customServerInput.focus();
          return;
        }
        currentServer = { id: customHost, name: customHost, host: customHost, custom: true };
      } else if (serverId) {
        currentServer = currentProvider.servers.find(s => s.id === serverId);
        if (!currentServer) return;
      } else {
        alert(window.I18n?.t('network.vpn.selectServerFirst') || 'Please select a server first');
        return;
      }
      showStep('credentials');
      // Focus username field
      setTimeout(() => {
        modalEl.querySelector('#vpnUsername').focus();
      }, 100);
    }
  }

  function goBack() {
    const activeStep = modalEl.querySelector('.vpn-add-step:not(.hidden)');
    if (!activeStep) return;
    const step = activeStep.getAttribute('data-step');

    if (step === 'server') {
      showStep('provider');
    } else if (step === 'credentials') {
      showStep('server');
    }
  }

  async function createProfile() {
    const username = modalEl.querySelector('#vpnUsername').value.trim();
    const password = modalEl.querySelector('#vpnPassword').value;

    if (!username) {
      alert(window.I18n?.t('network.vpn.enterUsername') || 'Please enter your username');
      modalEl.querySelector('#vpnUsername').focus();
      return;
    }
    if (!password) {
      alert(window.I18n?.t('network.vpn.enterPassword') || 'Please enter your password');
      modalEl.querySelector('#vpnPassword').focus();
      return;
    }
    if (!currentServer) {
      alert(window.I18n?.t('network.vpn.selectServerFirst') || 'Please select a server first');
      return;
    }

    showStep('creating');

    try {
      const result = await window.api.invoke('network:vpn:add', {
        providerId: currentProvider.id,
        serverId: currentServer.id,
        username,
        password
      });

      if (result.ok) {
        modalEl.querySelector('#successMessage').textContent =
          (window.I18n?.t('network.vpn.profileCreatedMsg') || 'VPN profile "{name}" has been created.').replace('{name}', result.profileName);
        showStep('success');
        if (onSuccessCallback) onSuccessCallback(result);
      } else {
        modalEl.querySelector('#errorMessage').textContent = result.error || (window.I18n?.t('network.vpn.createFailed') || 'Failed to create VPN profile');
        showStep('error');
      }
    } catch (err) {
      modalEl.querySelector('#errorMessage').textContent = err.message || (window.I18n?.t('network.vpn.createError') || 'An error occurred');
      showStep('error');
    }
  }

  function open(options = {}) {
    console.log('[VpnAddModal] open() called', options);
    onCloseCallback = options.onClose || null;
    onSuccessCallback = options.onSuccess || null;
    currentProvider = null;
    currentServer = null;

    createModal();
    console.log('[VpnAddModal] modalEl created:', modalEl);
    translateModal();
    showStep('provider');
    loadProviders();

    modalEl.classList.add('visible');
    document.body.style.overflow = 'hidden';
    console.log('[VpnAddModal] modal visible, classes:', modalEl.className);
  }

  function close() {
    if (!modalEl) return;
    modalEl.classList.remove('visible');
    document.body.style.overflow = '';
    if (onCloseCallback) onCloseCallback();
    onCloseCallback = null;
    onSuccessCallback = null;
    currentProvider = null;
    currentServer = null;
  }

  // Expose globally
  window.VpnAddModal = { open, close };
})();