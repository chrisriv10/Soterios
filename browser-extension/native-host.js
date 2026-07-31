#!/usr/bin/env node
/**
 * Soterios Native Messaging Host
 * Bridges browser extension <-> desktop Electron app via stdin/stdout JSON messages
 * First attempts to connect via named pipe (if app is running), falls back to launching app
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

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

// Persistent stream parser to avoid listener accumulation
let messageBuffer = Buffer.alloc(0);
let messageResolver = null;

function readMessage() {
  return new Promise((resolve, reject) => {
    messageResolver = { resolve, reject };
    tryParseBuffer();
  });
}

function tryParseBuffer() {
  if (!messageResolver) return;

  while (messageBuffer.length >= 4) {
    const len = messageBuffer.readUInt32LE(0);
    if (messageBuffer.length < 4 + len) break;

    const msgBuf = messageBuffer.subarray(4, 4 + len);
    messageBuffer = messageBuffer.subarray(4 + len);

    try {
      const msg = JSON.parse(msgBuf.toString('utf8'));
      messageResolver.resolve(msg);
      messageResolver = null;
      return;
    } catch (e) {
      messageResolver.reject(new Error(`Failed to parse message: ${e.message}`));
      messageResolver = null;
      return;
    }
  }
}

// Set up persistent stdin listener once
process.stdin.on('data', (chunk) => {
  messageBuffer = Buffer.concat([messageBuffer, chunk]);
  tryParseBuffer();
});

process.stdin.on('error', (err) => {
  if (messageResolver) {
    messageResolver.reject(err);
    messageResolver = null;
  }
});

process.stdin.on('end', () => {
  if (messageResolver) {
    messageResolver.reject(new Error('Stream ended'));
    messageResolver = null;
  }
});

let desktopClient = null;
let desktopProc = null;

async function connectToDesktopApp() {
  const pipeName = process.platform === 'win32' ? '\\\\.\\pipe\\soterios-credential-safety' : '/tmp/soterios-credential-safety.sock';
  
  return new Promise((resolve, reject) => {
    const client = net.createConnection(pipeName, () => {
      log('Connected to desktop app via named pipe');
      resolve(client);
    });
    
    client.on('error', (err) => {
      log('Named pipe connection failed:', err.message);
      reject(err);
    });
  });
}

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
      // Try to connect via named pipe first
      try {
        if (!desktopClient) {
          desktopClient = await connectToDesktopApp();
        }
        if (desktopClient) {
          desktopClient.write(JSON.stringify({ type: 'CREDENTIAL_LEAK', ...msg.payload }) + '\n');
        }
        send({ type: 'LEAK_NOTIFIED', ok: true, original: msg });
      } catch (pipeErr) {
        log('Pipe connection failed, launching desktop app:', pipeErr.message);
        await launchDesktopApp();
        send({ type: 'LEAK_NOTIFIED', ok: true, original: msg });
      }
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

async function main() {
  log('Starting native messaging host');

  // Try to connect to desktop app on startup
  try {
    desktopClient = await connectToDesktopApp();
  } catch (e) {
    log('Desktop app not running on startup, will launch when needed');
  }

  while (true) {
    try {
      const msg = await readMessage();
      await handleMessage(msg);
    } catch (e) {
      if (e.message.includes('Stream ended') || e.message.includes('Unexpected end of JSON')) {
        break;
      }
      log('Error processing message:', e.message);
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

main().catch(e => {
  log('Fatal:', e);
  process.exit(1);
});