// Each page module (src/ui/js/pages/*.js) registers itself on window.Pages
// with a render(container) function. The router just swaps the mounted page
// and toggles the active sidebar item.

(function () {
  const mainContent = document.getElementById('mainContent');
  const navItems = document.querySelectorAll('.nav-item[data-page]');

  let currentPage = null;

  function navigate(pageId) {
    const pageModule = window.Pages && window.Pages[pageId];
    if (!pageModule) {
      mainContent.innerHTML = `<div class="empty-state">Unknown page: ${pageId}</div>`;
      return;
    }

    navItems.forEach((item) => {
      item.classList.toggle('active', item.dataset.page === pageId);
    });

    currentPage = pageId;
    mainContent.innerHTML = '';
    pageModule.render(mainContent);
  }

  navItems.forEach((item) => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Expose for pages that want to deep-link (e.g. "Run a scan" button on dashboard)
  window.AppRouter = { navigate, current: () => currentPage };

  // Initial route
  navigate('dashboard');
})();
