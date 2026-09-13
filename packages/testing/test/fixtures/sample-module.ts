import { readFileSync } from 'node:fs';
import type { Logger } from '@vercentlabs/observability';

export function readAndLog(logger: Logger, filePath: string): string {
  const contents = readFileSync(filePath, 'utf8');
  logger.info('read file', { filePath });
  return contents;
}
