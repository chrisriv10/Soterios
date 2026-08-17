/**
 * Soterios Browser Extension - Content Script
 * Detects password fields, monitors for credential entry, and shows breach indicators
 */

let soteriosIcon = null;
let passwordFields = new Map();
let observer = null;

/**
 * Creates the Soterios password-check icon element.
 *
 * @returns {HTMLImageElement} Icon element.
 */
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

/**
 * Positions the icon next to a password input element.
 *
 * @param {HTMLImageElement} icon - Icon to position.
 * @param {HTMLInputElement} input - Target password input.
 */
function positionIcon(icon, input) {
  const rect = input.getBoundingClientRect();
  icon.style.top = `${rect.top + window.scrollY + (rect.height - 16) / 2}px`;
  icon.style.left = `${rect.right + window.scrollX - 20}px`;
}

/**
 * Handles icon click by checking the password via the background script.
 *
 * @param {MouseEvent} e - Click event.
 */
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

/**
 * Shows a breach-result badge on a password field.
 *
 * @param {HTMLInputElement} input - Password input element.
 * @param {{pwned: boolean, count: number}} result - Check result.
 */
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

/**
 * Removes the breach-result badge from a password field.
 *
 * @param {HTMLInputElement} input - Password input element.
 */
function removeResult(input) {
  const badge = document.querySelector(`[data-soterios-badge="${input.dataset.soteriosId}"]`);
  if (badge) badge.remove();
}

/**
 * Attaches the Soterios icon to a password input field.
 *
 * @param {HTMLInputElement} input - Password input element.
 */
function addIconToField(input) {
  if (input.dataset.soteriosId) return;

  const id = `soterios-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  input.dataset.soteriosId = id;

  const icon = createIcon();
  icon.dataset.forInput = id;
  document.body.appendChild(icon);
  positionIcon(icon, input);

  /**
   * Repositions the icon next to its input (used for scroll/resize).
   */
  const updatePos = () => positionIcon(icon, input);
  window.addEventListener('scroll', updatePos, true);
  window.addEventListener('resize', updatePos);
  input.addEventListener('blur', () => setTimeout(() => icon.remove(), 200), { once: true });

  passwordFields.set(input, icon);
}

/**
 * Repositions all attached icons (e.g. after scroll/resize).
 */
function updatePos() {
  for (const [input, icon] of passwordFields) {
    positionIcon(icon, input);
  }
}

/**
 * Scans the current document for unattached password fields.
 */
function scanForPasswordFields() {
  const inputs = document.querySelectorAll('input[type="password"]:not([data-soterios-id])');
  inputs.forEach(addIconToField);
}

/**
 * Initializes the content script: scans for password fields and watches for DOM changes.
 */
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
      passwordFields.forEach((icon, input) => icon.remove());
      passwordFields.clear();
    } else {
      scanForPasswordFields();
    }
  }
});