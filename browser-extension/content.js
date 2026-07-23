/**
 * Soterios Browser Extension - Content Script
 * Detects password fields, monitors for credential entry, and shows breach indicators
 */

let soteriosIcon = null;
let passwordFields = new Map();
let observer = null;
let currentSettings = { showIcon: true, autoCheck: false };

// Load settings from storage
function loadSettings() {
  chrome.storage.sync.get(['showIcon', 'autoCheck'], (result) => {
    currentSettings.showIcon = result.showIcon !== false;
    currentSettings.autoCheck = result.autoCheck === true;
  });
}

// Listen for settings updates
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.showIcon !== undefined) {
      currentSettings.showIcon = changes.showIcon.newValue !== false;
    }
    if (changes.autoCheck !== undefined) {
      currentSettings.autoCheck = changes.autoCheck.newValue === true;
    }
  }
});

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

async function onIconClick(e) {
  const input = e.target.dataset.forInput;
  const el = document.querySelector(`[data-soterios-id="${input}"]`);
  if (!el) return;

  const password = el.value;
  if (!password) return;

  try {
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_PASSWORD', password });
    showResult(el, result);
  } catch (err) {
    console.error('[Soterios] Check failed:', err);
  }
}

function showResult(input, result) {
  removeResult(input);

  const badge = document.createElement('span');
  badge.dataset.soteriosBadge = input.dataset.soteriosId;
  badge.style.cssText = `
    position: absolute;
    top: -20px; right: -20px;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    color: white;
    z-index: 2147483647;
    background: ${result.pwned ? '#dc3545' : '#28a745'};
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  `;
  badge.textContent = result.pwned ? `Pwned ${result.count}x` : 'Safe';
  badge.title = result.pwned
    ? `Found in ${result.count} breach${result.count !== 1 ? 'es' : ''}. Change immediately.`
    : 'Not found in known breaches (HIBP)';
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(badge);

  setTimeout(() => removeResult(input), 5000);
}

function removeResult(input) {
  const badge = document.querySelector(`[data-soterios-badge="${input.dataset.soteriosId}"]`);
  if (badge) badge.remove();
}

function addIconToField(input) {
  if (input.dataset.soteriosId) return;
  
  // Check showIcon setting before adding icon
  if (!currentSettings.showIcon) return;

  const id = `soterios-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  input.dataset.soteriosId = id;

  const icon = createIcon();
  icon.dataset.forInput = id;
  document.body.appendChild(icon);
  positionIcon(icon, input);

  const updatePos = () => positionIcon(icon, input);
  window.addEventListener('scroll', updatePos, true);
  window.addEventListener('resize', updatePos);

  // Store handler references for cleanup
  icon._soteriosHandlers = { updatePos, scroll: true, resize: true };

  const cleanup = () => {
    if (icon._soteriosHandlers) {
      if (icon._soteriosHandlers.scroll) {
        window.removeEventListener('scroll', icon._soteriosHandlers.updatePos, true);
      }
      if (icon._soteriosHandlers.resize) {
        window.removeEventListener('resize', icon._soteriosHandlers.updatePos);
      }
      if (icon._soteriosHandlers.autoCheckHandler) {
        input.removeEventListener('input', icon._soteriosHandlers.autoCheckHandler);
      }
    }
    icon.remove();
    passwordFields.delete(input);
    delete input.dataset.soteriosId;
  };

  input.addEventListener('blur', () => setTimeout(cleanup, 200), { once: true });

  // Add autoCheck listener if enabled
  if (currentSettings.autoCheck) {
    const autoCheckHandler = async () => {
      const password = input.value;
      if (password && password.length >= 8) {
        try {
          const result = await chrome.runtime.sendMessage({ type: 'CHECK_PASSWORD', password });
          showResult(input, result);
        } catch (err) {
          console.error('[Soterios] Auto-check failed:', err);
        }
      }
    };
    input.addEventListener('input', autoCheckHandler);
    icon._soteriosHandlers.autoCheckHandler = autoCheckHandler;
  }

  passwordFields.set(input, icon);
}

function scanForPasswordFields() {
  const inputs = document.querySelectorAll('input[type="password"]:not([data-soterios-id])');
  inputs.forEach(addIconToField);
}

function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
    return;
  }

  loadSettings();
  scanForPasswordFields();

  observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.matches('input[type="password"]')) addIconToField(node);
          node.querySelectorAll('input[type="password"]').forEach(addIconToField);
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof window !== 'undefined') {
  init();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    if (!msg.settings.showIcon) {
      // Properly clean up all icons and their listeners
      passwordFields.forEach((icon, input) => {
        if (icon._soteriosHandlers) {
          if (icon._soteriosHandlers.scroll) {
            window.removeEventListener('scroll', icon._soteriosHandlers.updatePos, true);
          }
          if (icon._soteriosHandlers.resize) {
            window.removeEventListener('resize', icon._soteriosHandlers.updatePos);
          }
          if (icon._soteriosHandlers.autoCheckHandler) {
            input.removeEventListener('input', icon._soteriosHandlers.autoCheckHandler);
          }
        }
        icon.remove();
        delete input.dataset.soteriosId;
      });
      passwordFields.clear();
    } else {
      scanForPasswordFields();
    }
  }
});