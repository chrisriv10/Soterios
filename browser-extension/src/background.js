/**
 * Browser extension background service worker.
 *
 * Handles extension install defaults and bridges password-leak checks
 * between the content script and the Soterios native host.
 */

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const { externalLookupsEnabled } = await chrome.storage.sync.get('externalLookupsEnabled');
    if (externalLookupsEnabled === undefined) {
      await chrome.storage.sync.set({ externalLookupsEnabled: true });
    }
  }
});

// Handle CHECK_PASSWORD from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_PASSWORD' && msg.password) {
    checkPassword(msg.password).then(sendResponse);
    return true; // async response
  }
});

// Native messaging port for desktop app communication
let nativePort = null;

/**
 * Establishes a native messaging connection to the Soterios desktop app.
 */
function connectNative() {
  try {
    nativePort = chrome.runtime.connectNative('com.soterios.credential_safety');
    nativePort.onDisconnect.addListener(() => {
      console.log('[Soterios] Native host disconnected');
      nativePort = null;
    });
    nativePort.onMessage.addListener(handleNativeMessage);
  } catch (e) {
    console.log('[Soterios] Native host connection failed:', e.message);
  }
}

/**
 * Handles incoming native messages from the desktop app.
 *
 * @param {Object} msg - Message payload.
 */
function handleNativeMessage(msg) {
  console.log('[Soterios] Native message:', msg);
  // Handle responses from desktop app if needed
}

/**
 * Checks a password against the HIBP Pwned Passwords API.
 *
 * @param {string} password - Password to check.
 * @returns {Promise<{pwned: boolean, count: number}>} Breach check result.
 */
async function checkPassword(password) {
  const HIBP_API = 'https://api.pwnedpasswords.com/range/';
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  
  try {
    const resp = await fetch(`${HIBP_API}${prefix}`);
    const text = await resp.text();
    const lines = text.trim().split('\n');
    
    for (const line of lines) {
      const [suf, count] = line.split(':');
      if (suf === suffix) {
        return { pwned: true, count: parseInt(count, 10) };
      }
    }
    return { pwned: false, count: 0 };
  } catch (e) {
    console.error('[Soterios] HIBP check failed:', e);
    return { error: e.message };
  }
}

// Connect to native host on startup
connectNative();

// Reconnect if native host disconnects
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'native-reconnect') {
    connectNative();
  }
});