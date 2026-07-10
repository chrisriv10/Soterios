(async function () {
  const mainContent = document.getElementById('mainContent');
  const navItems = document.querySelectorAll('.nav-item[data-page]');
  let currentPage = null;

  function navigate(pageId) {
    const pageModule = window.Pages && window.Pages[pageId];
    if (!pageModule) { mainContent.innerHTML = `<div class="empty-state">Unknown page: ${pageId}</div>`; return; }
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
  }

  navItems.forEach((item) => { item.addEventListener('click', () => navigate(item.dataset.page)); });
  window.AppRouter = { navigate, current: () => currentPage };
  if (window.Api) {
    await window.Api.initializeTheme();
  }
  navigate('dashboard');

  // Listen for toast click to navigate to scanner
  if (window.api) {
    window.api.on('navigate-to-scanner', () => {
      navigate('scanner');
    });
  }
})();
