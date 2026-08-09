(async function () {
  const mainContent = document.getElementById('mainContent');
  const navItems = document.querySelectorAll('.nav-item[data-page]');
  let currentPage = null;

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
    if (currentPage && currentPage !== pageId) {
      const prev = window.Pages[currentPage];
      if (prev && typeof prev.destroy === 'function') {
        try { prev.destroy(); } catch (_) {}
      }
    }
    navItems.forEach((item) => { item.classList.toggle('active', item.dataset.page === pageId); });
    currentPage = pageId;
    mainContent.innerHTML = '';
    pageModule.render(mainContent);
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
      // If settings fail to load, keep lockdown hidden by default
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
  const initialPage = isKnownPage(hashPage) ? hashPage : 'dashboard';
  navigate(initialPage);

  // Listen for toast click to navigate to scanner
  if (window.api) {
    window.api.on('navigate-to-scanner', () => {
      navigate('scanner');
    });
  }
})();
