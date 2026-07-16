'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const healthScore = require('../src/tools/healthScore');

describe('healthScore volume filtering', () => {
  it('ignores volumes smaller than 1 GB', () => {
    const { worstUse, hasRelevant } = healthScore.worstUsageFromVolumes([
      { mount: 'C:', size: 500 * 1024 ** 3, use: 40 },
      { mount: '\\\\?\\Volume{recovery}', size: 500 * 1024 ** 2, use: 100 }
    ]);
    assert.equal(hasRelevant, true);
    assert.equal(worstUse, 40);
  });

  it('ignores Windows recovery-style mounts without drive letters', () => {
    const { worstUse, hasRelevant } = healthScore.worstUsageFromVolumes([
      { mount: '\\\\?\\Volume{abc-def}', size: 600 * 1024 ** 3, use: 100 },
      { mount: 'D:', size: 2 * 1024 ** 4, use: 55 }
    ]);
    assert.equal(hasRelevant, true);
    assert.equal(worstUse, 55);
  });

  it('returns zero usage when no relevant volumes exist', () => {
    const { worstUse, hasRelevant } = healthScore.worstUsageFromVolumes([
      { mount: '\\\\?\\Volume{efi}', size: 100 * 1024 ** 2, use: 100 }
    ]);
    assert.equal(hasRelevant, false);
    assert.equal(worstUse, 0);
  });

  it('uses empty-volume fallback when no relevant volumes are present', () => {
    const { worstUse, fullVolumes, hasRelevant } = healthScore.worstUsageFromVolumes([
      { mount: '\\\\?\\Volume{recovery}', size: 500 * 1024 ** 2, use: 100 }
    ]);
    assert.equal(hasRelevant, false);
    const reason = fullVolumes.length
      ? `Low space on: ${fullVolumes.join(', ')} (${worstUse.toFixed(0)}% used).`
      : !hasRelevant
        ? 'No user-facing volumes found for disk scoring.'
        : `All volumes healthy (highest usage ${worstUse.toFixed(0)}%).`;
    assert.match(reason, /No user-facing volumes found for disk scoring/);
  });
});
