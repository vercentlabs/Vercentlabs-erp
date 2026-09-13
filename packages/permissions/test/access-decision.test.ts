import { describe, expect, it } from 'vitest';
import { allowAccess, denyAccess } from '../src/index.js';

describe('access decisions', () => {
  it('builds a deny decision with a reason', () => {
    expect(denyAccess('missing role')).toEqual({ allowed: false, reason: 'missing role' });
  });

  it('builds an allow decision without a reason', () => {
    expect(allowAccess()).toEqual({ allowed: true });
  });
});
