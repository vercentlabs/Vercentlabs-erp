import { describe, expect, it } from 'vitest';
import {
  buildErrorEnvelope,
  buildPaginatedResult,
  decimalStringSchema,
  bigIntToJsonString,
  jsonStringToBigInt,
  isValidCorrelationId,
  isValidIanaTimeZone,
  paginationRequestSchema,
  parseSortParam,
  trustedScopeSchema,
} from '../src/index.js';

describe('pagination', () => {
  it('builds a paginated result with correct total pages', () => {
    const request = paginationRequestSchema.parse({ page: 2, pageSize: 10 });
    const result = buildPaginatedResult(['a', 'b'], request, 25);
    expect(result).toEqual({
      items: ['a', 'b'],
      page: 2,
      pageSize: 10,
      totalItems: 25,
      totalPages: 3,
    });
  });

  it('rejects a page size above the maximum', () => {
    expect(() => paginationRequestSchema.parse({ page: 1, pageSize: 10000 })).toThrow();
  });
});

describe('sort parsing', () => {
  it('parses multiple sort fields with direction', () => {
    expect(parseSortParam('name:asc,createdAt:desc')).toEqual([
      { field: 'name', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
    ]);
  });

  it('returns an empty array for undefined input', () => {
    expect(parseSortParam(undefined)).toEqual([]);
  });
});

describe('error envelope', () => {
  it('produces a typed envelope with details', () => {
    const envelope = buildErrorEnvelope('VALIDATION_ERROR', 'Invalid request', {
      correlationId: 'req-123',
      details: [{ field: 'email', message: 'is required' }],
    });
    expect(envelope.error.code).toBe('VALIDATION_ERROR');
    expect(envelope.error.details).toHaveLength(1);
  });
});

describe('correlation id', () => {
  it('accepts a well-formed id', () => {
    expect(isValidCorrelationId('req-01HZY8QK9X')).toBe(true);
  });

  it('rejects an id that is too short', () => {
    expect(isValidCorrelationId('short')).toBe(false);
  });
});

describe('decimal string', () => {
  it('accepts a valid decimal', () => {
    expect(decimalStringSchema.parse('1250.75')).toBe('1250.75');
  });

  it('rejects a value with more than one decimal point', () => {
    expect(() => decimalStringSchema.parse('12.5.0')).toThrow();
  });
});

describe('bigint json helpers', () => {
  it('round-trips a bigint through a string', () => {
    const value = 9_007_199_254_740_993n;
    const json = bigIntToJsonString(value);
    expect(typeof json).toBe('string');
    expect(jsonStringToBigInt(json)).toBe(value);
  });
});

describe('timezone validation', () => {
  it('accepts a real IANA timezone', () => {
    expect(isValidIanaTimeZone('Asia/Kolkata')).toBe(true);
  });

  it('rejects a bogus timezone', () => {
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
  });
});

describe('trusted scope', () => {
  it('requires an organization id and actor', () => {
    expect(() =>
      trustedScopeSchema.parse({
        organizationId: 'org_1',
        actor: { actorId: 'user_1', actorType: 'user' },
        roles: ['member'],
      }),
    ).not.toThrow();
  });

  it('rejects a scope missing organizationId', () => {
    expect(() =>
      trustedScopeSchema.parse({
        actor: { actorId: 'user_1', actorType: 'user' },
        roles: [],
      }),
    ).toThrow();
  });
});
