(async function () {
  const mainContent = document.getElementById('mainContent');
  const navItems = document.querySelectorAll('.nav-item[data-page]');
  let currentPage = null;
  let currentContainer = null;

  function showUnknownPage(pageId) {
    mainContent.replaceChildren();
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.textContent = `Unknown page: ${pageId}`;
    mainContent.appendChild(el);
  }

  function isKnownPage(pageId) {
    return !!(pageId && window.Pages && window.Pages[pageId]);
  }

  function navigate(pageId) {
    const pageModule = isKnownPage(pageId) ? window.Pages[pageId] : null;
    if (!pageModule) { showUnknownPage(pageId); return; }

    // If showing the already-visible page, just return.
    if (currentContainer && currentPage === pageId) return;

    // Clean up previous page container (destroy event listeners)
    if (currentContainer) {
      try { window.Pages[currentPage]?.destroy?.(); } catch (_) {}
    }

    // Update navigation indicators
    navItems.forEach((item) => { item.classList.toggle('active', item.dataset.page === pageId); });

    currentPage = pageId;

    // Render new page into a fresh container
    const newContainer = document.createElement('div');
    newContainer.style.cssText = 'width:100%; display:block;';
    mainContent.innerHTML = '';
    mainContent.appendChild(newContainer);
    currentContainer = newContainer;
    pageModule.render(newContainer);

    // Re-translate UI after page render
    if (window.I18n && window.I18n.translateUI) {
      window.I18n.translateUI();
    }
  }

  navItems.forEach((item) => { item.addEventListener('click', () => navigate(item.dataset.page)); });
  window.AppRouter = { navigate, current: () => currentPage };
  if (window.Api) {
    await window.Api.initializeTheme();
    await window.Api.initializeLanguage();
    
    // Show/hide lockdown nav based on feature flag
    try {
      const settings = await window.Api.getSettings();
      const lockdownNav = document.getElementById('lockdownNav');
      if (lockdownNav) {
        lockdownNav.style.display = settings.features?.emergencyLockdown ? 'flex' : 'none';
      }
      const aiNav = document.getElementById('aiNav');
      if (aiNav) {
        aiNav.style.display = settings.features?.aiAssistant !== false ? 'flex' : 'none';
      }
    } catch (_) {
      const lockdownNav = document.getElementById('lockdownNav');
      if (lockdownNav) {
        lockdownNav.style.display = 'none';
      }
      const aiNav = document.getElementById('aiNav');
      if (aiNav) {
        aiNav.style.display = 'flex';
      }
    }
  }
  const hashPage = (window.location.hash || '').replace(/^#/, '');
  let initialPage = isKnownPage(hashPage) ? hashPage : 'dashboard';
  // First-run setup wizard: only gate when there is no explicit hash, so
  // screenshot/capture modes (--screenshot-page=...) keep working.
  if (!hashPage) {
    try {
      const setupComplete = await window.api.invoke('db:getSetting', 'app.setupComplete', false);
      if (!setupComplete) initialPage = 'setup';
    } catch (_) {}
  }
  navigate(initialPage);

  // Listen for toast click to navigate to scanner
  if (window.api) {
    window.api.on('navigate-to-scanner', () => {
      navigate('scanner');
    });
  }
})();
