import { createLogger, type Logger, type LogLevel } from '@vercentlabs/observability';

export const LOGGER = Symbol('LOGGER');

export const loggerProvider = {
  provide: LOGGER,
  useFactory: (): Logger =>
    createLogger({
      serviceName: 'api',
      level: (process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'info',
      pretty: process.env['NODE_ENV'] !== 'production',
    }),
};
