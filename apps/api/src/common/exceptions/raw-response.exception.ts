import { HttpException } from '@nestjs/common';

/**
 * An HttpException whose response body must be sent to the client exactly
 * as constructed, bypassing the standard `ApiErrorEnvelope` wrapping that
 * {@link import('../filters/all-exceptions.filter.js').AllExceptionsFilter}
 * applies to everything else. For endpoints - like health/readiness - that
 * have their own documented, non-error response shape even on a non-2xx
 * status code.
 */
export abstract class RawResponseException extends HttpException {}
