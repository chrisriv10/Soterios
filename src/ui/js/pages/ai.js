window.Pages = window.Pages || {};

window.Pages.ai = {
  _unsubscribeChunks: null,
  _messages: [],
  _requestId: null,
  _busy: false,
  _config: { host: '', model: '' },
  _container: null,
  _suggestions: [
    {
      key: 'ai.suggest.health',
      prompt: 'You are the assistant inside Soterios, a Windows security and maintenance app. The user tapped the quick question "Is my system healthy?". The system snapshot provided to you includes a health score, recent scans, and feature states. Answer from that snapshot: one or two sentences per area (disk, memory, CPU load, startup items, security protection) stating what the snapshot shows and what it means. Where the snapshot is missing an area, say it is not available and what to check in Soterios. End with a one-line verdict like "Your system looks healthy overall." Use short bold section headings with bullets, under 140 words.'
    },
    {
      key: 'ai.suggest.scan',
      prompt: 'You are the assistant inside Soterios, a Windows antivirus and maintenance app that uses ClamAV for full, quick, and custom scans, and moves detected threats to quarantine. The user tapped the quick question "Summarize my last scan". The snapshot provided to you includes their most recent scans (type, files scanned, threats found, duration). Summarize the latest scan from the snapshot: what was scanned, whether threats were found, and what that means. If threats were found, explain next steps (review quarantine, delete versus restore, rescan). If no scans are on record, say so and explain how to run a scan in Soterios and how often. Keep it under 140 words in 3-4 short sections.'
    },
    {
      key: 'ai.suggest.processes',
      prompt: 'You are the assistant inside Soterios, a Windows security and maintenance app. The user tapped the quick question "Which running processes should I worry about?". The snapshot provided to you includes the total number of running processes and how many were flagged suspicious. Answer from that: if suspicious processes are flagged, explain what makes them suspicious and how to review them in the process inspector. If none are flagged, say the process list looks clean and explain what signs to watch for: unusual names, high CPU or memory from unknown apps, unsigned executables, programs in odd locations, and PowerShell with encoded arguments. Teach them how to research a process before ending it, and that ending critical system processes is unsafe. Under 140 words, bullet format.'
    },
    {
      key: 'ai.suggest.quarantine',
      prompt: 'You are the assistant inside Soterios, a Windows antivirus app. Quarantined threats are moved to a safe, isolated location where they cannot run. The user tapped the quick question "What should I do about quarantined threats?". The snapshot provided to you includes their quarantined items (threat name, original path, reason, date). Review that list and explain each item in plain language where possible, what quarantine means, and the next step for each: delete (confirmed malware you do not need) or restore (likely false positive). If the list is empty, say so and explain what quarantine is for. Under 130 words in 3 short sections.'
    },
    {
      key: 'ai.suggest.firewall',
      prompt: 'You are the assistant inside Soterios, a Windows security app. The user tapped the quick question "Is my firewall protecting me?". The snapshot provided to you includes the state of each Windows firewall profile (Domain, Private, Public). Answer from that: list which profiles are enabled and which are disabled, what that means for protection, and what to do if any profile is off. Explain how to review rules on the Soterios firewall page. End with a clear "You are protected if..." summary. Under 140 words in bullet format.'
    },
    {
      key: 'ai.suggest.cleanup',
      prompt: 'You are the assistant inside Soterios, a Windows maintenance app. The user tapped the quick question "How can I free up disk space safely?". Use the snapshot provided to you where relevant (for example its disk health reason), then give a safe, ordered cleanup plan: clear temporary files, empty the Recycle Bin, uninstall unused apps, remove large files you recognize, clear browser caches, and use Storage Sense or Disk Cleanup. Mention Soterios tools like the disk space report, large files finder, temp file cleanup, and duplicate finder. Warn clearly against deleting Windows system files, Program Files content, or anything unrecognized. Under 150 words as numbered steps.'
    }
  ],

  t(key, vars) {
    return window.I18n?.t(key, vars) ?? key;
  },

  render(container) {
    this._container = container;
    this._messages = [];
    this._requestId = null;
    this._busy = false;
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">${escapeHtml(this.t('ai.title'))}</h1>
        <div class="page-subtitle">${escapeHtml(this.t('ai.subtitle'))}</div>
      </div>
      <div class="ai-page">
        <div class="ai-config-row">
          <div class="ai-config-field">
            <label for="aiHostInput">${escapeHtml(this.t('ai.host'))}</label>
            <input type="text" id="aiHostInput" class="ai-input" placeholder="http://localhost:11434" />
          </div>
          <div class="ai-config-field">
            <label for="aiModelSelect">${escapeHtml(this.t('ai.model'))}</label>
            <select id="aiModelSelect" class="ai-input"><option value="">${escapeHtml(this.t('ai.noModels'))}</option></select>
          </div>
          <button class="btn btn-sm" id="aiSaveConfigBtn">${escapeHtml(this.t('ai.save'))}</button>
          <button class="btn btn-sm btn-ghost" id="aiRefreshBtn">${escapeHtml(this.t('ai.refresh'))}</button>
          <span class="ai-config-saved" id="aiConfigSaved"></span>
        </div>
        <div class="ai-status-banner" id="aiStatusBanner" style="display:none;"></div>
        <div class="ai-messages" id="aiMessages"></div>
        <div class="ai-chips" id="aiChips"></div>
        <div class="ai-input-row">
          <textarea id="aiPrompt" class="ai-input ai-prompt" rows="2" placeholder="${escapeHtml(this.t('ai.placeholder'))}"></textarea>
          <button class="btn btn-primary" id="aiSendBtn">${escapeHtml(this.t('ai.send'))}</button>
          <button class="btn btn-danger" id="aiStopBtn" style="display:none;">${escapeHtml(this.t('ai.stop'))}</button>
        </div>
      </div>`;
    this.appendMessage('assistant', this.t('ai.starter'));
    this.load(container);
  },

  async load(container) {
    this._unsubscribeChunks = window.soterios.ai.onChunk((payload) => this.onChunk(payload));

    container.querySelector('#aiSendBtn').addEventListener('click', () => this.send(container));
    container.querySelector('#aiStopBtn').addEventListener('click', () => this.stop(container));
    container.querySelector('#aiRefreshBtn').addEventListener('click', () => this.refreshStatus(container, true));
    container.querySelector('#aiSaveConfigBtn').addEventListener('click', () => this.saveConfig(container));

    const chipsEl = container.querySelector('#aiChips');
    chipsEl.innerHTML = this._suggestions.map((s) =>
      `<button type="button" class="ai-chip" data-suggest="${s.key}">${escapeHtml(this.t(s.key))}</button>`
    ).join('');
    chipsEl.querySelectorAll('.ai-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const suggestion = this._suggestions.find((s) => s.key === chip.dataset.suggest);
        if (!suggestion) return;
        this.send(container, { content: suggestion.prompt, display: this.t(suggestion.key) });
      });
    });

    const prompt = container.querySelector('#aiPrompt');
    prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.send(container);
      }
    });

    try {
      this._config = await window.soterios.ai.getConfig();
    } catch (_) {
      this._config = { host: '', model: '' };
    }
    container.querySelector('#aiHostInput').value = this._config.host;

    this.refreshStatus(container, true);
  },

  destroy() {
    if (this._requestId) {
      try { window.soterios.ai.cancel(this._requestId); } catch (_) {}
    }
    if (this._unsubscribeChunks) {
      this._unsubscribeChunks();
      this._unsubscribeChunks = null;
    }
    this._container = null;
  },

  async refreshStatus(container, showSpinner) {
    const banner = container.querySelector('#aiStatusBanner');
    const select = container.querySelector('#aiModelSelect');
    if (showSpinner) {
      banner.style.display = 'block';
      banner.className = 'ai-status-banner ai-status-info';
      banner.textContent = this.t('ai.checking');
    }
    let result = null;
    try {
      result = await window.soterios.ai.status();
    } catch (_) {
      result = { ok: false, running: false, error: this.t('ai.error') };
    }

    if (result.ok) {
      banner.style.display = 'none';
      const models = result.models || [];
      const current = this._config.model;
      let options = models.map((m) => `<option value="${escapeHtml(m.name)}"${m.name === current ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
      if (!options) options = `<option value="">${escapeHtml(this.t('ai.noModels'))}</option>`;
      select.innerHTML = options;
      if (current && !models.some((m) => m.name === current)) {
        select.insertAdjacentHTML('afterbegin', `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`);
      }
      if (showSpinner && models.length === 0) {
        banner.style.display = 'block';
        banner.className = 'ai-status-banner ai-status-warn';
        banner.innerHTML = escapeHtml(this.t('ai.noModelsHint'));
      }
    } else {
      select.innerHTML = `<option value="">${escapeHtml(this.t('ai.noModels'))}</option>`;
      banner.style.display = 'block';
      banner.className = 'ai-status-banner ai-status-error';
      const errorText = result.error || this.t('ai.offline');
      banner.innerHTML = `<strong>${escapeHtml(this.t('ai.offline'))}</strong> ${escapeHtml(errorText)}<br>
        ${escapeHtml(this.t('ai.offlineHint'))} <a href="#" id="aiDownloadLink">ollama.com/download</a>`;
      const downloadLink = banner.querySelector('#aiDownloadLink');
      if (downloadLink) {
        downloadLink.addEventListener('click', (event) => {
          event.preventDefault();
          window.soterios.shell.openExternal('https://ollama.com/download');
        });
      }
    }
  },

  async saveConfig(container) {
    const host = container.querySelector('#aiHostInput').value.trim();
    const model = container.querySelector('#aiModelSelect').value;
    const saved = container.querySelector('#aiConfigSaved');
    try {
      this._config = await window.soterios.ai.setConfig({ host, model });
      saved.textContent = this.t('ai.saved');
      this.refreshStatus(container, true);
    } catch (err) {
      saved.textContent = err.message || this.t('ai.error');
    }
    setTimeout(() => { saved.textContent = ''; }, 3000);
  },

  appendMessage(role, content) {
    const messagesEl = this._container.querySelector('#aiMessages');
    const empty = messagesEl.querySelector('#aiEmpty');
    if (empty) empty.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = `ai-msg ai-msg-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    if (role === 'assistant') bubble.innerHTML = content ? formatAssistantText(content) : `<span class="ai-thinking">${escapeHtml(this.t('ai.thinking'))}</span>`;
    else bubble.textContent = content;
    msg.appendChild(bubble);
    messagesEl.appendChild(msg);
    this.scrollToBottom();
    return bubble;
  },

  updateAssistantBubble(bubble, text) {
    if (text.trim()) {
      bubble.innerHTML = formatAssistantText(text);
    }
    this.scrollToBottom();
  },

  scrollToBottom() {
    const messagesEl = this._container.querySelector('#aiMessages');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  },

  async send(container, options = {}) {
    if (this._busy) return;
    const prompt = container.querySelector('#aiPrompt');
    const content = (options.content != null && options.content.trim()) ? options.content.trim() : prompt.value.trim();
    if (!content) return;
    const display = (options.display != null && options.display.trim()) ? options.display.trim() : content;

    const messages = this._messages.slice(-19);
    messages.push({ role: 'user', content });
    this._messages.push({ role: 'user', content });

    this.appendMessage('user', display);
    const bubble = this.appendMessage('assistant', '');

    const chips = container.querySelector('#aiChips');
    if (chips) chips.style.display = 'none';

    const model = container.querySelector('#aiModelSelect').value;
    this._busy = true;
    container.querySelector('#aiSendBtn').style.display = 'none';
    container.querySelector('#aiStopBtn').style.display = 'inline-flex';
    prompt.value = '';
    this._currentBubble = bubble;
    this._currentText = '';

    try {
      const result = await window.soterios.ai.chat(messages, model);
      this._requestId = result.requestId;
    } catch (err) {
      this.finishStream(err.message || this.t('ai.error'));
    }
  },

  stop(container) {
    if (this._requestId) {
      window.soterios.ai.cancel(this._requestId);
    }
    this.finishStream();
  },

  finishStream(error, cancelled) {
    this._busy = false;
    this._requestId = null;
    const container = this._container;
    if (!container) return;
    const sendBtn = container.querySelector('#aiSendBtn');
    const stopBtn = container.querySelector('#aiStopBtn');
    if (sendBtn) sendBtn.style.display = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
    if (this._currentBubble) {
      if (error) {
        this._currentBubble.classList.add('ai-bubble-error');
        this._currentBubble.innerHTML = `<span class="ai-error-label">${escapeHtml(cancelled ? this.t('ai.cancelled') : error)}</span>`;
      } else {
        this.updateAssistantBubble(this._currentBubble, this._currentText);
        this._messages.push({ role: 'assistant', content: this._currentText });
      }
      this._currentBubble = null;
      this._currentText = '';
    }
  },

  onChunk(payload) {
    if (!payload || payload.requestId !== this._requestId) return;
    if (payload.type === 'delta') {
      this._currentText += payload.delta || '';
      if (this._currentBubble) {
        this.updateAssistantBubble(this._currentBubble, this._currentText);
      }
    } else if (payload.type === 'done') {
      this.finishStream();
    } else if (payload.type === 'error') {
      this.finishStream(payload.error, payload.error === 'cancelled');
    }
  }
};

function formatAssistantText(text) {
  let out = escapeHtml(text);
  const blocks = [];
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    blocks.push(`<pre class="ai-code">${code.trim()}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\n/g, '<br>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_match, i) => blocks[Number(i)]);
  return out;
}
