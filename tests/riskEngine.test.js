'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { levelFromScore, recommendationForRisk } = require('../src/security/riskEngine');

describe('riskEngine levelFromScore', () => {
  it('maps 0 to none and low/medium/high across the score range', () => {
    assert.equal(levelFromScore(0), 'none');
    assert.equal(levelFromScore(1), 'low');
    assert.equal(levelFromScore(34), 'low');
    assert.equal(levelFromScore(35), 'medium');
    assert.equal(levelFromScore(59), 'medium');
    assert.equal(levelFromScore(60), 'high');
    assert.equal(levelFromScore(100), 'high');
  });

  it('never produces the removed critical level', () => {
    for (const score of [0, 1, 34, 35, 59, 60, 80, 100]) {
      assert.notEqual(levelFromScore(score), 'critical');
    }
  });
});

describe('riskEngine recommendationForRisk', () => {
  it('returns an empty recommendation for absent or low-risk assessments', () => {
    assert.equal(recommendationForRisk(null), '');
    assert.equal(recommendationForRisk(undefined), '');
    assert.equal(recommendationForRisk({ score: 0 }), '');
    assert.equal(recommendationForRisk({ score: 34 }), '');
  });

  it('returns escalating recommendations from medium risk up', () => {
    assert.match(recommendationForRisk({ score: 35 }, 'process'), /^Inspect publisher, path, and purpose for this process\.$/);
    assert.match(recommendationForRisk({ score: 59 }, 'process'), /^Inspect publisher, path, and purpose for this process\.$/);
    assert.match(recommendationForRisk({ score: 60 }, 'process'), /^Review this process before allowing it to continue running\.$/);
    assert.match(recommendationForRisk({ score: 80 }, 'process'), /^Quarantine or disable this process until it is verified\.$/);
    assert.match(recommendationForRisk({ score: 100 }, 'process'), /^Quarantine or disable this process until it is verified\.$/);
  });
});
