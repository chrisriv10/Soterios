window.Pages = window.Pages || {};

window.Pages.passwords = {
  render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Passwords</h1>
        <div class="page-subtitle">Generate strong passwords and check existing ones</div>
      </div>

      <div class="grid grid-2">
        <div class="panel">
          <div class="panel-title">Generator</div>

          <div class="field">
            <label class="field-label">Length: <span id="lengthValue">16</span></label>
            <input type="range" id="lengthSlider" min="4" max="64" value="16" style="width:100%;" />
          </div>

          <div class="checkbox-row"><input type="checkbox" id="optLower" checked /> <label for="optLower">Lowercase (a-z)</label></div>
          <div class="checkbox-row"><input type="checkbox" id="optUpper" checked /> <label for="optUpper">Uppercase (A-Z)</label></div>
          <div class="checkbox-row"><input type="checkbox" id="optDigits" checked /> <label for="optDigits">Digits (0-9)</label></div>
          <div class="checkbox-row"><input type="checkbox" id="optSymbols" checked /> <label for="optSymbols">Symbols (!@#$…)</label></div>
          <div class="checkbox-row"><input type="checkbox" id="optAmbiguous" /> <label for="optAmbiguous">Exclude ambiguous characters (l, 1, O, 0)</label></div>

          <button class="btn btn-primary" id="generateBtn" style="margin-top:6px; width:100%; justify-content:center;">Generate Password</button>

          <div id="generatedOut" style="margin-top:16px; display:none;">
            <div class="password-display" id="generatedPassword"></div>
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button class="btn btn-sm" id="copyBtn">Copy to Clipboard</button>
            </div>
            <div id="generatedStrength" style="margin-top:10px;"></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">Strength Checker</div>
          <div class="field">
            <label class="field-label">Enter a password to analyze</label>
            <input type="password" id="checkInput" placeholder="Type a password…" />
          </div>
          <div id="checkStrength"></div>
          <div style="font-size:11px; color: var(--text-dim); margin-top:10px;">
            Analyzed locally — nothing is sent anywhere.
          </div>
        </div>
      </div>
    `;

    this.wireGenerator(container);
    this.wireChecker(container);
  },

  wireGenerator(container) {
    const slider = container.querySelector('#lengthSlider');
    const lengthValue = container.querySelector('#lengthValue');
    slider.addEventListener('input', () => { lengthValue.textContent = slider.value; });

    container.querySelector('#generateBtn').addEventListener('click', async () => {
      const args = {
        length: parseInt(slider.value, 10),
        useLower: container.querySelector('#optLower').checked,
        useUpper: container.querySelector('#optUpper').checked,
        useDigits: container.querySelector('#optDigits').checked,
        useSymbols: container.querySelector('#optSymbols').checked,
        excludeAmbiguous: container.querySelector('#optAmbiguous').checked
      };

      const out = container.querySelector('#generatedOut');
      try {
        const result = await Api.runTool('password-generator', args);
        out.style.display = 'block';
        container.querySelector('#generatedPassword').textContent = result.password;
        window.AppState.lastPasswordScore = result.strength.score;
        renderStrengthMeter(container.querySelector('#generatedStrength'), result.strength);
      } catch (err) {
        out.style.display = 'block';
        showToolError(out, err);
      }
    });

    container.querySelector('#copyBtn').addEventListener('click', () => {
      const text = container.querySelector('#generatedPassword').textContent;
      navigator.clipboard.writeText(text);
      const btn = container.querySelector('#copyBtn');
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1200);
    });
  },

  wireChecker(container) {
    const input = container.querySelector('#checkInput');
    const out = container.querySelector('#checkStrength');
    let debounceTimer = null;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (!input.value) {
          out.innerHTML = '';
          return;
        }
        try {
          const result = await Api.runTool('password-strength-checker', { password: input.value });
          window.AppState.lastPasswordScore = result.score;
          renderStrengthMeter(out, result, true);
        } catch (err) {
          showToolError(out, err);
        }
      }, 200);
    });
  }
};

function strengthColor(label) {
  if (label === 'Very Strong' || label === 'Strong') return 'var(--ok)';
  if (label === 'Moderate') return 'var(--warn)';
  return 'var(--danger)';
}

function renderStrengthMeter(el, strength, showIssues) {
  const color = strengthColor(strength.label);
  const issuesHtml = (showIssues && strength.issues && strength.issues.length)
    ? `<ul class="issue-list">${strength.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    : '';

  el.innerHTML = `
    <div class="flex-between" style="font-size:12px;">
      <span style="color:${color}; font-weight:600;">${strength.label}</span>
      <span class="mono" style="color: var(--text-dim);">~${strength.entropyBits} bits entropy</span>
    </div>
    <div class="strength-meter-track">
      <div class="strength-meter-fill" style="width:${strength.score}%; background:${color};"></div>
    </div>
    ${issuesHtml}
  `;
}
