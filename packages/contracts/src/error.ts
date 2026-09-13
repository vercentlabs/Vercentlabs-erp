import { z } from 'zod';

/**
 * Canonical error codes. Every non-2xx API response must use one of these so
 * clients can branch on `error.code` instead of parsing messages or HTTP
 * status alone.
 */
export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'STATE_TRANSITION_CONFLICT',
  'STALE_VERSION_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorCodeToHttpStatus: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STATE_TRANSITION_CONFLICT: 409,
  STALE_VERSION_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    correlationId?: string;
    details?: ErrorDetail[];
  };
}

export function buildErrorEnvelope(
  code: ErrorCode,
  message: string,
  options: { correlationId?: string | undefined; details?: ErrorDetail[] | undefined } = {},
): ApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
  };
}
