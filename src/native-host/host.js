const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { MAX_FRAME_BYTES, createFrameDecoder, encodeFrame, getPipeName, normalizeEnvelope } = require('./protocol');

const executableDir = path.dirname(process.execPath);
const configPath = path.join(executableDir, 'native-host-config.json');
let inputQueue = Promise.resolve();

function send(value) { process.stdout.write(encodeFrame(value)); }
function errorResponse(requestId, code, message) { return { protocol: 2, requestId: requestId || 'invalid_request', ok: false, error: { code, message } }; }

function loadConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const appPath = path.resolve(String(value.appPath || ''));
    if (!appPath.toLowerCase().endsWith('.exe') || !fs.existsSync(appPath)) return { appPath: '', pipeName: getPipeName() };
    return { appPath, pipeName: getPipeName() };
  } catch (_) { return { appPath: '', pipeName: getPipeName() }; }
}

function connectPipe(pipeName, timeoutMs = 600) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeName); let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; socket.destroy(); reject(new Error('DESKTOP_NOT_RUNNING')); } }, timeoutMs);
    socket.once('connect', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(socket); } });
    socket.once('error', () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('DESKTOP_NOT_RUNNING')); } });
  });
}

function launchDesktop(appPath) {
  if (!appPath) throw new Error('DESKTOP_NOT_INSTALLED');
  const child = spawn(appPath, [], { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
  child.unref();
}

async function getDesktopSocket(config, mayLaunch) {
  try { return await connectPipe(config.pipeName); } catch (firstError) {
    if (!mayLaunch) throw firstError;
    launchDesktop(config.appPath);
    let delay = 120;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      try { return await connectPipe(config.pipeName, 1000); } catch (_) { delay = Math.min(delay * 2, 1500); }
    }
    throw new Error('DESKTOP_PIPE_UNAVAILABLE');
  }
}

async function forward(envelope) {
  const config = loadConfig();
  const mayLaunch = envelope.type === 'REPORT_FINDING' || envelope.type === 'OPEN_APP';
  const socket = await getDesktopSocket(config, mayLaunch);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('DESKTOP_TIMEOUT')); }, 5000);
    const decode = createFrameDecoder((message) => { if (message.requestId !== envelope.requestId) return; clearTimeout(timer); socket.end(); resolve(message); }, (error) => { clearTimeout(timer); socket.destroy(); reject(error); });
    socket.on('data', decode); socket.once('error', (error) => { clearTimeout(timer); reject(error); }); socket.write(encodeFrame(envelope));
  });
}

async function handle(raw) {
  const normalized = normalizeEnvelope(raw);
  if (!normalized.ok) { send(errorResponse(raw?.requestId, normalized.error, 'The native message was rejected.')); return; }
  try {
    const result = await forward(normalized.envelope);
    send(normalized.legacy ? { type: 'LEGACY_RESPONSE', ok: result.ok !== false } : result);
  } catch (error) {
    const code = ['DESKTOP_NOT_RUNNING', 'DESKTOP_NOT_INSTALLED', 'DESKTOP_PIPE_UNAVAILABLE', 'DESKTOP_TIMEOUT'].includes(error.message) ? error.message : 'NATIVE_BRIDGE_ERROR';
    send(errorResponse(normalized.envelope.requestId, code, code === 'DESKTOP_NOT_RUNNING' ? 'The native host is installed, but the desktop app is not running.' : 'The local desktop bridge is unavailable.'));
  }
}

const decodeInput = createFrameDecoder((message) => { inputQueue = inputQueue.then(() => handle(message)).catch(() => {}); }, () => { send(errorResponse('invalid_request', 'INVALID_FRAME', 'The native frame was malformed.')); process.exitCode = 1; });
process.stdin.on('data', (chunk) => { if (chunk.length <= MAX_FRAME_BYTES + 4) decodeInput(chunk); else { send(errorResponse('invalid_request', 'FRAME_TOO_LARGE', 'The native frame exceeded 64 KiB.')); process.exit(1); } });
process.stdin.resume();
