const MAX_REUSE_ENTRIES = 200;

async function computeSha256(password) {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function checkReuse(map, hash, hostname) {
  for (const domain of Object.keys(map)) {
    if (domain === hostname) continue;
    const entry = map[domain];
    if (entry && entry.hash === hash) {
      return { reused: true, otherDomain: domain };
    }
  }
  return { reused: false, otherDomain: null };
}

function storeReuse(map, hash, hostname, now) {
  const next = Object.assign({}, map);
  const existing = next[hostname];
  next[hostname] = { hash, lastSeen: existing ? Math.max(existing.lastSeen, now) : now };

  const keys = Object.keys(next);
  if (keys.length > MAX_REUSE_ENTRIES) {
    let oldestKey = null;
    let oldestSeen = Infinity;
    for (const key of keys) {
      if (key === hostname) continue;
      const seen = next[key].lastSeen;
      if (seen < oldestSeen) {
        oldestSeen = seen;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) delete next[oldestKey];
  }

  return next;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAX_REUSE_ENTRIES, computeSha256, checkReuse, storeReuse };
}