'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const firewallSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'js', 'pages', 'firewall.js'),
  'utf8'
);

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
    Map,
    Set,
    Date,
    Math
  };
  vm.runInNewContext(firewallSource, sandbox, { filename: 'firewall.js' });
  return sandbox.window.Pages.firewall;
}

function connection(overrides = {}) {
  return {
    localAddress: '10.0.0.5',
    localPort: 53000,
    remoteAddress: '203.0.113.9',
    remotePort: 443,
    pid: 42,
    processName: 'browser.exe',
    state: 'ESTABLISHED',
    serviceName: 'HTTPS',
    classification: 'SAFE',
    ...overrides
  };
}

describe('firewall perimeter activity model', () => {
  it('aggregates sockets by process and remote endpoint with worst-risk precedence', () => {
    const page = makePage();
    const groups = page._aggregatePerimeterEndpoints([
      connection(),
      connection({ localPort: 443, remotePort: 53000, classification: 'UNKNOWN', state: 'TIME_WAIT' })
    ], false);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].risk, 'UNKNOWN');
    assert.equal(groups[0].direction, 'mixed');
    assert.deepEqual([...groups[0].states].sort(), ['ESTABLISHED', 'TIME_WAIT']);
  });

  it('keeps malicious and busier endpoints ahead of lower-risk endpoints', () => {
    const page = makePage();
    const groups = page._aggregatePerimeterEndpoints([
      connection({ remoteAddress: '198.51.100.2', classification: 'SAFE' }),
      connection({ remoteAddress: '198.51.100.3', classification: 'UNKNOWN' }),
      connection({ remoteAddress: '198.51.100.4', classification: 'MALICIOUS' }),
      connection({ remoteAddress: '198.51.100.4', localPort: 53001, classification: 'MALICIOUS' })
    ], false);
    const ordered = page._orderPerimeterEndpoints(groups);
    assert.equal(ordered[0].risk, 'MALICIOUS');
    assert.equal(ordered[0].count, 2);
    assert.equal(ordered.at(-1).risk, 'SAFE');
  });

  it('produces stable positions and distinct risk radii', () => {
    const page = makePage();
    const groups = page._aggregatePerimeterEndpoints([
      connection({ classification: 'SAFE' }),
      connection({ remoteAddress: '198.51.100.8', classification: 'UNKNOWN' }),
      connection({ remoteAddress: '198.51.100.9', classification: 'MALICIOUS' })
    ], false);
    const first = page._layoutPerimeterGroups(groups);
    const second = page._layoutPerimeterGroups(groups);
    assert.deepEqual(
      first.map(({ key, x, y, radius }) => ({ key, x, y, radius })),
      second.map(({ key, x, y, radius }) => ({ key, x, y, radius }))
    );
    assert.ok(first.find((item) => item.risk === 'SAFE').radius < first.find((item) => item.risk === 'UNKNOWN').radius);
    assert.ok(first.find((item) => item.risk === 'UNKNOWN').radius < first.find((item) => item.risk === 'MALICIOUS').radius);
  });

  it('keeps dense endpoint layouts separated and inside the radar', () => {
    const page = makePage();
    const groups = page._aggregatePerimeterEndpoints(Array.from({ length: 42 }, (_, index) => connection({
      remoteAddress: `198.51.100.${index + 1}`,
      pid: index % 5,
      processName: `process-${index % 5}.exe`,
      classification: index % 11 === 0 ? 'MALICIOUS' : index % 4 === 0 ? 'UNKNOWN' : 'SAFE'
    })), false);
    const items = page._layoutPerimeterGroups(groups);
    assert.equal(items.length, groups.length);
    for (const item of items) {
      assert.ok(item.x - item.nodeRadius >= 0);
      assert.ok(item.x + item.nodeRadius <= 600);
      assert.ok(item.y - item.nodeRadius >= 0);
      assert.ok(item.y + item.nodeRadius <= 420);
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const distance = Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y);
        assert.ok(distance >= items[i].nodeRadius + items[j].nodeRadius + 3, `${items[i].key} overlaps ${items[j].key}`);
      }
    }
  });

  it('keeps single counts visible and emits layered risk boundaries', () => {
    assert.match(firewallSource, /perim-node-count[^>]*>[\s\S]*\$\{item\.count\}/);
    assert.match(firewallSource, /id="perimForegroundChrome"/);
    assert.match(firewallSource, /perim-risk-outline-malicious/);
    assert.match(firewallSource, /perim-hub-count[\s\S]*<tspan/);
    const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'css', 'visualizations.css'), 'utf8');
    assert.match(styles, /\.perim-risk-outline\s*\{[\s\S]*?pointer-events:\s*none/);
    assert.match(styles, /\.perim-risk-outline-malicious\.has-blocked/);
  });

  it('tracks recent poll samples and resets continuous observation after a gap', () => {
    const page = makePage();
    const sample = connection();
    page._recordPerimeterActivity([sample], 1_000);
    const key = page._endpointGroupKey(sample);
    page._recordPerimeterActivity([sample, connection({ localPort: 53001 })], 7_000);
    page._recordPerimeterActivity([], 13_000);
    page._recordPerimeterActivity([sample], 19_000);

    const activity = page._perimeterActivity.get(key);
    assert.deepEqual(Array.from(activity.samples, (entry) => entry.count), [1, 2, 0, 1]);
    assert.equal(activity.activeSince, 19_000);

    for (let i = 0; i < 30; i++) page._recordPerimeterActivity([sample], 25_000 + i * 6_000);
    assert.equal(page._perimeterActivity.get(key).samples.length, 20);
  });

  it('clears visualization state during page teardown', () => {
    const page = makePage();
    page._summaryTimer = 1;
    page._perimeterTimer = 2;
    page._particleRaf = 3;
    page._particleObserver = { disconnect() {} };
    page._perimeterActivity.set('sample', {});
    page.destroy();
    assert.equal(page._summaryTimer, null);
    assert.equal(page._perimeterTimer, null);
    assert.equal(page._particleRaf, null);
    assert.equal(page._perimeterActivity.size, 0);
  });

  it('does not introduce literal colors in the perimeter renderer', () => {
    const start = firewallSource.indexOf('_renderPerimeter(container, connections)');
    const end = firewallSource.indexOf('_renderConnectionsTable(container, connections)');
    const perimeterBlock = firewallSource.slice(start, end);
    assert.doesNotMatch(perimeterBlock, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i);
  });
});
