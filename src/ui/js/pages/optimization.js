'use strict';

window.Pages = window.Pages || {};

window.Pages.optimization = {
  async render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const order = ['balanced', 'gaming', 'quiet'];
    const modeInfo = {
      balanced: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>', noteKey: 'settings.performanceMode.noteBalanced', tipKey: 'settings.performanceMode.tipBalanced' },
      gaming: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>', noteKey: 'settings.performanceMode.noteGaming', tipKey: 'settings.performanceMode.tipGaming' },
      quiet: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>', noteKey: 'settings.performanceMode.noteQuiet', tipKey: 'settings.performanceMode.tipQuiet' }
    };
    container.innerHTML = `<section class="optimization-page">
      <header class="page-header"><h1 class="page-title">${escapeHtml(t('settings.performanceMode.title'))}</h1><div class="page-subtitle">${escapeHtml(t('settings.performanceMode.desc'))}</div></header>
      <div class="card optimization-status-card"><div><div class="panel-title">${escapeHtml(t('settings.performanceMode.currentPlan'))}</div><div id="optimizationCurrent" class="optimization-current">${escapeHtml(t('common.loading'))}</div><p id="optimizationStatus" class="page-subtitle"></p></div></div>
      <div class="optimization-grid" id="optimizationGrid"><div class="empty-state">${escapeHtml(t('common.loading'))}</div></div>
      <div class="card optimization-tips"><div class="panel-title">${escapeHtml(t('settings.performanceMode.tipsTitle'))}</div><p>${escapeHtml(t('settings.performanceMode.tipsIntro'))}</p><ul>${['balanced', 'gaming', 'quiet'].map((id) => `<li>${escapeHtml(t(`settings.performanceMode.tip${id.charAt(0).toUpperCase() + id.slice(1)}`, { mode: t(`settings.performanceMode.${id}.name`) }))}</li>`).join('')}</ul></div>
    </section>`;
    const grid = container.querySelector('#optimizationGrid');
    const current = container.querySelector('#optimizationCurrent');
    const status = container.querySelector('#optimizationStatus');
    let active = null;
    let busy = null;

    const renderCards = () => {
      grid.innerHTML = order.map((id) => {
        const isActive = id === active;
        const info = modeInfo[id];
        const name = t(`settings.performanceMode.${id}.name`);
        const desc = t(`settings.performanceMode.${id}.desc`);
        return `<article class="card optimization-card ${isActive ? 'active' : ''}"><div class="optimization-icon">${info.icon}</div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(desc)}</p><small>${escapeHtml(t(info.noteKey))}</small><button class="btn btn-sm ${isActive ? '' : 'btn-primary'}" data-optimization-mode="${id}" ${isActive || busy ? 'disabled' : ''}>${escapeHtml(busy === id ? t('settings.performanceMode.applying') : isActive ? t('settings.performanceMode.active') : t('settings.performanceMode.apply'))}</button></article>`;
      }).join('');
    };
    const load = async () => {
      try {
        const result = await window.api.invoke('performance:getMode');
        if (!result?.ok) throw new Error(result?.error || t('settings.performanceMode.loadError'));
        active = result.modeId || null;
        current.textContent = active ? t(`settings.performanceMode.${active}.name`) : t('settings.performanceMode.unknown');
        status.textContent = '';
        renderCards();
      } catch (error) {
        current.textContent = t('settings.performanceMode.unknown');
        status.textContent = error.message || t('settings.performanceMode.loadError');
        grid.innerHTML = `<div class="empty-state">${escapeHtml(t('settings.performanceMode.loadError'))}</div>`;
      }
    };
    grid.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-optimization-mode]');
      if (!button || busy) return;
      busy = button.dataset.optimizationMode;
      renderCards();
      try {
        const result = await window.api.invoke('performance:setMode', busy);
        if (!result?.ok) throw new Error(result?.error || t('settings.performanceMode.loadError'));
        active = busy;
        status.textContent = t('settings.performanceMode.applied', { mode: t(`settings.performanceMode.${active}.name`) });
        if (showToast) showToast(t('settings.performanceMode.applied', { mode: t(`settings.performanceMode.${active}.name`) }), 'success');
      } catch (error) {
        status.textContent = error.message || t('settings.performanceMode.error', { error: '' });
      } finally {
        busy = null;
        renderCards();
        current.textContent = active ? t(`settings.performanceMode.${active}.name`) : t('settings.performanceMode.unknown');
      }
    });
    await load();
  }
};
