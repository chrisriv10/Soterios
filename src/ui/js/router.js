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

  navItems.forEach((item) => { 
    item.addEventListener('click', (e) => {
      if (item.dataset.page === 'lockdown') {
        e.preventDefault();
        showLockdownClickAlert(e);
      }
      navigate(item.dataset.page);
    }); 
  });

  function showLockdownClickAlert(e) {
    const alert = document.createElement('div');
    alert.style.cssText = `
      position: fixed;
      left: ${e.clientX + 10}px;
      top: ${e.clientY + 10}px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      z-index: 10000;
      font-size: 13px;
      color: var(--text-main);
      max-width: 280px;
      animation: fadeIn 0.15s ease-out;
    `;
    alert.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px;display:flex;align-items:center;gap:8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M12 17v2"/><path d="M12 11v2"/></svg>
        <span>Emergency Lockdown</span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Click to activate emergency lockdown mode</div>
    `;
    document.body.appendChild(alert);

    setTimeout(() => {
      alert.style.opacity = '0';
      alert.style.transform = 'translateY(-4px)';
      alert.style.transition = 'opacity 0.2s, transform 0.2s';
      setTimeout(() => alert.remove(), 200);
    }, 3000);
  }
  window.AppRouter = { navigate, current: () => currentPage };
  if (window.Api) {
    await window.Api.initializeTheme();
    await window.Api.initializeLanguage();
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
