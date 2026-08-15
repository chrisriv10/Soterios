/**
 * Soterios Browser Extension - Content Script
 * Detects password fields, monitors for credential entry, and shows breach indicators
 */

let soteriosIcon = null;
let passwordFields = new Map();
let observer = null;
let autoCheckEnabled = false;
let notifyDesktopEnabled = true;
let checkOnTypeEnabled = false;
const autoCheckListeners = new WeakMap();

function createIcon() {
  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('icons/icon16.png');
  icon.style.cssText = `
    position: absolute;
    width: 16px; height: 16px;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s;
    z-index: 2147483647;
    pointer-events: auto;
  `;
  icon.title = 'Check password with Soterios';
  icon.addEventListener('mouseenter', () => icon.style.opacity = '1');
  icon.addEventListener('mouseleave', () => icon.style.opacity = '0.7');
  icon.addEventListener('click', onIconClick);
  return icon;
}

function positionIcon(icon, input) {
  const rect = input.getBoundingClientRect();
  icon.style.top = `${rect.top + window.scrollY + (rect.height - 16) / 2}px`;
  icon.style.left = `${rect.right + window.scrollX - 20}px`;
}

async function trackReuse(password, hostname) {
  const hash = await computeSha256(password);
  const { reuseMap } = await chrome.storage.local.get('reuseMap');
  const map = reuseMap || {};
  const reuse = checkReuse(map, hash, hostname);
  await chrome.storage.local.set({ reuseMap: storeReuse(map, hash, hostname, Date.now()) });
  return reuse;
}

async function onIconClick(e) {
  const input = e.target.dataset.forInput;
  const el = document.querySelector(`[data-soterios-id="${input}"]`);
  if (!el) return;

  const password = el.value;
  if (!password) return;

  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_PASSWORD', password });
    const reuse = await trackReuse(password, location.hostname);
    showResult(el, result, reuse);
    // Forward breach to desktop app for alerting
    if (notifyDesktopEnabled && result && result.pwned && result.count > 0) {
      await chrome.runtime.sendMessage({
        type: 'FORWARD_CREDENTIAL_LEAK',
        payload: { domain: location.hostname, count: result.count }
      });
    }
    if (reuse.reused) {
      await chrome.runtime.sendMessage({ type: 'REUSE_DETECTED', domain: location.hostname });
    }
  } catch (err) {
    console.error('[Soterios] Check failed:', err);
  }
}

function showResult(input, result, reuse) {
  removeResult(input);

  const badges = [];
  if (result && result.pwned) {
    badges.push({
      text: `Pwned ${result.count}x`,
      bg: '#dc3545',
      title: `Found in ${result.count} breach${result.count !== 1 ? 'es' : ''}. Change immediately.`
    });
  }
  if (reuse && reuse.reused) {
    badges.push({
      text: `Reused on ${reuse.otherDomain}`,
      bg: '#f59e0b',
      title: `Same password used on ${reuse.otherDomain}. Consider a unique password.`
    });
  }
  if (badges.length === 0) {
    badges.push({
      text: 'Safe',
      bg: '#28a745',
      title: 'Not found in known breaches (HIBP)'
    });
  }

  badges.forEach((badgeSpec, i) => {
    const badge = document.createElement('span');
    badge.dataset.soteriosBadge = input.dataset.soteriosId;
    badge.style.cssText = `
      position: absolute;
      top: ${-20 - i * 24}px; right: -20px;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      color: white;
      z-index: 2147483647;
      background: ${badgeSpec.bg};
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    `;
    badge.textContent = badgeSpec.text;
    badge.title = badgeSpec.title;
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(badge);
  });

  setTimeout(() => removeResult(input), 5000);
}

function removeResult(input) {
  const badge = document.querySelector(`[data-soterios-badge="${input.dataset.soteriosId}"]`);
  if (badge) badge.remove();
}

function addIconToField(input) {
  if (input.dataset.soteriosId) return;

  const id = `soterios-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  input.dataset.soteriosId = id;

  const icon = createIcon();
  icon.dataset.forInput = id;
  document.body.appendChild(icon);
  positionIcon(icon, input);

  const updatePos = () => positionIcon(icon, input);
  window.addEventListener('scroll', updatePos, true);
  window.addEventListener('resize', updatePos);
  input.addEventListener('blur', () => setTimeout(() => icon.remove(), 200), { once: true });

  passwordFields.set(input, icon);
}

function scanForPasswordFields() {
  const inputs = document.querySelectorAll('input[type="password"]:not([data-soterios-id])');
  inputs.forEach(addIconToField);
  if (autoCheckEnabled) {
    inputs.forEach(setupAutoCheck);
  }
}

async function runAutoCheck(input) {
  const password = input.value;
  if (!password) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_PASSWORD', password });
    const reuse = await trackReuse(password, location.hostname);
    showResult(input, result, reuse);
    if (notifyDesktopEnabled && result && result.pwned && result.count > 0) {
      // Forward breach to desktop app for alerting
      await chrome.runtime.sendMessage({
        type: 'FORWARD_CREDENTIAL_LEAK',
        payload: { domain: location.hostname, count: result.count }
      });
    }
    if (reuse.reused) {
      await chrome.runtime.sendMessage({ type: 'REUSE_DETECTED', domain: location.hostname });
    }
  } catch (err) {
    console.error('[Soterios] Auto-check failed:', err);
  }
}

function setupAutoCheck(input) {
  if (autoCheckListeners.has(input)) return;

  const state = {};
  if (checkOnTypeEnabled) {
    state.onInput = () => {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => runAutoCheck(input), 1000);
    };
    input.addEventListener('input', state.onInput);
  } else {
    state.onBlur = () => runAutoCheck(input);
    input.addEventListener('blur', state.onBlur);
  }
  autoCheckListeners.set(input, state);
}

function teardownAutoCheck(input) {
  const state = autoCheckListeners.get(input);
  if (!state) return;
  if (state.onInput) input.removeEventListener('input', state.onInput);
  if (state.onBlur) input.removeEventListener('blur', state.onBlur);
  autoCheckListeners.delete(input);
}

function resyncAutoChecks() {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    teardownAutoCheck(input);
    setupAutoCheck(input);
  });
}

function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
    return;
  }

  scanForPasswordFields();

  observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.matches('input[type="password"]')) {
            addIconToField(node);
            if (autoCheckEnabled) setupAutoCheck(node);
          }
          node.querySelectorAll('input[type="password"]').forEach(input => {
            addIconToField(input);
            if (autoCheckEnabled) setupAutoCheck(input);
          });
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

async function loadSettings() {
  try {
    const { autoCheck, showIcon, notifyDesktop, checkOnType } = await chrome.storage.sync.get(['autoCheck', 'showIcon', 'notifyDesktop', 'checkOnType']);
    autoCheckEnabled = autoCheck !== false;
    notifyDesktopEnabled = notifyDesktop !== false;
    checkOnTypeEnabled = checkOnType === true;
    if (showIcon === false) {
      passwordFields.forEach((icon, input) => icon.remove());
      passwordFields.clear();
    }
  } catch (e) {
    autoCheckEnabled = true;
    notifyDesktopEnabled = true;
    checkOnTypeEnabled = false;
  }
}

if (typeof window !== 'undefined') {
  loadSettings().then(() => {
    init();
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    if (msg.settings.autoCheck !== undefined) {
      autoCheckEnabled = msg.settings.autoCheck;
      if (autoCheckEnabled) {
        document.querySelectorAll('input[type="password"]').forEach(setupAutoCheck);
      }
    }
    if (msg.settings.checkOnType !== undefined && msg.settings.checkOnType !== checkOnTypeEnabled) {
      checkOnTypeEnabled = msg.settings.checkOnType;
      if (autoCheckEnabled) resyncAutoChecks();
    }
    if (msg.settings.notifyDesktop !== undefined) {
      notifyDesktopEnabled = msg.settings.notifyDesktop;
    }
    if (msg.settings.showIcon === false) {
      passwordFields.forEach((icon, input) => icon.remove());
      passwordFields.clear();
    } else if (msg.settings.showIcon === true) {
      scanForPasswordFields();
    }
  }
});