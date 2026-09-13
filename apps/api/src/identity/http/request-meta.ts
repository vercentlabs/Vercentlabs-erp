import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { CORRELATION_HEADER } from '@vercentlabs/contracts';

/**
 * Conservative device/request metadata only - never claims fingerprint
 * uniqueness, never collects anything beyond what the connection/headers
 * already carry incidentally (root governance rule 14's spirit: no
 * invented telemetry, only what real operational/security needs require).
 */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string;
  requestId: string;
}

export function extractRequestMeta(request: FastifyRequest): RequestMeta {
  const correlationHeader = request.headers[CORRELATION_HEADER];
  const correlationId =
    (Array.isArray(correlationHeader) ? correlationHeader[0] : correlationHeader) ?? randomUUID();
  const userAgentHeader = request.headers['user-agent'];
  return {
    ipAddress: request.ip ?? null,
    userAgent: (Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader) ?? null,
    correlationId,
    requestId: randomUUID(),
  };
}
