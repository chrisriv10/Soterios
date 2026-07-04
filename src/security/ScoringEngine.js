/**
 * ScoringEngine - Classifies network connections based on various factors
 * Uses heuristics to classify connections as SAFE, UNKNOWN, or MALICIOUS
 */

const { ServiceNames } = require('./ServiceNames');

class ScoringEngine {
  /**
   * Classify a network connection
   * @param {object} connection - Connection object with ip, port, etc.
   * @param {boolean} isBlocklisted - Whether the IP is in a blocklist
   * @returns {string} Classification: 'SAFE', 'UNKNOWN', or 'MALICIOUS'
   */
  static classify(connection, isBlocklisted = false) {
    const { remoteAddress, remotePort } = connection;

    // If the IP is blocklisted, it's malicious
    if (isBlocklisted) {
      return 'MALICIOUS';
    }

    // Check if it's a private IP address
    if (ScoringEngine.isPrivateIp(remoteAddress)) {
      return 'SAFE';
    }

    // Check if it's a loopback address
    if (ScoringEngine.isLoopback(remoteAddress)) {
      return 'SAFE';
    }

    // Check if it's a well-known service on a common port
    if (remotePort && ServiceNames.isCommonPort(remotePort)) {
      // Common ports are generally safe, but we still mark as UNKNOWN
      // since we can't be certain without more context
      return 'UNKNOWN';
    }

    // Default to UNKNOWN for public IPs
    return 'UNKNOWN';
  }

  /**
   * Check if an IP address is private (RFC 1918)
   * @param {string} ip - IP address
   * @returns {boolean}
   */
  static isPrivateIp(ip) {
    if (!ip || typeof ip !== 'string') return false;

    // IPv4 private ranges
    const privateRanges = [
      /^10\./,                    // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
      /^192\.168\./,              // 192.168.0.0/16
      /^127\./,                   // 127.0.0.0/8 (loopback)
      /^169\.254\./,              // 169.254.0.0/16 (link-local)
      /^::1$/,                    // IPv6 loopback
      /^fe80:/i,                  // IPv6 link-local
      /^fc00:/i,                  // IPv6 unique local
      /^fd00:/i                   // IPv6 unique local
    ];

    return privateRanges.some(range => range.test(ip));
  }

  /**
   * Check if an IP address is loopback
   * @param {string} ip - IP address
   * @returns {boolean}
   */
  static isLoopback(ip) {
    if (!ip || typeof ip !== 'string') return false;
    return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');
  }

  /**
   * Get a human-readable description for a classification
   * @param {string} classification - Classification string
   * @returns {string} Description
   */
  static getDescription(classification) {
    const descriptions = {
      'SAFE': 'Trusted network connection',
      'UNKNOWN': 'Connection to public IP',
      'MALICIOUS': 'Known malicious IP'
    };
    return descriptions[classification] || 'Unknown classification';
  }
}

module.exports = { ScoringEngine };
