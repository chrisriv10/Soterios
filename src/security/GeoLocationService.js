const { requestText } = require('../main/ipc/_shared');

/**
 * GeoLocationService — looks up geographic data for an IP address.
 * Results are cached in the database to avoid redundant API calls.
 * In-flight requests are deduplicated so concurrent lookups for the
 * same IP only make one network request.
 */

/**
 * GeoLocationService — looks up geographic data for an IP address.
 * Results are cached in the database to avoid redundant API calls.
 * In-flight requests are deduplicated so concurrent lookups for the
 * same IP only make one network request.
 */
class GeoLocationService {
  /**
   * @param {{ getGeoCache: Function, setGeoCache: Function }} db - DatabaseService
   *   (or compatible object) used for persistent geo cache rows.
   */
  constructor(db) {
    this.db = db;
    /** @type {Map<string, Promise<object|null>>} */
    this.pending = new Map();
  }

  /**
   * Resolve geographic metadata for an IPv4/IPv6 address.
   * Flow: DB cache → join in-flight request → remote ipwho.is fetch.
   *
   * @param {string} ip - IP address to look up.
   * @returns {Promise<{lat:number, lon:number, country?:string, city?:string, region?:string}|null>}
   */
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

  /**
   * Fetch and cache geo data for an IP from the public API.
   * @param {string} ip
   * @returns {Promise<object|null>}
   * @private
   */
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
