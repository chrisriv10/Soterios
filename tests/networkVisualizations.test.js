'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const networkPath = path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'network.js');
const networkSource = fs.readFileSync(networkPath, 'utf8');

function translate(key, vars = {}) {
  return Object.entries(vars).reduce((value, [name, replacement]) => (
    value.replaceAll(`{${name}}`, String(replacement))
  ), key);
}

function makePage() {
  const sandbox = {
    window: { Pages: {}, I18n: { t: translate } },
    document: { body: { contains: () => false } },
    escapeHtml: (value) => String(value ?? ''),
    clearInterval: () => {},
    cancelAnimationFrame: () => {},
    requestAnimationFrame: () => 1,
    performance: { now: () => 0 },
    Map,
    Set,
    Date,
    Math
  };
  vm.runInNewContext(networkSource, sandbox, { filename: 'network.js' });
  return sandbox.window.Pages.network;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

function connection(ip, risk = 'SAFE', overrides = {}) {
  return {
    remoteAddress: ip,
    remotePort: 443,
    processName: 'browser.exe',
    serviceName: 'HTTPS',
    state: 'ESTABLISHED',
    classification: risk,
    ...overrides
  };
}

describe('adaptive geo activity model', () => {
  it('uses the specified clustering tiers at their exact boundaries', () => {
    const page = makePage();
    assert.deepEqual(plain(page._heatmapTierForZoom(1)), { id: 'world', lonStep: 18, latStep: 12, labelLimit: 0, nextZoom: 1.75 });
    assert.equal(page._heatmapTierForZoom(1.74).id, 'world');
    assert.deepEqual(plain(page._heatmapTierForZoom(1.75)), { id: 'region', lonStep: 8, latStep: 6, labelLimit: 12, nextZoom: 3.5 });
    assert.equal(page._heatmapTierForZoom(3.49).id, 'region');
    assert.deepEqual(plain(page._heatmapTierForZoom(3.5)), { id: 'street', lonStep: 3, latStep: 2.5, labelLimit: 30, nextZoom: 6 });
  });

  it('reclusters nearby endpoints only when the zoom tier changes', () => {
    const page = makePage();
    const connections = [connection('203.0.113.1'), connection('203.0.113.2')];
    const geo = {
      '203.0.113.1': { lat: 10, lon: 1, city: 'Alpha', country: 'Test' },
      '203.0.113.2': { lat: 10, lon: 10, city: 'Beta', country: 'Test' }
    };
    assert.equal(page._buildHeatmapClusters(connections, geo, 1).clusters.length, 1);
    assert.equal(page._buildHeatmapClusters(connections, geo, 1.74).clusters.length, 1);
    assert.equal(page._buildHeatmapClusters(connections, geo, 1.75).clusters.length, 2);
  });

  it('keeps risk composition, worst risk, details, and marker order', () => {
    const page = makePage();
    const connections = [
      connection('198.51.100.1', 'SAFE'),
      connection('198.51.100.2', 'UNKNOWN', { processName: 'sync.exe', remotePort: 53, serviceName: 'DNS' }),
      connection('198.51.100.3', 'MALICIOUS')
    ];
    const geo = {
      '198.51.100.1': { lat: 20, lon: 20, city: 'One', country: 'Test' },
      '198.51.100.2': { lat: 21, lon: 21, city: 'Two', country: 'Test' },
      '198.51.100.3': { lat: -20, lon: -20, city: 'Three', country: 'Test' }
    };
    const clusters = page._buildHeatmapClusters(connections, geo, 1).clusters;
    assert.equal(clusters[0].highestRisk, 'MALICIOUS');
    const mixed = clusters.find((cluster) => cluster.count === 2);
    assert.deepEqual(plain(mixed.risks), { SAFE: 1, UNKNOWN: 1, MALICIOUS: 0 });
    assert.equal(mixed.processes[0].label, 'browser.exe');
    assert.deepEqual(plain(mixed.ips), ['198.51.100.1', '198.51.100.2']);
  });

  it('limits permanent labels by tier and prioritizes the largest clusters', () => {
    const page = makePage();
    const connections = [];
    const geo = {};
    for (let index = 0; index < 35; index++) {
      const ip = `192.0.2.${index + 1}`;
      connections.push(connection(ip));
      geo[ip] = { lat: -80 + index * 4.5, lon: -170 + index * 9.7, city: `City ${index}`, country: 'Test' };
    }
    assert.equal(page._buildHeatmapClusters(connections, geo, 1).clusters.filter((cluster) => cluster.showLabel).length, 0);
    assert.ok(page._buildHeatmapClusters(connections, geo, 2).clusters.filter((cluster) => cluster.showLabel).length <= 12);
    assert.ok(page._buildHeatmapClusters(connections, geo, 4).clusters.filter((cluster) => cluster.showLabel).length <= 30);
  });

  it('persists selection by IP when a tier change replaces cluster IDs', () => {
    const page = makePage();
    const connections = [connection('203.0.113.8'), connection('203.0.113.9')];
    const geo = {
      '203.0.113.8': { lat: 10, lon: 1 },
      '203.0.113.9': { lat: 10, lon: 10 }
    };
    const low = page._buildHeatmapClusters(connections, geo, 1).clusters[0];
    const high = page._buildHeatmapClusters(connections, geo, 2).clusters;
    const selected = page._resolveHeatmapSelection(high, low.id, low.ips);
    assert.ok(selected);
    assert.ok(selected.ips.some((ip) => low.ips.includes(ip)));
  });

  it('only creates a home anchor for finite, valid coordinates', () => {
    const page = makePage();
    assert.equal(page._validHeatmapHome(null), null);
    assert.equal(page._validHeatmapHome({ lat: 91, lon: 0 }), null);
    assert.equal(page._validHeatmapHome({ lat: 0, lon: Number.NaN }), null);
    assert.deepEqual(plain(page._validHeatmapHome({ lat: 0, lon: 0 })), { lat: 0, lon: 0, x: 50, y: 50 });
  });

  it('uses the shared projection for the home marker and endpoint clusters', () => {
    const page = makePage();
    const expected = page._projectHeatmapCoordinate(41.88, -87.88);
    assert.ok(Math.abs(expected.x - 25.5889) < 0.001);
    assert.ok(Math.abs(expected.y - 26.7333) < 0.001);
    assert.deepEqual(plain(page._validHeatmapHome({ lat: 41.88, lon: -87.88 })), {
      lat: 41.88, lon: -87.88, ...plain(expected)
    });
    const cluster = page._buildHeatmapClusters(
      [connection('198.51.100.20')],
      { '198.51.100.20': { lat: 41.88, lon: -87.88 } },
      1
    ).clusters[0];
    assert.deepEqual({ x: cluster.x, y: cluster.y }, plain(expected));
  });

  it('stretches the map mask over the same coordinate plane as markers', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'css', 'visualizations.css'), 'utf8');
    const mapStart = css.indexOf('.heatmap-map-skin::before');
    const mapEnd = css.indexOf('.heatmap-map-skin::after', mapStart);
    const mapRules = css.slice(mapStart, mapEnd);
    assert.match(mapRules, /mask:\s*url\('\.\.\/img\/world-map-equirect\.svg'\) center \/ 100% 100% no-repeat/);
    assert.doesNotMatch(mapRules, /contain/);
    const map = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'img', 'world-map-equirect.svg'), 'utf8');
    assert.match(map, /viewBox="0 0 360 180"/);
    assert.match(map, /<g class="country /);
  });

  it('keeps the cluster drawer matched to the map height with an internal scroll area', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'css', 'visualizations.css'), 'utf8');
    const widgetStart = css.indexOf('.heatmap-widget {');
    const widgetEnd = css.indexOf('.heatmap-viewport {', widgetStart);
    const widgetRules = css.slice(widgetStart, widgetEnd);
    assert.match(widgetRules, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    assert.match(widgetRules, /align-items:\s*stretch/);

    const viewportStart = css.indexOf('.heatmap-viewport {');
    const viewportEnd = css.indexOf('.heatmap-world {', viewportStart);
    assert.match(css.slice(viewportStart, viewportEnd), /min-height:\s*0/);

    const panelStart = css.indexOf('.heatmap-cluster-panel {');
    const panelEnd = css.indexOf('.heatmap-cluster-panel[hidden]', panelStart);
    const panelRules = css.slice(panelStart, panelEnd);
    assert.match(panelRules, /min-height:\s*0/);
    assert.match(panelRules, /height:\s*100%/);
    assert.match(panelRules, /display:\s*flex/);
    assert.doesNotMatch(panelRules, /max-height:\s*min\(620px/);

    const bodyStart = css.indexOf('.heatmap-drawer-body {');
    const bodyEnd = css.indexOf('.heatmap-kpis {', bodyStart);
    const bodyRules = css.slice(bodyStart, bodyEnd);
    assert.match(bodyRules, /flex:\s*1/);
    assert.match(bodyRules, /min-height:\s*0/);
    assert.match(bodyRules, /overflow-y:\s*auto/);
    assert.doesNotMatch(bodyRules, /max-height:/);

    const mobileStart = css.indexOf('@media (max-width: 900px)');
    const mobileEnd = css.indexOf('@media (prefers-reduced-motion:', mobileStart);
    const mobileRules = css.slice(mobileStart, mobileEnd);
    assert.match(mobileRules, /grid-template-columns:\s*1fr/);
    assert.match(mobileRules, /height:\s*min\(420px,\s*70vh\)/);
  });

  it('renders the home location as an interactive labeled control', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'network.js'), 'utf8');
    assert.match(source, /id="heatmapHome" class="heatmap-home"/);
    assert.match(source, /network\.heatmapHomeLabel/);
    assert.match(source, /coords\.lat\.toFixed\(2\)/);
  });

  it('toggles paths on the heatmap widget that owns the clicked control', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'network.js'), 'utf8');
    assert.match(source, /const widget = arcsToggle\.closest\('\.heatmap-widget'\) \|\| page\._heatmapWidgetEl/);
    assert.match(source, /svg\.hidden = !page\._heatmapShowArcs/);
  });

  it('centers focus targets while clamping pan to the viewport', () => {
    const page = makePage();
    page._heatmapZoom = 1;
    const target = page._focusHeatmapTarget({ x: 100, y: 100 }, 1000, 600);
    assert.equal(target.zoom, 1.75);
    assert.deepEqual(plain(target.pan), { x: -750, y: -450 });
    assert.deepEqual(plain(page._clampHeatmapPan(2, { x: 20, y: -900 }, 1000, 600)), { x: 0, y: -600 });
  });

  it('keeps literal colors out of the geo visualization implementation', () => {
    const modelStart = networkSource.indexOf('  _heatmapTierForZoom(');
    const modelEnd = networkSource.indexOf('  _classificationLabel(', modelStart);
    const geoSource = networkSource.slice(modelStart, modelEnd);
    assert.equal(/#[\da-f]{6}\b|#[\da-f]{3}(?![\da-f])|rgba?\s*\(/i.test(geoSource), false);

    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'css', 'visualizations.css'), 'utf8');
    const cssStart = css.indexOf('/* Adaptive geo activity map */');
    assert.equal(/#[\da-f]{6}\b|#[\da-f]{3}(?![\da-f])|rgba?\s*\(/i.test(css.slice(cssStart)), false);
  });
});

describe('network traffic history model', () => {
  it('maps the four controls to unchanged history IPC payloads', () => {
    const page = makePage();
    assert.deepEqual(plain(page._historyRangePayload(1)), { hours: 1 });
    assert.deepEqual(plain(page._historyRangePayload(6)), { hours: 6 });
    assert.deepEqual(plain(page._historyRangePayload(24)), { hours: 24 });
    assert.deepEqual(plain(page._historyRangePayload(168)), { hours: 168 });
    assert.deepEqual(plain(page._historyRangePayload(12)), { hours: 24 });
  });

  it('caches successful rows by range and never crosses ranges on failure', () => {
    const page = makePage();
    const oneHourRows = [{ recorded_at: '2026-01-01T00:00:00Z', rx_sec: 1, tx_sec: 2 }];
    const sixHourRows = [{ recorded_at: '2026-01-01T01:00:00Z', rx_sec: 3, tx_sec: 4 }];
    const oneHour = page._beginHistoryRequest(1);
    page._resolveHistoryRequest(oneHour, oneHourRows, false);
    const sixHour = page._beginHistoryRequest(6);
    page._resolveHistoryRequest(sixHour, sixHourRows, false);

    const failedOneHour = page._beginHistoryRequest(1);
    assert.deepEqual(plain(page._resolveHistoryRequest(failedOneHour, [], true).rows), oneHourRows);
    const failedDay = page._beginHistoryRequest(24);
    assert.deepEqual(plain(page._resolveHistoryRequest(failedDay, [], true).rows), []);
  });

  it('discards stale asynchronous responses', () => {
    const page = makePage();
    const older = page._beginHistoryRequest(1);
    const newer = page._beginHistoryRequest(7 * 24);
    assert.equal(page._resolveHistoryRequest(older, [{ recorded_at: '2026-01-01T00:00:00Z' }]).stale, true);
    assert.equal(page._resolveHistoryRequest(newer, []).stale, false);
    assert.equal(page._historyCache.has(1), false);
    assert.equal(page._historyCache.has(168), true);
  });

  it('normalizes interface rows into ordered timestamp totals', () => {
    const page = makePage();
    const normalized = page._normalizeHistoryRows([
      { recorded_at: '2026-01-01T00:01:00Z', rx_sec: 5, tx_sec: 2, iface: 'wifi' },
      { recorded_at: '2026-01-01T00:00:00Z', rx_sec: 3, tx_sec: 4, iface: 'ethernet' },
      { recorded_at: '2026-01-01T00:01:00Z', rx_sec: 7, tx_sec: 8, iface: 'ethernet' },
      { recorded_at: 'not-a-date', rx_sec: 100, tx_sec: 100 }
    ]);
    assert.equal(normalized.length, 2);
    assert.equal(normalized[0].rx, 3);
    assert.equal(normalized[1].rx, 12);
    assert.equal(normalized[1].tx, 10);
  });

  it('downsamples averages while retaining raw peak points', () => {
    const page = makePage();
    const start = Date.parse('2026-01-01T00:00:00Z');
    const series = Array.from({ length: 100 }, (_, index) => ({
      t: new Date(start + index * 1000).toISOString(),
      ms: start + index * 1000,
      rx: index === 47 ? 9000 : index,
      tx: index === 72 ? 7000 : index * 2
    }));
    const sampled = page._downsampleHistory(series, 10);
    assert.equal(sampled.length, 10);
    assert.equal(Math.max(...sampled.map((bucket) => bucket.rxPeak.value)), 9000);
    assert.equal(Math.max(...sampled.map((bucket) => bucket.txPeak.value)), 7000);
    assert.ok(sampled.every((bucket) => bucket.rawEnd >= bucket.rawStart));
  });

  it('selects current, average, and raw peaks without smoothing distortion', () => {
    const page = makePage();
    const series = [
      { t: 'a', ms: 1, rx: 10, tx: 30 },
      { t: 'b', ms: 2, rx: 100, tx: 20 },
      { t: 'c', ms: 3, rx: 20, tx: 90 }
    ];
    const metrics = page._historyMetrics(series);
    assert.equal(metrics.current.rx, 20);
    assert.equal(metrics.average.rx, 130 / 3);
    assert.equal(metrics.peak.rx.index, 1);
    assert.equal(metrics.peak.tx.index, 2);
    assert.equal(page._niceAxisMax(101), 200);
    assert.equal(page._niceAxisMax(0), 1);
  });

  it('uses date labels only for the seven-day range', () => {
    const page = makePage();
    assert.equal(page._historyLabelMode(1), 'time');
    assert.equal(page._historyLabelMode(24), 'time');
    assert.equal(page._historyLabelMode(168), 'date');
  });

  it('keeps literal colors out of the history visualization implementation', () => {
    const historyStart = networkSource.indexOf('  _historyRangePayload(');
    const historyEnd = networkSource.indexOf('  async renderAlertHits(', historyStart);
    const historySource = networkSource.slice(historyStart, historyEnd);
    assert.equal(/#[\da-f]{6}\b|#[\da-f]{3}(?![\da-f])|rgba?\s*\(/i.test(historySource), false);
  });
});
