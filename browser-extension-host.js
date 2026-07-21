#!/usr/bin/env node
/**
 * Soterios Native Messaging Host
 * Receives messages from browser extension and forwards to desktop app
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function readMessage() {
  return new Promise((resolve, reject) => {
    const lenBuf = Buffer.alloc(4);
    let read = 0;
    process.stdin.on('readable', () => {
      const chunk = process.stdin.read(4 - read);
      if (chunk) {
        chunk.copy(lenBuf, read);
        read += chunk.length;
        if (read === 4) {
          const len = lenBuf.readUInt32LE(0);
          const msgBuf = Buffer.alloc(len);
          let msgRead = 0;
          process.stdin.on('readable', () => {
            const chunk = process.stdin.read(len - msgRead);
            if (chunk) {
              chunk.copy(msgBuf, msgRead);
              msgRead += chunk.length;
              if (msgRead === len) {
                resolve(JSON.parse(msgBuf.toString('utf8')));
              }
            }
          });
        }
      }
    });
    process.stdin.on('error', reject);
  });
}

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