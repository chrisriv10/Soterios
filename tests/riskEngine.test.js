'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { levelFromScore } = require('../src/security/riskEngine');

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
