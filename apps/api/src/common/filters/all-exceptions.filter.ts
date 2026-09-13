import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  buildErrorEnvelope,
  CORRELATION_HEADER,
  type ErrorCode,
  type ErrorDetail,
} from '@vercentlabs/contracts';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  DomainValidationError,
  StaleVersionConflictError,
  StateTransitionConflictError,
} from '@vercentlabs/contracts';
import { IdempotencyInProgressError, IdempotencyPayloadConflictError } from '@vercentlabs/database';
import type { Logger } from '@vercentlabs/observability';
import { RawResponseException } from '../exceptions/raw-response.exception.js';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

function extractMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const message = (response as { message: unknown }).message;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  return exception.message;
}

/**
 * Maps the framework-free domain error vocabulary (packages/contracts,
 * packages/database) onto {status, code} - the seam that lets
 * platform/tenancy and platform/organization stay entirely ignorant of
 * HTTP. Returns undefined for anything that isn't one of these, so the
 * caller can fall back to generic HttpException/500 handling.
 */
function mapDomainError(
  exception: unknown,
): { status: number; code: ErrorCode; message: string } | undefined {
  if (exception instanceof DomainValidationError) {
    return { status: HttpStatus.BAD_REQUEST, code: 'VALIDATION_ERROR', message: exception.message };
  }
  if (exception instanceof DomainNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: exception.message };
  }
  if (exception instanceof DomainForbiddenError) {
    return { status: HttpStatus.FORBIDDEN, code: 'FORBIDDEN', message: exception.message };
  }
  if (exception instanceof StateTransitionConflictError) {
    return {
      status: HttpStatus.CONFLICT,
      code: 'STATE_TRANSITION_CONFLICT',
      message: exception.message,
    };
  }
  if (exception instanceof StaleVersionConflictError) {
    return {
      status: HttpStatus.CONFLICT,
      code: 'STALE_VERSION_CONFLICT',
      message: exception.message,
    };
  }
  if (
    exception instanceof IdempotencyPayloadConflictError ||
    exception instanceof IdempotencyInProgressError
  ) {
    return {
      status: HttpStatus.CONFLICT,
      code: 'IDEMPOTENCY_CONFLICT',
      message: exception.message,
    };
  }
  return undefined;
}

function domainErrorDetails(exception: unknown): ErrorDetail[] | undefined {
  if (exception instanceof DomainValidationError && exception.details) {
    return exception.details;
  }
  return undefined;
}

/**
 * Every non-2xx response from apps/api is shaped as an {@link import('@vercentlabs/contracts').ApiErrorEnvelope},
 * so clients can branch on `error.code` regardless of which handler threw.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (exception instanceof RawResponseException) {
      reply.status(exception.getStatus()).send(exception.getResponse());
      return;
    }

    const correlationHeader = request.headers[CORRELATION_HEADER];
    const correlationId = Array.isArray(correlationHeader)
      ? correlationHeader[0]
      : correlationHeader;

    const domainMapping = mapDomainError(exception);
    const status =
      domainMapping?.status ??
      (exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR);
    const code: ErrorCode = domainMapping?.code ?? STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR';
    const message =
      domainMapping?.message ??
      (exception instanceof HttpException
        ? extractMessage(exception)
        : 'An unexpected error occurred.');
    const details = domainErrorDetails(exception);

    if (status >= 500) {
      this.logger.error('unhandled exception', {
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        correlationId,
        path: request.url,
      });
    }

    reply.status(status).send(buildErrorEnvelope(code, message, { correlationId, details }));
  }
}
