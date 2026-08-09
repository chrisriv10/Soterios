window.Pages = window.Pages || {};

window.Pages.ai = {
  _unsubscribeChunks: null,
  _messages: [],
  _requestId: null,
  _busy: false,
  _config: { host: '', model: '' },
  _container: null,

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
        <div class="ai-messages" id="aiMessages">
          <div class="ai-empty" id="aiEmpty">${escapeHtml(this.t('ai.empty'))}</div>
        </div>
        <div class="ai-input-row">
          <textarea id="aiPrompt" class="ai-input ai-prompt" rows="2" placeholder="${escapeHtml(this.t('ai.placeholder'))}"></textarea>
          <button class="btn btn-primary" id="aiSendBtn">${escapeHtml(this.t('ai.send'))}</button>
          <button class="btn btn-danger" id="aiStopBtn" style="display:none;">${escapeHtml(this.t('ai.stop'))}</button>
        </div>
      </div>`;
    this.load(container);
  },

  async load(container) {
    this._unsubscribeChunks = window.soterios.ai.onChunk((payload) => this.onChunk(payload));

    container.querySelector('#aiSendBtn').addEventListener('click', () => this.send(container));
    container.querySelector('#aiStopBtn').addEventListener('click', () => this.stop(container));
    container.querySelector('#aiRefreshBtn').addEventListener('click', () => this.refreshStatus(container, true));
    container.querySelector('#aiSaveConfigBtn').addEventListener('click', () => this.saveConfig(container));

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

  async send(container) {
    if (this._busy) return;
    const prompt = container.querySelector('#aiPrompt');
    const content = prompt.value.trim();
    if (!content) return;

    const messages = this._messages.slice(-19);
    messages.push({ role: 'user', content });
    this._messages.push({ role: 'user', content });

    this.appendMessage('user', content);
    const bubble = this.appendMessage('assistant', '');

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
