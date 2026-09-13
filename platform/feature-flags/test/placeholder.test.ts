import { describe, expect, it } from 'vitest';
import { PLATFORM_MODULE, PLATFORM_MODULE_SP_IDS } from '../src/index.js';

describe('feature-flags platform module boundary', () => {
  it('identifies itself and its shared-platform capability ids', () => {
    expect(PLATFORM_MODULE).toBe('feature-flags');
    expect(PLATFORM_MODULE_SP_IDS.length).toBeGreaterThan(0);
  });
});
