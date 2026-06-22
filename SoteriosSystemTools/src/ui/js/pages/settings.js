window.Pages = window.Pages || {};

window.Pages.settings = {
  render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
        <div class="page-subtitle">App information</div>
      </div>

      <div class="grid grid-2">
        <div class="panel">
          <div class="panel-title">About</div>
          <div style="font-size:12.5px; color: var(--text-muted); line-height:1.8;">
            <div><strong style="color:var(--text);">Soterios System Tools</strong> v0.1.0</div>
            <div>A local-first plugin-based desktop toolkit.</div>
            <div style="margin-top:10px;">All scanning, hashing, and analysis happens on-device. Nothing is uploaded anywhere.</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">File Scanner</div>
          <div style="font-size:12.5px; color: var(--text-muted); line-height:1.8;">
            <div>Signature database: <span class="mono" style="color:var(--text);">src/av/signatureDB.json</span></div>
            <div>Quarantine folder: <span class="mono" style="color:var(--text);">~/.soterios-quarantine</span></div>
            <div style="margin-top:10px;">Edit the signature database file directly to add SHA-256 hashes you want flagged.</div>
          </div>
        </div>
      </div>
    `;
  }
};
