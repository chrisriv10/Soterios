importScripts('threatChecks.js');

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

  if (msg.type === 'GET_DESKTOP_THEME') {
    getDesktopTheme().then(sendResponse);
    return true;
  }

  if (msg.type === 'CHECK_URL_THREAT' && msg.url) {
    checkUrlThreat(msg.url).then(sendResponse);
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

  if (msg.type === 'FORWARD_THREAT' && msg.payload && msg.payload.domain && msg.payload.threatType) {
    chrome.storage.sync.get(['notifyDesktop', 'privacyMode']).then(prefs => {
      if (prefs.notifyDesktop === false) {
        sendResponse({ ok: false, error: 'Desktop notifications disabled' });
        return;
      }
      if (prefs.privacyMode === true) {
        sendResponse({ ok: false, error: 'Blocked by Privacy Mode' });
        return;
      }
      notifyThreatDesktop(msg.payload).then(sendResponse);
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
const threatCache = new Map();

async function checkUrlThreat(rawUrl) {
  const { privacyMode, safeBrowsingEnabled, safeBrowsingApiKey } = await chrome.storage.sync.get(['privacyMode', 'safeBrowsingEnabled', 'safeBrowsingApiKey']);
  if (privacyMode === true) return { status: 'disabled', reason: 'Privacy Mode' };
  if (safeBrowsingEnabled === false || !safeBrowsingApiKey) return { status: 'not_configured' };

  let origin;
  try {
    origin = new URL(rawUrl).origin;
  } catch (e) {
    origin = rawUrl;
  }

  const cached = threatCache.get(origin);
  if (cached && cached.expiresAt && cached.expiresAt > Date.now()) {
    return { status: cached.status, threatType: cached.threatType, expiresAt: cached.expiresAt, cached: true };
  }

  const result = await runSafeBrowsingCheck({ url: rawUrl, apiKey: safeBrowsingApiKey, fetchFn: fetch, now: Date.now() });
  if (result.status === 'unsafe' || result.status === 'safe') {
    threatCache.set(origin, { status: result.status, threatType: result.threatType, expiresAt: result.expiresAt });
  }
  return result;
}

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

function notifyThreatDesktop(payload) {
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
      if (msg.type === 'THREAT_NOTIFIED') {
        clearTimeout(timeout);
        nativePort.onMessage.removeListener(onMessage);
        resolve({ ok: true });
      }
    };

    nativePort.onMessage.addListener(onMessage);
    nativePort.postMessage({ type: 'THREAT_DETECTED', domain: payload.domain, threatType: payload.threatType });
  });
}

function getDesktopTheme() {
  return new Promise((resolve) => {
    if (!nativePort) {
      connectNative();
    }
    if (!nativePort) {
      return resolve({ theme: null });
    }

    const timeout = setTimeout(() => {
      nativePort.onMessage.removeListener(onMessage);
      resolve({ theme: null });
    }, 1500);

    const onMessage = (msg) => {
      if (msg.type === 'THEME') {
        clearTimeout(timeout);
        nativePort.onMessage.removeListener(onMessage);
        resolve({ theme: msg.theme || null });
      }
    };

    nativePort.onMessage.addListener(onMessage);
    nativePort.postMessage({ type: 'GET_THEME' });
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
  // Respect privacyMode and hibpEnabled settings
  const { hibpEnabled, privacyMode } = await chrome.storage.sync.get(['hibpEnabled', 'privacyMode']);
  if (privacyMode === true) {
    return { error: 'Disabled by Privacy Mode' };
  }
  if (hibpEnabled === false) {
    return { error: 'HIBP checks disabled' };
  }
  return runHibpCheck({ password, fetchFn: fetch });
}

// Connect to native host on startup
connectNative();

// Reconnect if native host disconnects
chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'native-reconnect') {
    connectNative();
  }
});