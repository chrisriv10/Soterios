const Icons = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3Z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5 18 10m-3.5-2.5L17 5"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l2-8 4 16 2-8h6"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 12 16 8"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 13h4"/></svg>',
  'list-checks': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 7 2 2 4-4M3 17l2 2 4-4M11 7h10M11 17h10"/></svg>',
  'shield-check': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>'
};

function iconFor(name) { return Icons[name] || Icons.terminal; }
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`); if (h) parts.push(`${h}h`); parts.push(`${m}m`);
  return parts.join(' ');
}
function statusColor(level) { return { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)' }[level] || 'var(--text-dim)'; }
function setButtonLoading(button, loading, loadingLabel = 'Working…') {
  if (loading) { button.dataset.originalLabel = button.innerHTML; button.innerHTML = `<span class="spinner"></span> ${loadingLabel}`; button.disabled = true; }
  else { button.innerHTML = button.dataset.originalLabel || button.innerHTML; button.disabled = false; }
}
function showToolError(container, err) {
  container.innerHTML = `<div class="panel" style="border-color: var(--danger); color: var(--danger); font-size:12.5px;">${escapeHtml(err.message || String(err))}</div>`;
}
function truncatePath(p, maxLen) {
  if (!p || p.length <= maxLen) return p || '';
  const parts = p.split('\\');
  if (parts.length <= 3) return '...' + p.slice(-(maxLen - 3));
  const head = parts[0] + '\\...\\';
  const tail = parts.slice(-2).join('\\');
  return head + tail;
}

let toastContainer = null;
function showToast(message, type = 'success', duration = 3000) {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = 'position:fixed; top:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px; pointer-events:none;';
    document.body.appendChild(toastContainer);
  }
  
  const toast = document.createElement('div');
  const bgColor = type === 'success' ? 'var(--accent-success)' : type === 'error' ? 'var(--accent-danger)' : 'var(--accent-primary)';
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  
  toast.style.cssText = `
    pointer-events:auto;
    background:var(--bg-surface);
    border:1px solid ${bgColor};
    border-left:4px solid ${bgColor};
    border-radius:8px;
    padding:16px 20px;
    min-width:300px;
    max-width:400px;
    box-shadow:0 4px 20px rgba(0,0,0,0.3);
    backdrop-filter:blur(10px);
    display:flex;
    align-items:center;
    gap:12px;
    animation:toastSlideIn 0.3s ease-out;
    color:var(--text-main);
    font-size:14px;
  `;
  
  toast.innerHTML = `
    <span style="display:flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:50%; background:${bgColor}; color:#fff; font-weight:bold; font-size:14px;">${icon}</span>
    <span style="flex:1;">${escapeHtml(message)}</span>
  `;
  
  toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
