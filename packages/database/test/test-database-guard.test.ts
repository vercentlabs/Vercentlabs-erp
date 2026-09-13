import { describe, expect, it } from 'vitest';
import { assertTestDatabase } from '../src/test-database.js';

describe('assertTestDatabase', () => {
  it('allows a connection string whose database name contains "test"', () => {
    expect(() =>
      assertTestDatabase('postgres://user:pass@localhost:5432/vercentlabs_erp_test'),
    ).not.toThrow();
  });

  it('rejects a connection string pointing at a non-test database', () => {
    expect(() => assertTestDatabase('postgres://user:pass@localhost:5432/vercentlabs_erp')).toThrow(
      /Refusing/,
    );
  });

  it('rejects a connection string that looks like production', () => {
    expect(() => assertTestDatabase('postgres://user:pass@prod-host:5432/production')).toThrow(
      /Refusing/,
    );
  });
});
