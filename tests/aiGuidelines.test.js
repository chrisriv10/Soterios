'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { AI_GUIDELINES, buildSystemPrompt } = require('../src/main/aiGuidelines');

describe('aiGuidelines', () => {
  it('establishes the Soterios persona', () => {
    assert.match(AI_GUIDELINES, /Soterios/);
    assert.match(AI_GUIDELINES, /local/);
    assert.match(AI_GUIDELINES, /Windows security/);
  });

  it('covers the key behavioral rules', () => {
    assert.match(AI_GUIDELINES, /Stay in scope/i);
    assert.match(AI_GUIDELINES, /off-topic/i);
    assert.match(AI_GUIDELINES, /Use the system snapshot, nothing more/i);
    assert.match(AI_GUIDELINES, /snapshot may be incomplete or stale/i);
    assert.match(AI_GUIDELINES, /Never weaken security/i);
    assert.match(AI_GUIDELINES, /concise/i);
  });

  it('returns the guidelines alone when no context is given', () => {
    assert.equal(buildSystemPrompt(), AI_GUIDELINES);
    assert.equal(buildSystemPrompt(''), AI_GUIDELINES);
    assert.equal(buildSystemPrompt('   '), AI_GUIDELINES);
    assert.equal(buildSystemPrompt(null), AI_GUIDELINES);
    assert.equal(buildSystemPrompt(42), AI_GUIDELINES);
  });

  it('appends context when provided', () => {
    const prompt = buildSystemPrompt('Health score: 88/100');
    assert.ok(prompt.startsWith(AI_GUIDELINES));
    assert.match(prompt, /Health score: 88\/100/);
    assert.ok(prompt.length > AI_GUIDELINES.length);
  });
});
