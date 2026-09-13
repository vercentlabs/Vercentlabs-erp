import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CORRELATION_HEADER, isValidCorrelationId } from '@vercentlabs/contracts';
import { runWithCorrelationContext } from '@vercentlabs/observability';

/**
 * Reuses a valid client-supplied `x-correlation-id`, otherwise mints one, and
 * binds it to an AsyncLocalStorage context so every log line for this request
 * carries it without threading it through every function signature.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const headerValue = req.headers[CORRELATION_HEADER];
    const incoming = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const correlationId = incoming && isValidCorrelationId(incoming) ? incoming : randomUUID();

    res.setHeader(CORRELATION_HEADER, correlationId);
    runWithCorrelationContext({ correlationId }, () => next());
  }
}
