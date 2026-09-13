export const CORRELATION_HEADER = 'x-correlation-id';
export const CAUSATION_HEADER = 'x-causation-id';

export interface CorrelationMetadata {
  correlationId: string;
  causationId?: string;
}

const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;

export function isValidCorrelationId(value: string): boolean {
  return CORRELATION_ID_PATTERN.test(value);
}
