const si = require('systeminformation');
/**
 * Collect active network interface and connection information.
 *
 * @returns {Promise<{defaultGateway: Object|null, interfaces: Array, establishedConnectionCount: number, activeConnections: Array}>} Network summary.
 */
module.exports = async function networkReport() {
  const [interfaces, gateway, connections] = await Promise.all([si.networkInterfaces(), si.networkGatewayDefault().catch(() => null), si.networkConnections().catch(() => [])]);
  const activeConnections = connections.filter((c) => c.state === 'ESTABLISHED').slice(0, 80).map((c) => ({ protocol: c.protocol, localAddress: c.localAddress, localPort: c.localPort, peerAddress: c.peerAddress, peerPort: c.peerPort, process: c.process, pid: c.pid }));
  return { defaultGateway: gateway, interfaces: interfaces.map((i) => ({ iface: i.iface, ip4: i.ip4, ip6: i.ip6, mac: i.mac, type: i.type, operstate: i.operstate, speed: i.speed, dhcp: i.dhcp })), establishedConnectionCount: connections.filter((c) => c.state === 'ESTABLISHED').length, activeConnections };
};
