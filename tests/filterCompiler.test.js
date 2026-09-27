'use strict';

// Tests for tools/compile-filter-lists.js (Phase 1 narrow DNR compiler).
// Fixture tests use small inline lists; integration tests compile the real
// vendored EasyList/EasyPrivacy snapshots (offline, deterministic).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const compiler = require('../tools/compile-filter-lists');

const REPO_ROOT = path.join(__dirname, '..');
const RULES_DIR = path.join(REPO_ROOT, 'browser-extension', 'rules');

function compileText(text) {
  const { canonical, stats } = compiler.compileListText(text);
  const rules = compiler.assignRuleIds(canonical, stats);
  compiler.validateRules(rules);
  return { rules, stats };
}

function singleRule(text) {
  const { rules, stats } = compileText(text);
  assert.equal(rules.length, 1);
  assert.equal(stats.unsupported, 0);
  return rules[0];
}

describe('filter compiler fixtures', () => {
  it('compiles a basic domain-anchored block rule', () => {
    const rule = singleRule('||ads.example.com^');
    assert.deepEqual(rule, {
      id: 1,
      priority: compiler.BLOCK_PRIORITY,
      action: { type: 'block' },
      condition: { urlFilter: '||ads.example.com^' },
    });
  });

  it('compiles an exception to a higher-priority allow rule', () => {
    const rule = singleRule('@@||cdn.example.com^');
    assert.equal(rule.action.type, 'allow');
    assert.equal(rule.priority, compiler.ALLOW_PRIORITY);
    assert.ok(rule.priority > compiler.BLOCK_PRIORITY);
  });

  it('restricts a single resource type', () => {
    const rule = singleRule('||example.com/ad.js$script');
    assert.deepEqual(rule.condition.resourceTypes, ['script']);
  });

  it('restricts multiple resource types', () => {
    const rule = singleRule('||example.com/ad$script,image');
    assert.deepEqual(rule.condition.resourceTypes, ['image', 'script']);
  });

  it('maps third-party and first-party restrictions to the scalar DNR form', () => {
    // DNR RuleCondition.domainType is a single string. Array form is
    // silently ignored by Chrome at load (live-engine proof), so the
    // compiler must never emit it.
    assert.equal(singleRule('||tracker.example^$third-party').condition.domainType, 'thirdParty');
    assert.equal(singleRule('||tracker.example^$~third-party').condition.domainType, 'firstParty');
    assert.equal(singleRule('||asset.example^$first-party').condition.domainType, 'firstParty');
  });

  it('maps domain restrictions including exclusions', () => {
    const rule = singleRule('||x.example^$domain=example.com');
    assert.deepEqual(rule.condition.initiatorDomains, ['example.com']);
    const excluded = singleRule('||x.example^$domain=example.com|~sub.example.com');
    assert.deepEqual(excluded.condition.initiatorDomains, ['example.com']);
    assert.deepEqual(excluded.condition.excludedInitiatorDomains, ['sub.example.com']);
  });

  it('rejects entity domain syntax without broadening', () => {
    const { rules, stats } = compileText('||x.example^$domain=foo.*');
    assert.equal(rules.length, 0);
    assert.equal(stats.unsupportedByReason['domain-entity'], 1);
  });

  it('deduplicates equivalent source filters to one rule', () => {
    const { rules, stats } = compileText('||a.example.com^\n||a.example.com^\n@@||a.example.com^\n@@||a.example.com^\n');
    assert.equal(rules.length, 2);
    assert.equal(stats.duplicates, 2);
    assert.deepEqual(rules.map((rule) => rule.id), [1, 2]);
  });

  it('drops cosmetic rules with a cosmetic reason', () => {
    const { rules, stats } = compileText('example.com##.advert\n');
    assert.equal(rules.length, 0);
    assert.equal(stats.unsupportedByReason.cosmetic, 1);
  });

  it('rejects scriptlet and procedural filters safely', () => {
    for (const line of [
      'example.com##+js(set-cookie, a, b)',
      'example.com##div:has(.ad)',
      'example.com#$#hide-if-shadow-contains a',
    ]) {
      const outcome = compiler.compileLine(line);
      assert.equal(outcome.kind, 'drop');
      assert.equal(outcome.reason, 'cosmetic-extended');
    }
  });

  it('rejects redirect rules safely', () => {
    const outcome = compiler.compileLine('||x.example^$redirect=noop.js');
    assert.equal(outcome.kind, 'drop');
    assert.equal(outcome.reason, 'redirect');
    const { rules } = compileText('||x.example^$redirect=noop.js\n');
    assert.equal(rules.length, 0);
  });

  it('rejects malformed syntax without crashing', () => {
    for (const line of ['not a valid rule [][[', '*', '@@', '||']) {
      const outcome = compiler.compileLine(line);
      assert.equal(outcome.kind, 'drop', line);
    }
    assert.equal(compiler.compileLine('').kind, 'comment');
    const { rules } = compileText('not a valid rule [][[\n*\n');
    assert.equal(rules.length, 0);
  });

  it('maps method, match-case, important, and aliases', () => {
    assert.deepEqual(singleRule('||x.example^$method=get|post').condition.requestMethods, ['get', 'post']);
    assert.equal(singleRule('||x.example^$match-case').condition.isUrlFilterCaseSensitive, true);
    assert.equal(singleRule('||x.example^$important').priority, compiler.BLOCK_PRIORITY + compiler.IMPORTANT_BONUS);
    assert.equal(singleRule('@@||x.example^$important').priority, compiler.ALLOW_PRIORITY + compiler.IMPORTANT_BONUS);
    assert.deepEqual(singleRule('||x.example^$xhr').condition.resourceTypes, ['xmlhttprequest']);
    assert.deepEqual(singleRule('||x.example^$beacon').condition.resourceTypes, ['ping']);
    assert.deepEqual(singleRule('||x.example^$websocket').condition.resourceTypes, ['websocket']);
  });

  it('rejects invalid method values and page-level scopes', () => {
    assert.equal(compileText('||x.example^$method=banana\n').rules.length, 0);
    assert.equal(compileText('@@||x.example^$document\n').rules.length, 0);
    assert.equal(compileText('||x.example^$popup\n').rules.length, 0);
  });

  it('produces stable IDs independent of source order', () => {
    const lines = [
      '||z.example.com^',
      '@@||cdn.example.com^',
      '||a.example.com/ad.js$script,image',
      '||tracker.example^$third-party',
      '||x.example^$domain=example.com|~sub.example.com',
      '||m.example^$important',
    ];
    const forward = compiler.serializeRuleset(compileText(`${lines.join('\n')}\n`).rules);
    const backward = compiler.serializeRuleset(compileText(`${[...lines].reverse().join('\n')}\n`).rules);
    const rotated = compiler.serializeRuleset(compileText(`${[...lines.slice(2), ...lines.slice(0, 2)].join('\n')}\n`).rules);
    assert.equal(backward, forward);
    assert.equal(rotated, forward);
  });

  it('fails explicitly above a configured budget', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'filter-sources.json'), 'utf8'));
    const compiled = compiler.compileAll(manifest, { maxCombinedStaticRules: 10 });
    assert.ok(compiled.combined > 10);
    assert.equal(compiled.withinBudget, false);
    assert.equal(compiled.budgetLimit, 10);
  });

  it('rejects invalid generated rules instead of writing them', () => {
    assert.throws(() => compiler.validateRules([{ id: 0, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'x' } }]), /invalid id/);
    assert.throws(() => compiler.validateRules([{ id: 1, priority: 1, action: { type: 'redirect', redirect: { url: 'https://x.example/' } }, condition: { urlFilter: 'x' } }]), /Unsupported generated action/);
    assert.throws(() => compiler.validateRules([{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'x', regexFilter: 'y' } }]), /regexFilter/);
    assert.throws(() => compiler.validateRules([
      { id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'x' } },
      { id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'y' } },
    ]), /Duplicate generated rule id/);
    // Array-form domainType is silently dropped by Chrome at load, so the
    // compiler must reject it instead of writing dead rules.
    assert.throws(() => compiler.validateRules([{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'x', domainType: ['thirdParty'] } }]), /domainType/);
    assert.throws(() => compiler.validateRules([{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'x', domainType: 'fourthParty' } }]), /domainType/);
    compiler.validateRules([{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'x', domainType: 'thirdParty' } }]);
  });

  it('emits zero regex rules by policy', () => {
    const outcome = compiler.compileLine('/ads\\/banner[0-9]+\\.js/');
    assert.equal(outcome.kind, 'drop');
    assert.equal(outcome.reason, 'regex-unsupported');
  });
});

describe('filter compiler domain compaction', () => {
  function compactSource(text, options) {
    const { canonical } = compiler.compileListText(text);
    const { uniques } = compiler.dedupeCanonicalForms(canonical);
    return { uniques, compacted: compiler.compactCanonicalRules(uniques, options) };
  }

  function groupedRules(text, options) {
    const { uniques, compacted } = compactSource(text, options);
    assert.equal(
      compacted.compactable + compacted.nonCompactable,
      uniques.length,
      'every unique filter must classify exactly once'
    );
    return compacted;
  }

  it('compacts pure host filters into one grouped condition', () => {
    const compacted = groupedRules('||a.example^\n||b.example^\n');
    assert.equal(compacted.grouped.length, 1);
    assert.equal(compacted.individual.length, 0);
    assert.deepEqual(compacted.grouped[0].condition.requestDomains, ['a.example', 'b.example']);
    assert.equal(compacted.grouped[0].action.type, 'block');
    assert.equal(compacted.grouped[0].priority, compiler.BLOCK_PRIORITY);
  });

  it('keeps different conditions in separate groups', () => {
    const compacted = groupedRules('||a.example^$script\n||b.example^$image\n');
    assert.equal(compacted.grouped.length, 2);
    assert.equal(compacted.individual.length, 0);
  });

  it('combines identical conditions including third-party', () => {
    const compacted = groupedRules('||a.example^$script,third-party\n||b.example^$script,third-party\n');
    assert.equal(compacted.grouped.length, 1);
    assert.deepEqual(compacted.grouped[0].condition.requestDomains, ['a.example', 'b.example']);
    assert.deepEqual(compacted.grouped[0].condition.resourceTypes, ['script']);
    assert.equal(compacted.grouped[0].condition.domainType, 'thirdParty');
  });

  it('separates first-party from third-party conditions', () => {
    const compacted = groupedRules('||a.example^$third-party\n||b.example^$first-party\n');
    assert.equal(compacted.grouped.length, 2);
  });

  it('never merges blocks with allows', () => {
    const compacted = groupedRules('||a.example^\n@@||b.example^\n');
    assert.equal(compacted.grouped.length, 2);
    const actions = compacted.grouped.map((rule) => rule.action.type).sort();
    assert.deepEqual(actions, ['allow', 'block']);
  });

  it('keeps differing effective priorities separate', () => {
    const compacted = groupedRules('||a.example^\n||b.example^$important\n');
    assert.equal(compacted.grouped.length, 2);
    const priorities = compacted.grouped.map((rule) => rule.priority).sort((a, b) => a - b);
    assert.deepEqual(priorities, [compiler.BLOCK_PRIORITY, compiler.BLOCK_PRIORITY + compiler.IMPORTANT_BONUS]);
  });

  it('preserves distinct domain restrictions', () => {
    const same = groupedRules('||a.example^$domain=x.example\n||b.example^$domain=x.example\n');
    assert.equal(same.grouped.length, 1);
    const different = groupedRules('||a.example^$domain=x.example\n||b.example^$domain=y.example\n');
    assert.equal(different.grouped.length, 2);
  });

  it('keeps path filters as individual urlFilter rules', () => {
    const compacted = groupedRules('||example.com/ad.js\n||example.com/path/*\n|https://example.com/\n');
    assert.equal(compacted.grouped.length, 0);
    assert.equal(compacted.individual.length, 3);
    assert.ok(compacted.individual.every((rule) => typeof rule.condition.urlFilter === 'string'));
  });

  it('maps eligible domains exactly without parent synthesis', () => {
    const compacted = groupedRules('||ads.example.com^\n||metrics.example.com^\n');
    assert.equal(compacted.grouped.length, 1);
    assert.deepEqual(compacted.grouped[0].condition.requestDomains, ['ads.example.com', 'metrics.example.com']);
  });

  it('leaves non-hostname patterns individual', () => {
    for (const line of ['||exa_mple.com^\n', '||1.2.3.4^\n', '||example.com.^\n', '||*.example.com^\n']) {
      const compacted = groupedRules(line);
      assert.equal(compacted.grouped.length, 0, line);
      assert.equal(compacted.individual.length, 1, line);
    }
  });

  it('normalizes IDNs to deterministic ASCII punycode', () => {
    assert.equal(compiler.extractCompactDomain('||münchen.de^'), 'xn--mnchen-3ya.de');
    const compacted = groupedRules('||münchen.de^\n||xn--mnchen-3ya.de^\n');
    assert.equal(compacted.grouped.length, 1);
    assert.deepEqual(compacted.grouped[0].condition.requestDomains, ['xn--mnchen-3ya.de']);
    assert.equal(compiler.extractCompactDomain('||UPPER.EXAMPLE^'), 'upper.example');
    const upper = groupedRules('||UPPER.EXAMPLE^\n||upper.example^\n');
    assert.equal(upper.grouped.length, 1);
    assert.deepEqual(upper.grouped[0].condition.requestDomains, ['upper.example']);
  });

  it('chunks large groups deterministically', () => {
    const lines = [];
    for (let i = 0; i < 5; i += 1) lines.push(`||host${i}.example^`);
    const compacted = groupedRules(`${lines.join('\n')}\n`, { maxDomainsPerRule: 2 });
    assert.equal(compacted.groupCount, 1);
    assert.equal(compacted.chunks, 3);
    assert.equal(compacted.grouped.length, 3);
    assert.deepEqual(
      compacted.grouped.map((rule) => rule.condition.requestDomains),
      [['host0.example', 'host1.example'], ['host2.example', 'host3.example'], ['host4.example']]
    );
  });

  it('proves every supported filter is represented after compaction', () => {
    const text = [
      '||a.example^', '||b.example^$script,third-party', '||c.example^$script,third-party',
      '@@||d.example^', '||e.example/ad.js', '||f.example^$important',
      '||g.example^$domain=x.example', '||münchen.de^',
    ].join('\n');
    const { canonical } = compiler.compileListText(`${text}\n`);
    const { uniques } = compiler.dedupeCanonicalForms(canonical);
    const compacted = compiler.compactCanonicalRules(uniques);
    const finalRules = [...compacted.individual, ...compacted.grouped]
      .map((rule) => compiler.canonicalJson(rule))
      .sort()
      .map((form, index) => ({ ...JSON.parse(form), id: index + 1 }));
    const coverage = compiler.verifyCompactionCoverage(uniques, finalRules);
    assert.equal(coverage.total, uniques.length);
    assert.equal(coverage.missing, 0);
  });

  it('keeps byte-identical output for shuffled source order', () => {
    const lines = [
      '||z.example^\n', '@@||cdn.example^\n', '||a.example/ad.js$script\n',
      '||tracker.example^$third-party\n', '||münchen.de^\n', '||e.example^$domain=x.example\n',
    ];
    const build = (ordered) => {
      const { canonical } = compiler.compileListText(ordered.join(''));
      const { uniques } = compiler.dedupeCanonicalForms(canonical);
      const compacted = compiler.compactCanonicalRules(uniques);
      const forms = [...compacted.individual, ...compacted.grouped]
        .map((rule) => compiler.canonicalJson(rule))
        .sort();
      return compiler.serializeRuleset(forms.map((form, index) => ({ ...JSON.parse(form), id: index + 1 })));
    };
    const forward = build(lines);
    const backward = build([...lines].reverse());
    assert.equal(backward, forward);
  });
});

describe('filter compiler real-list integration', () => {
  it('compiles the vendored snapshots with consistent counts', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'filter-sources.json'), 'utf8'));
    const compiled = compiler.compileAll(manifest);
    for (const listKey of ['easylist', 'easyprivacy']) {
      const stats = compiled.perList[listKey].stats;
      assert.equal(
        stats.supported + stats.unsupported,
        stats.inputRules,
        `${listKey}: supported + unsupported must equal input`
      );
      assert.equal(
        stats.supported,
        stats.compactable + stats.nonCompactable + stats.duplicates,
        `${listKey}: supported must equal compactable + non-compactable + duplicates`
      );
      assert.equal(
        stats.generated,
        stats.groupedRules + stats.individualRules,
        `${listKey}: generated must equal grouped + individual rules`
      );
      assert.ok(compiled.perList[listKey].ruleCount > 1000, `${listKey}: expected substantial coverage`);
    }
    assert.equal(
      compiled.combined,
      compiled.perList.easylist.ruleCount + compiled.perList.easyprivacy.ruleCount
    );
    // Compaction must bring the pinned lists inside the conservative budget.
    assert.ok(compiled.combined <= compiler.MAX_COMBINED_STATIC_RULES);
    assert.equal(compiled.withinBudget, true);
  });

  it('produces byte-identical artifacts on repeat compilation', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'filter-sources.json'), 'utf8'));
    const first = compiler.compileAll(manifest);
    const second = compiler.compileAll(manifest);
    assert.equal(second.outputs['ads.json'], first.outputs['ads.json']);
    assert.equal(second.outputs['trackers.json'], first.outputs['trackers.json']);
    assert.equal(
      compiler.buildSourcesJson(manifest, second),
      compiler.buildSourcesJson(manifest, first)
    );
    // Checked-in files match a fresh in-memory build (determinism proof).
    assert.equal(fs.readFileSync(path.join(RULES_DIR, 'ads.json'), 'utf8'), first.outputs['ads.json']);
    assert.equal(fs.readFileSync(path.join(RULES_DIR, 'trackers.json'), 'utf8'), first.outputs['trackers.json']);
    assert.equal(
      fs.readFileSync(path.join(RULES_DIR, 'SOURCES.json'), 'utf8'),
      compiler.buildSourcesJson(manifest, first)
    );
  });

  it('passes --check against checked-in artifacts without writing', () => {
    const before = ['ads.json', 'trackers.json', 'SOURCES.json'].map((name) => ({
      name,
      mtime: fs.statSync(path.join(RULES_DIR, name)).mtimeMs,
    }));
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'compile-filter-lists.js'), '--check'], {
      encoding: 'utf8',
      timeout: 300000,
    });
    // --check is a pure reproducibility gate (byte comparison only); the
    // budget gate lives in the default compile mode.
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Filter artifacts are up to date/);
    for (const entry of before) {
      assert.equal(fs.statSync(path.join(RULES_DIR, entry.name)).mtimeMs, entry.mtime, `${entry.name} must not be rewritten by --check`);
    }
  });

  it('ships zero non-scalar domainType conditions in the real artifacts', () => {
    // Chrome silently drops rules whose domainType is not exactly
    // 'firstParty'|'thirdParty' (notably the one-element arrays the
    // compiler emitted before this fix), so the packaged rulesets are
    // scanned directly: any invalid shape here is dead protection.
    const counts = {};
    for (const [name, key] of [['ads.json', 'ads'], ['trackers.json', 'trackers']]) {
      const rules = JSON.parse(fs.readFileSync(path.join(RULES_DIR, name), 'utf8'));
      assert.ok(Array.isArray(rules), `${name} must be a rule array`);
      let scalar = 0;
      const invalid = [];
      for (const rule of rules) {
        const domainType = rule && rule.condition ? rule.condition.domainType : undefined;
        if (domainType === undefined) continue;
        if (domainType === 'firstParty' || domainType === 'thirdParty') scalar += 1;
        else if (invalid.length < 5) invalid.push(`id ${rule && rule.id}: ${JSON.stringify(domainType)}`);
      }
      counts[key] = scalar;
      assert.equal(invalid.length, 0, `${name} has invalid domainType conditions: ${invalid.join('; ')}`);
    }
    assert.ok(counts.ads > 100 && counts.trackers > 100,
      `expected a substantial domainType population, got ${JSON.stringify(counts)}`);
  });
});
