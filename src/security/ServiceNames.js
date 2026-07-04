/**
 * ServiceNames - Maps well-known ports to service names
 */

const COMMON_PORTS = {
  20: 'FTP-Data',
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  67: 'DHCP',
  68: 'DHCP',
  80: 'HTTP',
  110: 'POP3',
  123: 'NTP',
  143: 'IMAP',
  161: 'SNMP',
  194: 'IRC',
  443: 'HTTPS',
  445: 'SMB',
  465: 'SMTPS',
  587: 'SMTP',
  636: 'LDAPS',
  993: 'IMAPS',
  995: 'POP3S',
  1433: 'MSSQL',
  1521: 'Oracle',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5900: 'VNC',
  6379: 'Redis',
  8080: 'HTTP-Alt',
  8443: 'HTTPS-Alt',
  8888: 'HTTP-Alt',
  9000: 'HTTP-Alt',
  9418: 'Git',
  27017: 'MongoDB'
};

class ServiceNames {
  /**
   * Get service name for a port number
   * @param {number} port - Port number
   * @returns {string} Service name or empty string if unknown
   */
  static getServiceName(port) {
    if (!port || typeof port !== 'number') return '';
    return COMMON_PORTS[port] || '';
  }

  /**
   * Check if a port is commonly used
   * @param {number} port - Port number
   * @returns {boolean}
   */
  static isCommonPort(port) {
    return port in COMMON_PORTS;
  }
}

module.exports = { ServiceNames };
