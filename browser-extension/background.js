chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ externalLookupsEnabled: true });
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