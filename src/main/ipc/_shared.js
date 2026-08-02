const https = require('https');

const MAX_API_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Soterios',
        ...options.headers,
      },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_API_BODY_BYTES) {
          req.destroy(new Error('Response body exceeds size limit'));
          reject(new Error('Response too large'));
        }
      });
      res.on('end', () => {
        if (!req.destroyed) {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

module.exports = { requestText };
