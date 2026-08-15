chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const { externalLookupsEnabled } = await chrome.storage.sync.get('externalLookupsEnabled');
    if (externalLookupsEnabled === undefined) {
      await chrome.storage.sync.set({ externalLookupsEnabled: true });
    }
  }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_PASSWORD' && msg.password) {
    checkPassword(msg.password).then(result => {
      if (result && result.pwned && sender.tab) {
        setBadge(sender.tab.id, '#dc3545');
      }
      sendResponse(result);
    });
    return true; // async response
  }

  if (msg.type === 'PING_DESKTOP') {
    pingDesktopApp().then(sendResponse);
    return true;
  }

  if (msg.type === 'FORWARD_CREDENTIAL_LEAK') {
    chrome.storage.sync.get('notifyDesktop').then(prefs => {
      if (prefs.notifyDesktop === false) {
        sendResponse({ ok: false, error: 'Desktop notifications disabled' });
        return;
      }
      notifyDesktopApp(msg.payload).then(sendResponse);
    });
    return true;
  }

  if (msg.type === 'REUSE_DETECTED') {
    if (sender.tab && !pwnedTabs.get(sender.tab.id)) {
      setBadge(sender.tab.id, '#f59e0b');
    }
  }

  if (msg.type === 'SETTINGS_UPDATED') {
    broadcastSettings(msg.settings);
  }
});

const pwnedTabs = new Map();

function setBadge(tabId, color) {
  if (color === '#dc3545') pwnedTabs.set(tabId, true);
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  chrome.action.setBadgeText({ text: '!', tabId });
}

function clearBadge(tabId) {
  pwnedTabs.delete(tabId);
  chrome.action.setBadgeText({ text: '', tabId });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') clearBadge(tabId);
});

// Native messaging port for desktop app communication
let nativePort = null;

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

function handleNativeMessage(msg) {
  console.log('[Soterios] Native message:', msg);
  // Handle responses from desktop app if needed
}

function pingDesktopApp() {
  return new Promise((resolve) => {
    if (!nativePort) {
      connectNative();
    }
    if (!nativePort) {
      return resolve({ ok: false, error: 'No native port' });
    }

    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'Timeout' });
    }, 1000);

    const onMessage = (msg) => {
      if (msg.type === 'PONG') {
        clearTimeout(timeout);
        resolve({ ok: true });
      }
    };

    // Add temporary listener
    nativePort.onMessage.addListener(onMessage);
    nativePort.postMessage({ type: 'PING' });

    // Cleanup after timeout
    setTimeout(() => {
      nativePort.onMessage.removeListener(onMessage);
    }, 1000);
  });
}

function notifyDesktopApp(payload) {
  return new Promise((resolve) => {
    if (!nativePort) {
      connectNative();
    }
    if (!nativePort) {
      return resolve({ ok: false, error: 'No native port' });
    }

    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'No response from desktop app' });
    }, 2000);

    const onMessage = (msg) => {
      if (msg.type === 'LEAK_NOTIFIED') {
        clearTimeout(timeout);
        nativePort.onMessage.removeListener(onMessage);
        resolve({ ok: true });
      }
    };

    nativePort.onMessage.addListener(onMessage);
    nativePort.postMessage({ type: 'CREDENTIAL_LEAK', domain: payload.domain, count: payload.count });
  });
}

function broadcastSettings(settings) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings });
    }
  });
}

async function checkPassword(password) {
  // Respect hibpEnabled setting
  const { hibpEnabled } = await chrome.storage.sync.get('hibpEnabled');
  if (hibpEnabled === false) {
    return { error: 'HIBP checks disabled' };
  }

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