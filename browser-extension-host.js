#!/usr/bin/env node
/**
 * Soterios Native Messaging Host
 * Receives messages from browser extension and forwards to desktop app
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Persistent stream parser to avoid listener accumulation
let messageBuffer = Buffer.alloc(0);
let messageResolver = null;

function readMessage() {
  return new Promise((resolve, reject) => {
    messageResolver = { resolve, reject };
    // Try to parse any buffered data first
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

function sendMessage(msg) {
  const buf = Buffer.from(JSON.stringify(msg), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(buf.length, 0);
  process.stdout.write(lenBuf);
  process.stdout.write(buf);
}

async function connectToDesktopApp() {
  const pipeName = '\\\\.\\pipe\\soterios-credential-safety';
  return new Promise((resolve, reject) => {
    const client = require('net').createConnection(pipeName, () => {
      resolve(client);
    });
    client.on('error', reject);
  });
}

let desktopClient = null;

async function main() {
  console.error('[Soterios Host] Starting...');

  try {
    desktopClient = await connectToDesktopApp();
    console.error('[Soterios Host] Connected to desktop app');
  } catch (e) {
    console.error('[Soterios Host] Desktop app not running:', e.message);
  }

  while (true) {
    try {
      const msg = await readMessage();
      console.error('[Soterios Host] Received:', msg.type);

      if (msg.type === 'CREDENTIAL_LEAK') {
        if (desktopClient) {
          desktopClient.write(JSON.stringify({ type: 'CREDENTIAL_LEAK', ...msg.payload }) + '\n');
        }
        sendMessage({ ok: true });
      } else if (msg.type === 'PING') {
        sendMessage({ pong: true });
      }
    } catch (e) {
      if (e.message.includes('Unexpected end of JSON')) break;
      console.error('[Soterios Host] Error:', e.message);
    }
  }
}

main().catch(e => {
  console.error('[Soterios Host] Fatal:', e);
  process.exit(1);
});