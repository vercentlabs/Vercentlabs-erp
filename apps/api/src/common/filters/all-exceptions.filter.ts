import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildErrorEnvelope, CORRELATION_HEADER, type ErrorCode } from '@vercentlabs/contracts';
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

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code: ErrorCode = STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR';
    const message =
      exception instanceof HttpException
        ? extractMessage(exception)
        : 'An unexpected error occurred.';

    if (status >= 500) {
      this.logger.error('unhandled exception', {
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        correlationId,
        path: request.url,
      });
    }

    reply.status(status).send(buildErrorEnvelope(code, message, { correlationId }));
  }
}
