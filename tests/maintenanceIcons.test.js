'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const components = fs.readFileSync(path.join(root, 'src', 'ui', 'js', 'components.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'ui', 'css', 'style.css'), 'utf8');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'src', 'scripts', 'registry.json'), 'utf8'));

describe('maintenance report icon presentation', () => {
  it('keeps file and radar SVGs inset with rounded strokes', () => {
    for (const name of ['file', 'radar']) {
      const definition = components.match(new RegExp(`\\b${name}: '(.*?)'`))?.[1] || '';
      assert.match(definition, /viewBox="-1 -1 26 26"/);
      assert.match(definition, /stroke-linecap="round"/);
      assert.match(definition, /stroke-linejoin="round"/);
    }
  });

  it('renders maintenance SVGs as visible block-level artwork', () => {
    const start = styles.indexOf('.maintenance-tool-card-icon svg');
    const end = styles.indexOf('\n}', start) + 2;
    const rules = styles.slice(start, end);
    assert.match(rules, /display:\s*block/);
    assert.match(rules, /overflow:\s*visible/);
    assert.match(rules, /stroke-linecap:\s*round/);
    assert.match(rules, /stroke-linejoin:\s*round/);
  });

  it('retains the registry mappings for the affected tools', () => {
    const byId = new Map(registry.scripts.map((script) => [script.id, script]));
    assert.equal(byId.get('large-files-report')?.icon, 'file');
    assert.equal(byId.get('persistence-change-monitor')?.icon, 'radar');
  });
});
