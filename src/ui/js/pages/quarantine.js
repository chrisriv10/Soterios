function confirmAction(message) {
  return window.confirm(message);
}

window.Pages = window.Pages || {};
window.Pages['quarantine'] = {
  async render(container) {
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">Quarantine</h1>
        <p class="page-subtitle">Isolated files that were detected as threats.</p>
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
        listContainer.innerHTML = '<div class="empty-state">No items in quarantine.</div>';
        return;
      }

      actionsContainer.innerHTML = `
        <button class="btn" id="restoreAllBtn">Restore All</button>
        <button class="btn" style="color: var(--accent-danger);" id="deleteAllBtn">Delete All</button>
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
            <button class="btn" data-restore="${item.id}">Restore</button>
            <button class="btn" style="color: var(--accent-danger);" data-delete="${item.id}">Delete</button>
          </div>
        `;
        listContainer.appendChild(itemEl);
      });

      // Attach event listeners to individual restore buttons
      listContainer.querySelectorAll('[data-restore]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirmAction('Restore this file to its original location?')) return;
          try {
            const id = Number(btn.dataset.restore);
            const res = await window.api.invoke('quarantine:restore', id);
            if (res.success) this.render(container);
            else alert('Failed to restore: ' + res.error);
          } catch (e) { alert(e.message || String(e)); }
        });
      });

      // Attach event listeners to individual delete buttons
      listContainer.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirmAction('Permanently delete this quarantined file? This cannot be undone.')) return;
          try {
            const id = Number(btn.dataset.delete);
            const res = await window.api.invoke('quarantine:delete', id);
            if (res.success) this.render(container);
            else alert('Failed to delete: ' + res.error);
          } catch (e) { alert(e.message || String(e)); }
        });
      });

      // Restore All
      const restoreAllBtn = actionsContainer.querySelector('#restoreAllBtn');
      if (restoreAllBtn) {
        restoreAllBtn.addEventListener('click', async () => {
          if (!confirmAction(`Restore all ${qList.length} quarantined file(s) to their original locations?`)) return;
          restoreAllBtn.disabled = true;
          const deleteAllBtnRef = actionsContainer.querySelector('#deleteAllBtn');
          if (deleteAllBtnRef) deleteAllBtnRef.disabled = true;
          restoreAllBtn.textContent = 'Restoring...';
          const failures = [];
          for (const item of qList) {
            try {
              const res = await window.api.invoke('quarantine:restore', item.id);
              if (!res.success) failures.push(`${item.threat_name}: ${res.error}`);
            } catch (e) {
              failures.push(`${item.threat_name}: ${e.message || String(e)}`);
            }
          }
          if (failures.length) alert('Some items failed to restore:\n' + failures.join('\n'));
          this.render(container);
        });
      }

      // Delete All
      const deleteAllBtn = actionsContainer.querySelector('#deleteAllBtn');
      if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async () => {
          if (!confirmAction(`Permanently delete all ${qList.length} quarantined file(s)? This cannot be undone.`)) return;
          deleteAllBtn.disabled = true;
          const restoreAllBtnRef = actionsContainer.querySelector('#restoreAllBtn');
          if (restoreAllBtnRef) restoreAllBtnRef.disabled = true;
          deleteAllBtn.textContent = 'Deleting...';
          const failures = [];
          for (const item of qList) {
            try {
              const res = await window.api.invoke('quarantine:delete', item.id);
              if (!res.success) failures.push(`${item.threat_name}: ${res.error}`);
            } catch (e) {
              failures.push(`${item.threat_name}: ${e.message || String(e)}`);
            }
          }
          if (failures.length) alert('Some items failed to delete:\n' + failures.join('\n'));
          this.render(container);
        });
      }
    } catch (e) {
      document.getElementById('quarantineList').innerHTML = `<div class="empty-state">Failed to load quarantine: ${e.message}</div>`;
    }
  }
};