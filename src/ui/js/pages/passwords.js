window.Pages = window.Pages || {};
window.Pages.passwords = {
  render(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    container.innerHTML = `
      <div class="page-header"><h1 class="page-title">${escapeHtml(t('passwords.title'))}</h1>
        <div class="page-subtitle">${escapeHtml(t('passwords.subtitle'))}</div></div>
      <div class="grid grid-2">
        <div class="panel"><div class="panel-title">${escapeHtml(t('passwords.generator'))}</div>
          <div class="field"><label class="field-label" id="lengthLabel">${escapeHtml(t('passwords.length', { value: 16 }))}</label>
            <input type="range" id="lengthSlider" min="4" max="64" value="16" style="width:100%;" /></div>
          <label class="checkbox-row"><input type="checkbox" id="optLower" checked />${escapeHtml(t('passwords.lowercase'))}</label>
          <label class="checkbox-row"><input type="checkbox" id="optUpper" checked />${escapeHtml(t('passwords.uppercase'))}</label>
          <label class="checkbox-row"><input type="checkbox" id="optDigits" checked />${escapeHtml(t('passwords.digits'))}</label>
          <label class="checkbox-row"><input type="checkbox" id="optSymbols" checked />${escapeHtml(t('passwords.symbols'))}</label>
          <label class="checkbox-row"><input type="checkbox" id="optAmbiguous" />${escapeHtml(t('passwords.excludeAmbiguous'))}</label>
          <button class="btn btn-primary" id="generateBtn" style="margin-top:6px;width:100%;justify-content:center;">${escapeHtml(t('passwords.generate'))}</button>
          <div id="generatedOut" style="margin-top:16px;display:none;">
            <div class="password-display" id="generatedPassword"></div>
            <div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-sm" id="copyBtn">${escapeHtml(t('passwords.copy'))}</button></div>
            <div id="generatedStrength" style="margin-top:10px;"></div>
          </div>
        </div>
        <div class="panel"><div class="panel-title">${escapeHtml(t('passwords.strengthChecker'))}</div>
          <div class="field"><label class="field-label">${escapeHtml(t('passwords.enterPassword'))}</label>
            <div style="position:relative;">
              <input type="password" id="checkInput" placeholder="${escapeHtml(t('passwords.typePassword'))}" style="width:100%; padding-right:36px; box-sizing:border-box;" />
              <button type="button" class="password-toggle-visibility" data-target="checkInput" title="${escapeHtml(t('passwords.showPassword'))}" style="position:absolute; right:6px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--text-dim); padding:4px; display:flex;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
          <div id="checkStrength"></div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:10px;">${escapeHtml(t('passwords.localAnalysis'))}</div>
        </div>
        <div class="panel"><div class="panel-title">${escapeHtml(t('passwords.leakCheck'))}</div>
          <div class="field"><label class="field-label">${escapeHtml(t('passwords.leakCheckDesc'))}</label>
            <div style="position:relative;">
              <input type="password" id="leakPasswordInput" placeholder="${escapeHtml(t('passwords.typePasswordCheck'))}" style="width:100%; padding-right:36px; box-sizing:border-box;" />
              <button type="button" class="password-toggle-visibility" data-target="leakPasswordInput" title="${escapeHtml(t('passwords.showPassword'))}" style="position:absolute; right:6px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--text-dim); padding:4px; display:flex;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
          <button class="btn btn-primary" id="checkPasswordLeak">${escapeHtml(t('passwords.checkPassword'))}</button>
          <div id="passwordLeakResult" style="margin-top:12px;"></div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:10px;">${escapeHtml(t('passwords.hibpNote'))}</div>
        </div>
        <div class="panel"><div class="panel-title">${escapeHtml(t('passwords.emailBreachCheck'))}</div>
          <div class="field"><label class="field-label">${escapeHtml(t('passwords.emailLabel'))}</label>
            <input type="text" id="leakEmailInput" placeholder="${escapeHtml(t('passwords.emailPlaceholder'))}" /></div>
          <button class="btn btn-primary" id="checkEmailLeak">${escapeHtml(t('passwords.checkEmail'))}</button>
          <div id="emailLeakResult" style="margin-top:12px;"></div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:10px;">${escapeHtml(t('passwords.xposedNote'))}</div>
        </div>
      </div>`;
    this.wireGenerator(container);
    this.wireChecker(container);
    this.wireLeakChecks(container);
    this.wirePasswordVisibilityToggles(container);
  },

  wirePasswordVisibilityToggles(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    container.querySelectorAll('.password-toggle-visibility').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = container.querySelector(`#${btn.dataset.target}`);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.title = showing ? t('passwords.showPassword') : t('passwords.hidePassword');
        btn.innerHTML = showing
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      });
    });
  },

  wireGenerator(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const slider = container.querySelector('#lengthSlider');
    const lengthLabel = container.querySelector('#lengthLabel');
    slider.addEventListener('input', () => { 
      lengthLabel.textContent = t('passwords.length', { value: slider.value });
    });
    container.querySelector('#generateBtn').addEventListener('click', async () => {
      try {
        const result = await Api.runTool('password-generator', {
          length: parseInt(slider.value, 10),
          useLower: container.querySelector('#optLower').checked,
          useUpper: container.querySelector('#optUpper').checked,
          useDigits: container.querySelector('#optDigits').checked,
          useSymbols: container.querySelector('#optSymbols').checked,
          excludeAmbiguous: container.querySelector('#optAmbiguous').checked
        });
        const out = container.querySelector('#generatedOut');
        out.style.display = 'block';
        container.querySelector('#generatedPassword').textContent = result.password;
        window.AppState.lastPasswordScore = result.strength.score;
        await window.api.invoke('db:setSetting', 'feature.lastPasswordScore', result.strength.score);
        renderStrengthMeter(container.querySelector('#generatedStrength'), result.strength);
      } catch (err) { showToolError(container.querySelector('#generatedOut'), err); }
    });
    container.querySelector('#copyBtn').addEventListener('click', () => {
      const text = container.querySelector('#generatedPassword').textContent;
      navigator.clipboard.writeText(text);
      const btn = container.querySelector('#copyBtn');
      btn.textContent = t('passwords.copied');
      setTimeout(() => { btn.textContent = t('passwords.copy'); }, 1200);
    });
  },

  wireChecker(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const input = container.querySelector('#checkInput');
    const out = container.querySelector('#checkStrength');
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!input.value) { out.innerHTML = ''; return; }
        try {
          const result = await Api.runTool('password-strength-checker', { password: input.value });
          window.AppState.lastPasswordScore = result.score;
          await window.api.invoke('db:setSetting', 'feature.lastPasswordScore', result.score);
          renderStrengthMeter(out, result, true);
        } catch (err) { showToolError(out, err); }
      }, 200);
    });
  },

  async wireLeakChecks(container) {
    const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
    const settings = await Api.getSettings();
    const externalLookups = settings.features.externalLookups;

    const disabledHtml = `<div class="empty-state">${escapeHtml(t('passwords.externalDisabled'))}</div>`;

    container.querySelector('#checkPasswordLeak').addEventListener('click', async () => {
      const btn = container.querySelector('#checkPasswordLeak');
      const out = container.querySelector('#passwordLeakResult');
      const password = container.querySelector('#leakPasswordInput').value;
      if (!password) { out.innerHTML = `<div class="empty-state">${escapeHtml(t('passwords.enterPasswordFirst'))}</div>`; return; }
      if (!externalLookups) { out.innerHTML = disabledHtml; return; }
      setButtonLoading(btn, true, t('passwords.checking'));
      try {
        const result = await window.api.invoke('hibp:password', password);
        out.innerHTML = result.found
          ? `<div class="log-row"><span class="log-tag match">${escapeHtml(t('common.pwned'))}</span><span class="log-path">${escapeHtml(t('passwords.pwned', { count: result.count.toLocaleString() }))}</span></div>`
          : `<div class="log-row"><span class="log-tag clean">${escapeHtml(t('common.clear'))}</span><span class="log-path">${escapeHtml(t('passwords.notPwned'))}</span></div>`;
      } catch (err) { showToolError(out, err); }
      finally { setButtonLoading(btn, false); }
    });
    container.querySelector('#checkEmailLeak').addEventListener('click', async () => {
      const btn = container.querySelector('#checkEmailLeak');
      const out = container.querySelector('#emailLeakResult');
      const email = container.querySelector('#leakEmailInput').value.trim();
      if (!email) { out.innerHTML = `<div class="empty-state">${escapeHtml(t('passwords.enterEmailFirst'))}</div>`; return; }
      if (!externalLookups) { out.innerHTML = disabledHtml; return; }
      setButtonLoading(btn, true, t('passwords.checking'));
      try {
        const result = await window.api.invoke('xon:email', email);
        if (!result.found) {
          out.innerHTML = `<div class="log-row"><span class="log-tag clean">${escapeHtml(t('common.clear'))}</span><span class="log-path">${escapeHtml(t('passwords.noBreaches'))}</span></div>`;
        } else {
          out.innerHTML = `<div class="log-row"><span class="log-tag match">${escapeHtml(t('common.breached'))}</span><span class="log-path">${escapeHtml(t('passwords.breachesFound', { count: result.breaches.length }))}</span></div>` +
            result.breaches.map(b => `<div class="log-row"><span class="log-tag warn">${escapeHtml(t('common.breach'))}</span><span class="log-path">${escapeHtml(typeof b === 'string' ? b : (b.Name || b.name || b.breach || b.breach_name || JSON.stringify(b)))}</span></div>`).join('');
        }
      } catch (err) { showToolError(out, err); }
      finally { setButtonLoading(btn, false); }
    });
  }
};

function renderStrengthMeter(el, strength, showIssues) {
  const t = (key, vars) => window.I18n?.t(key, vars) ?? key;
  const color = strength.label === 'Very Strong' || strength.label === 'Strong' ? 'var(--ok)' : strength.label === 'Moderate' ? 'var(--warn)' : 'var(--danger)';
  
  // Translate strength issues
  const translatedIssues = (strength.issues || []).map(issue => {
    const issueMap = {
      'No uppercase letters': 'passwords.strengthIssues.noUppercase',
      'No lowercase letters': 'passwords.strengthIssues.noLowercase',
      'No digits': 'passwords.strengthIssues.noDigits',
      'No symbols': 'passwords.strengthIssues.noSymbols',
      'Too short': 'passwords.strengthIssues.tooShort',
      'Common pattern detected': 'passwords.strengthIssues.commonPattern',
      'Repeated characters': 'passwords.strengthIssues.repeatedChars',
      'Sequential characters': 'passwords.strengthIssues.sequentialChars'
    };
    return issueMap[issue] ? t(issueMap[issue]) : issue;
  });
  
  const issuesHtml = (showIssues && translatedIssues.length) ? `<ul class="issue-list">${translatedIssues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
  
  // Translate crack time
  let crackTimeHtml = '';
  if (strength.crackTimeEstimate) {
    const crackTimeMap = {
      'Instantly': 'passwords.crackTimeInstant',
      'Instant': 'passwords.crackTimeInstant'
    };
    const timeKey = crackTimeMap[strength.crackTimeEstimate];
    const translatedTime = timeKey ? t(timeKey) : strength.crackTimeEstimate;
    crackTimeHtml = `<div style="font-size:11px; color:var(--text-dim); margin-top:6px;">${escapeHtml(t('passwords.crackTime', { time: translatedTime }))}</div>`;
  }
  
  el.innerHTML = `<div class="flex-between" style="font-size:12px;"><span style="color:${color};font-weight:600;">${escapeHtml(strength.label)}</span><span class="mono" style="color:var(--text-dim);">~${strength.entropyBits} ${escapeHtml(t('common.bits'))} ${escapeHtml(t('common.entropy'))}</span></div><div class="strength-meter-track"><div class="strength-meter-fill" style="width:${strength.score}%;background:${color};"></div></div>${crackTimeHtml}${issuesHtml}`;
}