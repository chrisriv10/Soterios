const net = require('net');
const { createFrameDecoder, encodeFrame, getPipeName, normalizeEnvelope } = require('../native-host/protocol');

class ExtensionBridge {
  constructor({ db, eventBus, getTheme, openApp, log }) {
    this.db = db; this.eventBus = eventBus; this.getTheme = getTheme; this.openApp = openApp; this.log = log || (() => {});
    this.server = null; this.connections = new Set(); this.lastConnectedAt = null;
  }

  start() {
    if (process.platform !== 'win32' || this.server) return;
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (error) => this.log('warn', 'Extension bridge error', { error: error.message }));
    this.server.listen(getPipeName());
  }

  handleConnection(socket) {
    this.connections.add(socket); this.lastConnectedAt = new Date().toISOString();
    socket.on('close', () => this.connections.delete(socket));
    const decode = createFrameDecoder((message) => void this.handleMessage(socket, message), (error) => { this.reply(socket, 'invalid_request', false, null, 'INVALID_FRAME', error.message); socket.destroy(); });
    socket.on('data', decode);
  }

  reply(socket, requestId, ok, payload, code, message) {
    if (socket.destroyed) return;
    socket.write(encodeFrame({ protocol: 2, requestId, ok, ...(ok ? { payload } : { error: { code, message } }) }));
  }

  async handleMessage(socket, message) {
    const normalized = normalizeEnvelope(message);
    if (!normalized.ok) { this.reply(socket, message?.requestId || 'invalid_request', false, null, normalized.error, 'The desktop bridge rejected this message.'); return; }
    const { requestId, type, payload } = normalized.envelope;
    try {
      if (type === 'HELLO') return this.reply(socket, requestId, true, { protocol: 2, capabilities: ['finding-summaries', 'theme', 'open-app'], desktopRunning: true });
      if (type === 'PING') return this.reply(socket, requestId, true, { pong: true, desktopRunning: true });
      if (type === 'GET_THEME') return this.reply(socket, requestId, true, { theme: this.getTheme() });
      if (type === 'OPEN_APP') { this.openApp(); return this.reply(socket, requestId, true, { opened: true }); }
      if (type === 'REPORT_FINDING') {
        const prevalence = payload.prevalenceCount ? ` Seen ${payload.prevalenceCount} times in the breach corpus.` : '';
        const alert = {
          level: payload.severity,
          source: 'Browser Extension',
          title: payload.category === 'credential_breach' ? 'Credential finding' : 'Browser protection finding',
          message: `${payload.category.replaceAll('_', ' ')}${payload.domain ? ` on ${payload.domain}` : ''}.${prevalence}`,
          detail: `Category: ${payload.category} | Severity: ${payload.severity}`,
          timestamp: new Date().toISOString(),
          metadata: { source: 'browser-extension-v2', category: payload.category, severity: payload.severity, ...(payload.domain ? { domain: payload.domain } : {}), ...(payload.prevalenceCount ? { prevalenceCount: payload.prevalenceCount } : {}) }
        };
        this.db.addAlert(alert); this.eventBus?.emit('alert:new', alert);
        return this.reply(socket, requestId, true, { accepted: true });
      }
      this.reply(socket, requestId, false, null, 'UNSUPPORTED_TYPE', 'Unsupported native message type.');
    } catch (error) { this.reply(socket, requestId, false, null, 'DESKTOP_ERROR', error.message || String(error)); }
  }

  getStatus() { return { listening: Boolean(this.server), connected: this.connections.size > 0, lastConnectedAt: this.lastConnectedAt, pipeName: getPipeName() }; }
  stop() { for (const socket of this.connections) socket.destroy(); this.connections.clear(); this.server?.close(); this.server = null; }
}

module.exports = { ExtensionBridge };
