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
