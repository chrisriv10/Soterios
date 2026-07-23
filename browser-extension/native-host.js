#!/usr/bin/env node
/**
 * Soterios Native Messaging Host
 * Bridges browser extension <-> desktop Electron app via stdin/stdout JSON messages
 */

const { spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

function log(...args) {
  console.error('[Soterios Native Host]', new Date().toISOString(), ...args);
}

function send(msg) {
  const json = JSON.stringify(msg);
  const len = Buffer.byteLength(json);
  const buf = Buffer.alloc(4 + len);
  buf.writeUInt32LE(len, 0);
  buf.write(json, 4);
  process.stdout.write(buf);
}

function readMessages() {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  let buffer = Buffer.alloc(0);

  process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) break;

      const json = buffer.subarray(4, 4 + len).toString();
      buffer = buffer.subarray(4 + len);

      try {
        const msg = JSON.parse(json);
        handleMessage(msg);
      } catch (e) {
        log('Parse error:', e.message);
      }
    }
  });
}

let desktopProc = null;
const pending = new Map();
let msgId = 0;

function launchDesktopApp() {
  if (desktopProc) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const appPath = process.env.DESKTOP_APP || 'soterios://';
    
    // Check if it's a protocol URL or an executable path
    const isProtocolUrl = appPath.startsWith('soterios://') || appPath.startsWith('http://') || appPath.startsWith('https://');

    if (isProtocolUrl) {
      // Launch using OS-appropriate protocol handler
      const isWin = process.platform === 'win32';
      const args = isWin ? ['/c', 'start', '', appPath] : ['open', appPath];
      const cmd = isWin ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
      const options = { shell: false, detached: true };

      desktopProc = spawn(cmd, args, options);
      desktopProc.unref();

      desktopProc.on('error', e => {
        log('Desktop app launch error:', e.message);
        desktopProc = null;
      });

      setTimeout(resolve, 1500);
    } else {
      // Launch as executable path
      const resolvedPath = path.resolve(appPath);
      if (!fs.existsSync(resolvedPath)) {
        return reject(new Error('Desktop app not found at: ' + resolvedPath));
      }

      const isWin = process.platform === 'win32';
      const args = isWin ? ['/c', 'start', '""', resolvedPath] : [resolvedPath];
      const cmd = isWin ? 'cmd' : resolvedPath;
      const options = { shell: false, detached: true };

      desktopProc = spawn(cmd, args, options);
      desktopProc.unref();

      desktopProc.on('error', e => {
        log('Desktop app launch error:', e.message);
        desktopProc = null;
      });

      setTimeout(resolve, 1500);
    }
  });
}

async function handleMessage(msg) {
  log('Received:', msg.type);

  switch (msg.type) {
    case 'CREDENTIAL_LEAK': {
      await launchDesktopApp();
      send({ type: 'LEAK_NOTIFIED', ok: true, original: msg });
      break;
    }
    case 'PING': {
      send({ type: 'PONG', ok: true });
      break;
    }
    case 'OPEN_APP': {
      await launchDesktopApp();
      send({ type: 'APP_OPENED', ok: true });
      break;
    }
    default: {
      send({ type: 'ERROR', error: 'Unknown message type', original: msg });
    }
  }
}

process.on('uncaughtException', e => {
  log('Uncaught:', e);
  send({ type: 'ERROR', error: e.message });
});

process.on('unhandledRejection', e => {
  log('Unhandled rejection:', e);
});

log('Starting native messaging host');
readMessages();