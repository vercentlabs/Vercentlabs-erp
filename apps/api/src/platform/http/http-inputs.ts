import {
  DomainForbiddenError,
  DomainValidationError,
  isOrganizationScope,
  type TrustedScope,
} from '@vercentlabs/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const IF_MATCH_HEADER = 'if-match';

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Every unsafe platform command requires a caller-supplied Idempotency-Key
 * (root governance rule 7) - there is no server-generated fallback, since
 * that would silently defeat retry-safety for a caller that forgot to send
 * one.
 */
export function requireIdempotencyKey(request: FastifyRequest): string {
  const value = singleHeader(request.headers[IDEMPOTENCY_KEY_HEADER]);
  if (!value || value.trim().length === 0) {
    throw new DomainValidationError('The Idempotency-Key header is required for this request.', [
      { field: 'Idempotency-Key', message: 'header is required' },
    ]);
  }
  return value;
}

/**
 * Optimistic-concurrency precondition: callers send the version they last
 * read via `If-Match`, either as a bare integer or a quoted ETag (`"3"`).
 * Missing/malformed values are a validation error, not treated as "any
 * version" - every mutating command must know exactly which version it is
 * updating.
 */
export function requireExpectedVersion(request: FastifyRequest): number {
  const value = singleHeader(request.headers[IF_MATCH_HEADER]);
  if (!value) {
    throw new DomainValidationError('The If-Match header is required for this request.', [
      { field: 'If-Match', message: 'header is required' },
    ]);
  }

  const unquoted = value.trim().replace(/^"(.*)"$/, '$1');
  if (!/^\d+$/.test(unquoted)) {
    throw new DomainValidationError('The If-Match header must be an integer version.', [
      { field: 'If-Match', message: 'must be an integer version' },
    ]);
  }
  return Number.parseInt(unquoted, 10);
}

function formatZodError(error: z.ZodError): { field?: string; message: string }[] {
  return error.issues.map((issue) => {
    const field = issue.path.join('.');
    return field ? { field, message: issue.message } : { message: issue.message };
  });
}

/** Validates+normalizes a request body against `schema`, throwing the shared `DomainValidationError` (not a raw Nest exception) so it flows through the standard error envelope. */
export function parseBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  body: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new DomainValidationError(
      'The request body failed validation.',
      formatZodError(result.error),
    );
  }
  return result.data;
}

/** Same as {@link parseBody} for query-string parameters. */
export function parseQuery<Schema extends z.ZodTypeAny>(
  schema: Schema,
  query: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new DomainValidationError(
      'The query parameters failed validation.',
      formatZodError(result.error),
    );
  }
  return result.data;
}

/**
 * Deletes `undefined`-valued keys rather than leaving them present. Needed
 * because `exactOptionalPropertyTypes` distinguishes "key absent" from "key
 * present with value `undefined`" - a parsed zod object with an omitted
 * optional field still types that field as `T | undefined` and may include
 * the key, which is not structurally assignable to a plain `field?: T`
 * domain input type.
 */
export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const result = {} as T;
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) {
      result[key] = value[key];
    }
  }
  return result;
}

/**
 * Defense-in-depth for nested resource routes: rejects a request whose URL
 * path organization does not match the trusted scope's own organizationId,
 * before any domain command runs. Domain commands authorize from the scope
 * alone and never read this path segment, so without this check a caller
 * could target `/organizations/<other>/companies` and have the request
 * silently apply to their own organization instead of failing.
 */
export function requireScopeMatchesPath(scope: TrustedScope, pathOrganizationId: string): void {
  if (!isOrganizationScope(scope) || scope.organizationId !== pathOrganizationId) {
    throw new DomainForbiddenError('This trusted scope is not authorized for this organization.');
  }
}
