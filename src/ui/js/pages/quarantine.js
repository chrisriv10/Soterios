function confirmAction(message) {
  return window.confirm(message);
}

async function copyText(value) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (_) {
      return false;
    }
  }
}

window.Pages = window.Pages || {};
window.Pages['quarantine'] = {
  _tab: 'quarantined',
  _search: '',
  _engine: 'all',
  _sort: 'date-desc',
  _selected: new Set(),
  _expanded: new Set(),

  async render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    this._container = container;
    container.innerHTML = `
      <header class="page-header">
        <h1 class="page-title">${escapeHtml(t('quarantine.title'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('quarantine.subtitle'))}</p>
      </header>

      <div class="q-tabs" style="display:flex; gap:8px; margin-bottom:12px;">
        <button class="btn btn-sm q-tab" data-tab="quarantined">${escapeHtml(t('quarantine.tab.quarantined'))}</button>
        <button class="btn btn-sm q-tab" data-tab="history">${escapeHtml(t('quarantine.tab.history'))}</button>
        <button class="btn btn-sm q-tab" data-tab="trusted">${escapeHtml(t('quarantine.tab.trusted'))}</button>
      </div>

      <div class="card">
        <div id="qToolbar" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px;"></div>
        <div id="quarantineList" style="display:flex; flex-direction:column; gap:8px;">
          ${escapeHtml(t('common.loading'))}
        </div>
      </div>
    `;

    this._bindTabButtons(container);

    try {
      const all = await window.api.invoke('quarantine:list');
      const trusted = await window.api.invoke('quarantine:getTrusted');
      let list = (all && Array.isArray(all) ? all : []).slice();

      const engines = [...new Set(list.map((i) => i.engine).filter(Boolean))].sort();
      const activeCount = list.filter((i) => i.status === 'quarantined').length;
      const trustedCount = (trusted && Array.isArray(trusted) ? trusted : []).length;

      this._renderToolbar(container, { engines, activeCount, trustedCount });
      this._renderList(container, { list, trusted });
    } catch (e) {
      document.getElementById('quarantineList').innerHTML =
        `<div class="empty-state">${escapeHtml(t('quarantine.failedLoad', { error: e.message }))}</div>`;
    }
  },

  _byTab(list) {
    if (this._tab === 'history') return list.filter((i) => i.status !== 'quarantined');
    return list.filter((i) => i.status === 'quarantined');
  },

  _renderToolbar(container, { engines, activeCount, trustedCount }) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const toolbar = container.querySelector('#qToolbar');
    if (!toolbar) return;
    this._updateDisabled = null;

    if (this._tab === 'trusted') {
      toolbar.innerHTML = `
        <span style="font-size:0.85rem; color:var(--text-muted,rgba(255,255,255,0.6));">${escapeHtml(t('quarantine.trustedSummary', { count: trustedCount }))}</span>
      `;
      return;
    }

    if (this._tab === 'quarantined') {
      toolbar.innerHTML = `
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" id="qSelectAll" />
          <span>${escapeHtml(t('quarantine.selectAll'))}</span>
        </label>
        <input type="text" id="qSearch" class="q-search" placeholder="${escapeHtml(t('quarantine.searchPlaceholder'))}"
          value="${escapeHtml(this._search)}">
        <select id="qEngine" class="q-select">
          <option value="all">${escapeHtml(t('quarantine.filterAllEngines'))}</option>
          ${engines.map((e) => `<option value="${escapeHtml(e)}" ${this._engine === e ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}
        </select>
        <select id="qSort" class="q-select">
          <option value="date-desc" ${this._sort === 'date-desc' ? 'selected' : ''}>${escapeHtml(t('quarantine.sortDateDesc'))}</option>
          <option value="date-asc" ${this._sort === 'date-asc' ? 'selected' : ''}>${escapeHtml(t('quarantine.sortDateAsc'))}</option>
          <option value="name-asc" ${this._sort === 'name-asc' ? 'selected' : ''}>${escapeHtml(t('quarantine.sortName'))}</option>
          <option value="path-asc" ${this._sort === 'path-asc' ? 'selected' : ''}>${escapeHtml(t('quarantine.sortPath'))}</option>
        </select>
        <div id="qBulkActions" style="display:flex; gap:8px;"></div>
      `;

      const searchInput = toolbar.querySelector('#qSearch');
      searchInput.addEventListener('input', () => {
        this._search = searchInput.value.trim();
        this._refreshVisible(container);
      });

      const engineSelect = toolbar.querySelector('#qEngine');
      engineSelect.addEventListener('change', () => {
        this._engine = engineSelect.value;
        this._refreshVisible(container);
      });

      const sortSelect = toolbar.querySelector('#qSort');
      sortSelect.addEventListener('change', () => {
        this._sort = sortSelect.value;
        this._refreshVisible(container);
      });

      const selectAll = toolbar.querySelector('#qSelectAll');
      selectAll.addEventListener('change', () => {
        const visible = this._currentVisibleIds(container);
        if (selectAll.checked) visible.forEach((id) => this._selected.add(id));
        else visible.forEach((id) => this._selected.delete(id));
        this._refreshVisible(container);
      });
    } else {
      toolbar.innerHTML = `
        <input type="text" id="qSearch" class="q-search" placeholder="${escapeHtml(t('quarantine.searchPlaceholder'))}"
          value="${escapeHtml(this._search)}">
        <select id="qSort" class="q-select">
          <option value="date-desc" ${this._sort === 'date-desc' ? 'selected' : ''}>${escapeHtml(t('quarantine.sortDateDesc'))}</option>
          <option value="date-asc" ${this._sort === 'date-asc' ? 'selected' : ''}>${escapeHtml(t('quarantine.sortDateAsc'))}</option>
          <option value="name-asc" ${this._sort === 'name-asc' ? 'selected' : ''}>${escapeHtml(t('quarantine.sortName'))}</option>
          <option value="path-asc" ${this._sort === 'path-asc' ? 'selected' : ''}>${escapeHtml(t('quarantine.sortPath'))}</option>
        </select>
      `;
      const searchInput = toolbar.querySelector('#qSearch');
      searchInput.addEventListener('input', () => {
        this._search = searchInput.value.trim();
        this._refreshVisible(container);
      });
      const sortSelect = toolbar.querySelector('#qSort');
      sortSelect.addEventListener('change', () => {
        this._sort = sortSelect.value;
        this._refreshVisible(container);
      });
    }

    this._bindBulkActions(container, activeCount);
  },

  _bindBulkActions(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const bulk = container.querySelector('#qBulkActions');
    if (!bulk) return;

    bulk.innerHTML = `
      <button class="btn btn-sm" id="qRestoreSelected" disabled>${escapeHtml(t('quarantine.restoreSelected'))}</button>
      <button class="btn btn-sm" id="qTrustSelected" disabled>${escapeHtml(t('quarantine.restoreAndTrust'))}</button>
      <button class="btn btn-sm" style="color: var(--accent-danger);" id="qDeleteSelected" disabled>${escapeHtml(t('quarantine.deleteSelected'))}</button>
    `;

    const updateDisabled = () => {
      const has = this._selected.size > 0;
      bulk.querySelector('#qRestoreSelected').disabled = !has;
      bulk.querySelector('#qTrustSelected').disabled = !has;
      bulk.querySelector('#qDeleteSelected').disabled = !has;
    };

    bulk.querySelector('#qRestoreSelected').addEventListener('click', async () => {
      await this._bulkAction(container, 'restore');
    });
    bulk.querySelector('#qTrustSelected').addEventListener('click', async () => {
      await this._bulkAction(container, 'restoreAndTrust');
    });
    bulk.querySelector('#qDeleteSelected').addEventListener('click', async () => {
      await this._bulkAction(container, 'delete');
    });
    this._updateDisabled = updateDisabled;
  },

  async _bulkAction(container, action) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const ids = [...this._selected];
    if (!ids.length) return;

    let confirmMsg;
    if (action === 'restore') confirmMsg = t('quarantine.confirmRestoreMany', { count: ids.length });
    else if (action === 'restoreAndTrust') confirmMsg = t('quarantine.confirmTrustMany', { count: ids.length });
    else confirmMsg = t('quarantine.confirmDeleteMany', { count: ids.length });
    if (!confirmAction(confirmMsg)) return;

    const failures = [];
    for (const id of ids) {
      try {
        const channel = action === 'restore'
          ? { name: 'quarantine:restore', args: [id] }
          : action === 'restoreAndTrust'
            ? { name: 'quarantine:restoreAndTrust', args: [id] }
            : { name: 'quarantine:delete', args: [id] };
        const res = await window.api.invoke(channel.name, ...channel.args);
        if (!res.success) failures.push(`${id}: ${res.error}`);
      } catch (e) {
        failures.push(`${id}: ${e.message || String(e)}`);
      }
    }
    if (failures.length) alert(t('quarantine.someFailed', { failures: failures.join('\n') }));
    this._selected.clear();
    this.render(container);
  },

  _matchesFilters(item) {
    if (this._search) {
      const q = this._search.toLowerCase();
      const haystack = [item.threat_name, item.original_path, item.hash, item.reason]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (this._engine !== 'all' && item.engine !== this._engine) return false;
    return true;
  },

  _sortItems(list) {
    const copy = list.slice();
    const sort = this._sort;
    copy.sort((a, b) => {
      if (sort === 'date-asc') return String(a.date_quarantined).localeCompare(String(b.date_quarantined));
      if (sort === 'name-asc') return String(a.threat_name || '').localeCompare(String(b.threat_name || ''));
      if (sort === 'path-asc') return String(a.original_path || '').localeCompare(String(b.original_path || ''));
      return String(b.date_quarantined).localeCompare(String(a.date_quarantined));
    });
    return copy;
  },

  _currentVisibleIds(container) {
    const itemEls = container.querySelectorAll('[data-qid]');
    const ids = [];
    itemEls.forEach((el) => ids.push(Number(el.getAttribute('data-qid'))));
    return ids;
  },

  _refreshVisible(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const listContainer = container.querySelector('#quarantineList');
    if (!listContainer) return;

    if (this._tab === 'trusted') {
      this._renderTrusted(listContainer);
      return;
    }

    const filtered = this._sortItems(
      this._byTab(this._allItems || []).filter((i) => this._matchesFilters(i))
    );

    const selectAll = container.querySelector('#qSelectAll');
    if (selectAll) selectAll.checked = filtered.length > 0 && filtered.every((i) => this._selected.has(i.id));
    if (this._updateDisabled) this._updateDisabled();

    if (!filtered.length) {
      listContainer.innerHTML = `<div class="empty-state">${escapeHtml(t(this._search || this._engine !== 'all' ? 'quarantine.noMatch' : 'quarantine.empty'))}</div>`;
      return;
    }

    this._renderRows(listContainer, filtered);
  },

  _renderList(container, { list, trusted }) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    this._allItems = list;
    this._trusted = trusted;
    this._selected = new Set([...this._selected].filter((id) => list.some((i) => i.id === id)));

    const listContainer = container.querySelector('#quarantineList');
    if (!listContainer) return;

    if (this._tab === 'trusted') {
      this._renderTrusted(listContainer);
      return;
    }

    const filtered = this._sortItems(this._byTab(list).filter((i) => this._matchesFilters(i)));

    const selectAll = container.querySelector('#qSelectAll');
    if (selectAll) selectAll.checked = filtered.length > 0 && filtered.every((i) => this._selected.has(i.id));
    if (this._updateDisabled) this._updateDisabled();

    if (!filtered.length) {
      listContainer.innerHTML = `<div class="empty-state">${escapeHtml(t(this._tab === 'history' ? 'quarantine.historyEmpty' : (this._search || this._engine !== 'all' ? 'quarantine.noMatch' : 'quarantine.empty')))}</div>`;
      return;
    }

    this._renderRows(listContainer, filtered);
  },

  _renderRows(listContainer, items) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    listContainer.innerHTML = '';
    items.forEach((item) => listContainer.appendChild(this._buildItemRow(item)));
    void t;
  },

  _buildItemRow(item) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const row = document.createElement('div');
    row.setAttribute('data-qid', String(item.id));
    row.style.cssText = 'display:flex; flex-direction:column; padding:12px; background:rgba(255,255,255,0.02); border-radius:8px; border:1px solid var(--glass-border);';
    const isExpanded = this._expanded.has(item.id);
    const statusLabel = t('quarantine.status.' + item.status) || item.status;

    let actionsHtml = '';
    if (this._tab === 'quarantined') {
      actionsHtml = `
        <button class="btn btn-sm" data-action="restore" data-id="${item.id}">${escapeHtml(t('quarantine.restore'))}</button>
        <button class="btn btn-sm" data-action="restoreAndTrust" data-id="${item.id}" title="${escapeHtml(t('quarantine.restoreAndTrustDesc'))}">${escapeHtml(t('quarantine.restoreAndTrust'))}</button>
        <button class="btn btn-sm" style="color: var(--accent-danger);" data-action="delete" data-id="${item.id}">${escapeHtml(t('quarantine.delete'))}</button>
      `;
    } else {
      actionsHtml = `
        <span class="q-status-badge" style="padding:4px 10px; border-radius:12px; font-size:0.75rem;
          background:${item.status === 'deleted' ? 'var(--accent-danger-glow,rgba(255,80,80,0.15))' : 'var(--accent-success-glow,rgba(63,185,80,0.15))'};
          color:${item.status === 'deleted' ? 'var(--accent-danger)' : 'var(--accent-success)'};">${escapeHtml(statusLabel)}</span>
      `;
    }

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          ${this._tab === 'quarantined' ? `<input type="checkbox" class="q-check" data-id="${item.id}" ${this._selected.has(item.id) ? 'checked' : ''} />` : ''}
          <button class="btn btn-sm q-expand" data-id="${item.id}" title="${escapeHtml(t('quarantine.details'))}" style="padding:2px 8px; background:transparent; border:none; color:inherit; cursor:pointer;">${isExpanded ? '▾' : '▸'}</button>
          <div style="min-width:0;">
            <div style="font-weight:500; word-break:break-word;">${escapeHtml(item.threat_name || '—')}</div>
            <div class="page-subtitle" style="font-size:0.8rem; margin-top:2px; word-break:break-word;">${escapeHtml(item.original_path)}</div>
            <div class="page-subtitle" style="font-size:0.75rem;">${escapeHtml(item.date_quarantined || '')}${item.engine ? ' | ' + escapeHtml(item.engine) : ''}${item.size_bytes != null ? ' | ' + escapeHtml(formatBytes(item.size_bytes)) : ''}</div>
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-shrink:0;">
          ${actionsHtml}
        </div>
      </div>
      ${isExpanded ? `
        <div class="q-details" style="margin-top:10px; padding:10px 12px; border-radius:8px; background:rgba(0,0,0,0.15); display:flex; flex-direction:column; gap:6px; font-size:0.85rem;">
          <div><strong>${escapeHtml(t('quarantine.reason'))}:</strong> ${escapeHtml(item.reason || '—')}</div>
          ${item.hash ? `
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <strong>${escapeHtml(t('quarantine.hash'))}:</strong> <code style="word-break:break-all; font-size:0.8rem;">${escapeHtml(item.hash)}</code>
              <button class="btn btn-sm" data-action="copyHash" data-value="${escapeHtml(item.hash)}">${escapeHtml(t('quarantine.copyHash'))}</button>
            </div>` : ''}
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <strong>${escapeHtml(t('quarantine.path'))}:</strong> <span style="word-break:break-all;">${escapeHtml(item.original_path)}</span>
            <button class="btn btn-sm" data-action="copyPath" data-value="${escapeHtml(item.original_path)}">${escapeHtml(t('quarantine.copyPath'))}</button>
          </div>
          ${item.size_bytes != null ? `<div><strong>${escapeHtml(t('quarantine.size'))}:</strong> ${escapeHtml(formatBytes(item.size_bytes))}</div>` : ''}
        </div>
      ` : ''}
    `;

    const check = row.querySelector('.q-check');
    if (check) {
      check.addEventListener('change', () => {
        const id = Number(check.getAttribute('data-id'));
        if (check.checked) this._selected.add(id);
        else this._selected.delete(id);
        const selectAll = this._container && this._container.querySelector('#qSelectAll');
        if (selectAll) {
          const visible = this._currentVisibleIds(this._container);
          selectAll.checked = visible.length > 0 && visible.every((i) => this._selected.has(i));
        }
        if (this._updateDisabled) this._updateDisabled();
      });
    }

    const expandBtn = row.querySelector('.q-expand');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        const id = Number(expandBtn.getAttribute('data-id'));
        if (this._expanded.has(id)) this._expanded.delete(id);
        else this._expanded.add(id);
        this._reRenderRow(row, id);
      });
    }

    this._bindRowActions(row, item);
    return row;
  },

  _reRenderRow(row, id) {
    const item = this._allItems.find((i) => i.id === id);
    const listContainer = row.parentElement;
    if (!item || !listContainer) return;
    const replacement = this._buildItemRow(item);
    row.replaceWith(replacement);
  },

  _bindRowActions(row, item) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    row.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-action');
        const id = Number(btn.getAttribute('data-id'));
        const value = btn.getAttribute('data-value');

        if (action === 'copyHash' || action === 'copyPath') {
          const ok = await copyText(value);
          alert(ok
            ? t(action === 'copyHash' ? 'quarantine.copiedHash' : 'quarantine.copiedPath')
            : t('common.copied', {}));
          return;
        }

        if (action === 'restore') {
          if (!confirmAction(t('quarantine.confirmRestore'))) return;
          const res = await window.api.invoke('quarantine:restore', id);
          if (!res.success) { alert(t('quarantine.failedRestore', { error: res.error })); return; }
          this._selected.delete(id);
          this._container && this.render(this._container);
        } else if (action === 'restoreAndTrust') {
          if (!confirmAction(t('quarantine.confirmRestoreAndTrust'))) return;
          const res = await window.api.invoke('quarantine:restoreAndTrust', id);
          if (!res.success) { alert(t('quarantine.failedRestoreAndTrust', { error: res.error })); return; }
          this._selected.delete(id);
          this._container && this.render(this._container);
        } else if (action === 'delete') {
          if (!confirmAction(t('quarantine.confirmDelete'))) return;
          const res = await window.api.invoke('quarantine:delete', id);
          if (!res.success) { alert(t('quarantine.failedDelete', { error: res.error })); return; }
          this._selected.delete(id);
          this._container && this.render(this._container);
        }
      });
    });
  },

  _renderTrusted(listContainer) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const trusted = this._trusted || [];
    if (!trusted.length) {
      listContainer.innerHTML = `<div class="empty-state">${escapeHtml(t('quarantine.trustedEmpty'))}</div>`;
      return;
    }
    listContainer.innerHTML = '';
    trusted.forEach((item) => {
      const el = document.createElement('div');
      el.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding:12px; background:rgba(255,255,255,0.02); border-radius:8px; border:1px solid var(--glass-border);';
      el.innerHTML = `
        <div style="min-width:0;">
          <div style="font-weight:500; word-break:break-word;">${escapeHtml(item.threat_name || item.hash)}</div>
          <div class="page-subtitle" style="font-size:0.8rem; margin-top:2px; word-break:break-word;">${escapeHtml(item.original_path || '')}</div>
          <div class="page-subtitle" style="font-size:0.75rem;">${escapeHtml(item.added_at || '')} | ${escapeHtml(item.hash)}</div>
        </div>
        <div style="display:flex; gap:8px; flex-shrink:0;">
          <button class="btn btn-sm" style="color: var(--accent-danger);" data-untrust="${escapeHtml(item.hash)}">${escapeHtml(t('quarantine.untrust'))}</button>
        </div>
      `;
      const btn = el.querySelector('[data-untrust]');
      btn.addEventListener('click', async () => {
        if (!confirmAction(t('quarantine.confirmUntrust'))) return;
        const hash = btn.getAttribute('data-untrust');
        const res = await window.api.invoke('quarantine:removeTrusted', hash);
        if (res && res.success) alert(t('quarantine.untrusted'));
        else alert(t('quarantine.failedUntrust', { error: (res && res.error) || 'unknown' }));
        this._container && this.render(this._container);
      });
      listContainer.appendChild(el);
    });
  },

  _bindTabButtons(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    container.querySelectorAll('.q-tab').forEach((btn) => {
      const tab = btn.getAttribute('data-tab');
      btn.classList.toggle('q-tab-active', tab === this._tab);
      btn.addEventListener('click', () => {
        this._tab = tab;
        this._search = '';
        this._engine = 'all';
        this._selected.clear();
        this._expanded.clear();
        this.render(container);
      });
      void t;
    });
  }
};