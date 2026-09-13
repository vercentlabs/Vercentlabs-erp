import { HttpStatus } from '@nestjs/common';
import { RawResponseException } from '../common/exceptions/raw-response.exception.js';
import type { ReadinessResult } from './health.service.js';

export class ReadinessUnavailableException extends RawResponseException {
  constructor(result: ReadinessResult) {
    super(result, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
