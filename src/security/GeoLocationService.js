const https = require('https');

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Soterios',
        ...options.headers
      }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

class GeoLocationService {
  constructor(db) {
    this.db = db;
    this.pending = new Map();
  }

  async lookup(ip) {
    if (!ip) return null;

    // Check DB cache
    const cached = this.db.getGeoCache(ip);
    if (cached) {
      try {
        return JSON.parse(cached.raw_data);
      } catch (e) {
        // parse error, ignore and re-fetch
      }
    }

    if (this.pending.has(ip)) {
      return this.pending.get(ip);
    }

    const promise = this._fetch(ip).finally(() => {
      this.pending.delete(ip);
    });

    this.pending.set(ip, promise);
    return promise;
  }

  async _fetch(ip) {
    try {
      const res = await requestText(`https://ipwho.is/${encodeURIComponent(ip)}`);
      if (res.statusCode !== 200) return null;
      const data = JSON.parse(res.body || '{}');
      if (data.success === false) return null;

      const result = {
        lat: data.latitude,
        lon: data.longitude,
        country: data.country,
        city: data.city,
        region: data.region
      };

      this.db.setGeoCache(ip, JSON.stringify(result));
      return result;
    } catch (e) {
      return null;
    }
  }
}

module.exports = { GeoLocationService };
