function confirmAction(message) {
  return window.confirm(message);
}

window.Pages = window.Pages || {};
window.Pages['quarantine'] = {
  async render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">${escapeHtml(t('quarantine.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('quarantine.subtitle'))}</p>
      </header>
      <div class="card">
        <div id="quarantineActions" style="display:flex; justify-content:flex-end; gap:8px; margin-bottom:12px;"></div>
        <div id="quarantineList" style="display:flex; flex-direction:column; gap:16px;">
          Loading...
        </div>
      </div>
    `;

    try {
      const qList = await window.api.invoke('db:getQuarantineList');
      const listContainer = document.getElementById('quarantineList');
      const actionsContainer = document.getElementById('quarantineActions');

      if (!qList || qList.length === 0) {
        actionsContainer.innerHTML = '';
        listContainer.innerHTML = `<div class="empty-state">${escapeHtml(t('quarantine.empty'))}</div>`;
        return;
      }

      actionsContainer.innerHTML = `
        <button class="btn" id="restoreAllBtn">${escapeHtml(t('quarantine.restoreAll'))}</button>
        <button class="btn" style="color: var(--accent-danger);" id="deleteAllBtn">${escapeHtml(t('quarantine.deleteAll'))}</button>
      `;

      listContainer.innerHTML = '';
      qList.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px solid var(--glass-border);";
        itemEl.innerHTML = `
          <div>
            <div style="font-weight: 500;">${escapeHtml(item.threat_name)}</div>
            <div class="page-subtitle" style="font-size: 0.8rem; margin-top: 4px;">${escapeHtml(item.original_path)}</div>
            <div class="page-subtitle" style="font-size: 0.75rem;">${item.date_quarantined} | ${item.engine}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn" data-restore="${item.id}">${escapeHtml(t('quarantine.restore'))}</button>
            <button class="btn" style="color: var(--accent-danger);" data-delete="${item.id}">${escapeHtml(t('quarantine.delete'))}</button>
          </div>
        `;
        listContainer.appendChild(itemEl);
      });

      // Attach event listeners to individual restore buttons
      listContainer.querySelectorAll('[data-restore]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirmAction(t('quarantine.confirmRestore'))) return;
          try {
            const id = Number(btn.dataset.restore);
            const res = await window.api.invoke('quarantine:restore', id);
            if (res.success) this.render(container);
            else alert(t('quarantine.failedRestore', { error: res.error }));
          } catch (e) { alert(e.message || String(e)); }
        });
      });

      // Attach event listeners to individual delete buttons
      listContainer.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirmAction(t('quarantine.confirmDelete'))) return;
          try {
            const id = Number(btn.dataset.delete);
            const res = await window.api.invoke('quarantine:delete', id);
            if (res.success) this.render(container);
            else alert(t('quarantine.failedDelete', { error: res.error }));
          } catch (e) { alert(e.message || String(e)); }
        });
      });

      // Restore All
      const restoreAllBtn = actionsContainer.querySelector('#restoreAllBtn');
      if (restoreAllBtn) {
        restoreAllBtn.addEventListener('click', async () => {
          if (!confirmAction(t('quarantine.confirmRestoreAll', { count: qList.length }))) return;
          restoreAllBtn.disabled = true;
          const deleteAllBtnRef = actionsContainer.querySelector('#deleteAllBtn');
          if (deleteAllBtnRef) deleteAllBtnRef.disabled = true;
          restoreAllBtn.textContent = t('scanner.statusScanning');
          const failures = [];
          for (const item of qList) {
            try {
              const res = await window.api.invoke('quarantine:restore', item.id);
              if (!res.success) failures.push(`${item.threat_name}: ${res.error}`);
            } catch (e) {
              failures.push(`${item.threat_name}: ${e.message || String(e)}`);
            }
          }
          if (failures.length) alert(t('quarantine.someFailed', { failures: failures.join('\n') }));
          this.render(container);
        });
      }

      // Delete All
      const deleteAllBtn = actionsContainer.querySelector('#deleteAllBtn');
      if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async () => {
          if (!confirmAction(t('quarantine.confirmDeleteAll', { count: qList.length }))) return;
          deleteAllBtn.disabled = true;
          const restoreAllBtnRef = actionsContainer.querySelector('#restoreAllBtn');
          if (restoreAllBtnRef) restoreAllBtnRef.disabled = true;
          deleteAllBtn.textContent = t('scanner.statusScanning');
          const failures = [];
          for (const item of qList) {
            try {
              const res = await window.api.invoke('quarantine:delete', item.id);
              if (!res.success) failures.push(`${item.threat_name}: ${res.error}`);
            } catch (e) {
              failures.push(`${item.threat_name}: ${e.message || String(e)}`);
            }
          }
          if (failures.length) alert(t('quarantine.someFailed', { failures: failures.join('\n') }));
          this.render(container);
        });
      }
    } catch (e) {
      document.getElementById('quarantineList').innerHTML = `<div class="empty-state">${escapeHtml(t('quarantine.failedLoad', { error: e.message }))}</div>`;
    }
  }
};