window.Pages = window.Pages || {};
window.Pages.passwords = {
  render(container) {
    container.innerHTML = `
      <div class="page-header"><h1 class="page-title">Credential Safety Hub</h1>
        <div class="page-subtitle">Generate strong passwords and check credentials against breach data</div></div>
      <div class="grid grid-2">
        <div class="panel"><div class="panel-title">Generator</div>
          <div class="field"><label class="field-label">Length: <span id="lengthValue">16</span></label>
            <input type="range" id="lengthSlider" min="4" max="64" value="16" style="width:100%;" /></div>
          <label class="checkbox-row"><input type="checkbox" id="optLower" checked />Lowercase</label>
          <label class="checkbox-row"><input type="checkbox" id="optUpper" checked />Uppercase</label>
          <label class="checkbox-row"><input type="checkbox" id="optDigits" checked />Digits</label>
          <label class="checkbox-row"><input type="checkbox" id="optSymbols" checked />Symbols</label>
          <label class="checkbox-row"><input type="checkbox" id="optAmbiguous" />Exclude ambiguous (l,1,O,0)</label>
          <button class="btn btn-primary" id="generateBtn" style="margin-top:6px;width:100%;justify-content:center;">Generate Password</button>
          <div id="generatedOut" style="margin-top:16px;display:none;">
            <div class="password-display" id="generatedPassword"></div>
            <div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-sm" id="copyBtn">Copy to Clipboard</button></div>
            <div id="generatedStrength" style="margin-top:10px;"></div>
          </div>
        </div>
        <div class="panel"><div class="panel-title">Strength Checker</div>
          <div class="field"><label class="field-label">Enter a password to analyze</label>
            <div style="position:relative;">
              <input type="password" id="checkInput" placeholder="Type a password..." style="width:100%; padding-right:36px; box-sizing:border-box;" />
              <button type="button" class="password-toggle-visibility" data-target="checkInput" title="Show password" style="position:absolute; right:6px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--text-dim); padding:4px; display:flex;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
          <div id="checkStrength"></div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:10px;">Strength is analyzed locally.</div>
        </div>
        <div class="panel"><div class="panel-title">Password Leak Check</div>
          <div class="field"><label class="field-label">Check against HIBP Pwned Passwords</label>
            <div style="position:relative;">
              <input type="password" id="leakPasswordInput" placeholder="Type a password to check" style="width:100%; padding-right:36px; box-sizing:border-box;" />
              <button type="button" class="password-toggle-visibility" data-target="leakPasswordInput" title="Show password" style="position:absolute; right:6px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--text-dim); padding:4px; display:flex;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
          <button class="btn btn-primary" id="checkPasswordLeak">Check Password</button>
          <div id="passwordLeakResult" style="margin-top:12px;"></div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:10px;">Uses HIBP k-anonymity: only the first 5 SHA-1 hash characters are sent. Disable in Settings for offline-only use.</div>
        </div>
        <div class="panel"><div class="panel-title">Email Breach Check</div>
          <div class="field"><label class="field-label">Email address</label>
            <input type="text" id="leakEmailInput" placeholder="name@example.com" /></div>
          <button class="btn btn-primary" id="checkEmailLeak">Check Email</button>
          <div id="emailLeakResult" style="margin-top:12px;"></div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:10px;">Uses the XposedOrNot email breach API. Disable in Settings for offline-only use.</div>
        </div>
      </div>`;
    this.wireGenerator(container);
    this.wireChecker(container);
    this.wireLeakChecks(container);
    this.wirePasswordVisibilityToggles(container);
  },

  wirePasswordVisibilityToggles(container) {
    container.querySelectorAll('.password-toggle-visibility').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = container.querySelector(`#${btn.dataset.target}`);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.title = showing ? 'Show password' : 'Hide password';
        btn.innerHTML = showing
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      });
    });
  },

  wireGenerator(container) {
    const slider = container.querySelector('#lengthSlider');
    slider.addEventListener('input', () => { container.querySelector('#lengthValue').textContent = slider.value; });
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
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 1200);
    });
  },

  wireChecker(container) {
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
    const settings = await Api.getSettings();
    const externalLookups = settings.features.externalLookups;

    const disabledHtml = '<div class="empty-state">External lookups are disabled. Enable them in&nbsp;<a href="#" class="goto-settings" style="color:var(--accent-primary);">Settings</a>.</div>';

    container.querySelector('#checkPasswordLeak').addEventListener('click', async () => {
      const btn = container.querySelector('#checkPasswordLeak');
      const out = container.querySelector('#passwordLeakResult');
      const password = container.querySelector('#leakPasswordInput').value;
      if (!password) { out.innerHTML = '<div class="empty-state">Enter a password first.</div>'; return; }
      if (!externalLookups) { out.innerHTML = disabledHtml; return; }
      setButtonLoading(btn, true, 'Checking...');
      try {
        const result = await window.api.invoke('hibp:password', password);
        out.innerHTML = result.found
          ? `<div class="log-row"><span class="log-tag match">pwned</span><span class="log-path">This password appears ${result.count.toLocaleString()} time(s) in known breaches. Do not use it.</span></div>`
          : '<div class="log-row"><span class="log-tag clean">clear</span><span class="log-path">This password was not found in HIBP Pwned Passwords.</span></div>';
      } catch (err) { showToolError(out, err); }
      finally { setButtonLoading(btn, false); }
    });
    container.querySelector('#checkEmailLeak').addEventListener('click', async () => {
      const btn = container.querySelector('#checkEmailLeak');
      const out = container.querySelector('#emailLeakResult');
      const email = container.querySelector('#leakEmailInput').value.trim();
      if (!email) { out.innerHTML = '<div class="empty-state">Enter an email first.</div>'; return; }
      if (!externalLookups) { out.innerHTML = disabledHtml; return; }
      setButtonLoading(btn, true, 'Checking...');
      try {
        const result = await window.api.invoke('xon:email', email);
        if (!result.found) {
          out.innerHTML = '<div class="log-row"><span class="log-tag clean">clear</span><span class="log-path">No breaches returned for this email.</span></div>';
        } else {
          out.innerHTML = `<div class="log-row"><span class="log-tag match">breached</span><span class="log-path">${result.breaches.length} breach(es) returned.</span></div>` +
            result.breaches.map(b => `<div class="log-row"><span class="log-tag warn">breach</span><span class="log-path">${escapeHtml(typeof b === 'string' ? b : (b.Name || b.name || b.breach || b.breach_name || JSON.stringify(b)))}</span></div>`).join('');
        }
      } catch (err) { showToolError(out, err); }
      finally { setButtonLoading(btn, false); }
    });
  }
};

function renderStrengthMeter(el, strength, showIssues) {
  const color = strength.label === 'Very Strong' || strength.label === 'Strong' ? 'var(--ok)' : strength.label === 'Moderate' ? 'var(--warn)' : 'var(--danger)';
  const issuesHtml = (showIssues && strength.issues && strength.issues.length) ? `<ul class="issue-list">${strength.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
  const crackHtml = strength.crackTimeEstimate ? `<div style="font-size:11px; color:var(--text-dim); margin-top:6px;">Estimated time to crack: <strong>${escapeHtml(strength.crackTimeEstimate)}</strong></div>` : '';
  el.innerHTML = `<div class="flex-between" style="font-size:12px;"><span style="color:${color};font-weight:600;">${strength.label}</span><span class="mono" style="color:var(--text-dim);">~${strength.entropyBits} bits entropy</span></div><div class="strength-meter-track"><div class="strength-meter-fill" style="width:${strength.score}%;background:${color};"></div></div>${crackHtml}${issuesHtml}`;
}