import { pino, type Logger as PinoLogger } from 'pino';
import { getCorrelationContext } from './correlation-context.js';
import { PINO_REDACT_PATHS, redactSensitiveFields } from './redaction.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogBindings {
  [key: string]: unknown;
}

/**
 * The structured logger contract every app depends on. Concrete
 * implementations (pino today, anything else tomorrow) must satisfy this
 * shape so call sites never import pino directly.
 */
export interface Logger {
  trace(message: string, bindings?: LogBindings): void;
  debug(message: string, bindings?: LogBindings): void;
  info(message: string, bindings?: LogBindings): void;
  warn(message: string, bindings?: LogBindings): void;
  error(message: string, bindings?: LogBindings): void;
  fatal(message: string, bindings?: LogBindings): void;
  child(bindings: LogBindings): Logger;
}

export interface CreateLoggerOptions {
  serviceName: string;
  level?: LogLevel;
  /** Pretty-print for local development only; never enable in production. */
  pretty?: boolean;
}

class PinoBackedLogger implements Logger {
  constructor(private readonly pinoLogger: PinoLogger) {}

  private withContext(bindings?: LogBindings): LogBindings {
    const context = getCorrelationContext();
    const merged = { ...bindings, ...(context ? { correlationId: context.correlationId } : {}) };
    return redactSensitiveFields(merged);
  }

  trace(message: string, bindings?: LogBindings): void {
    this.pinoLogger.trace(this.withContext(bindings), message);
  }

  debug(message: string, bindings?: LogBindings): void {
    this.pinoLogger.debug(this.withContext(bindings), message);
  }

  info(message: string, bindings?: LogBindings): void {
    this.pinoLogger.info(this.withContext(bindings), message);
  }

  warn(message: string, bindings?: LogBindings): void {
    this.pinoLogger.warn(this.withContext(bindings), message);
  }

  error(message: string, bindings?: LogBindings): void {
    this.pinoLogger.error(this.withContext(bindings), message);
  }

  fatal(message: string, bindings?: LogBindings): void {
    this.pinoLogger.fatal(this.withContext(bindings), message);
  }

  child(bindings: LogBindings): Logger {
    return new PinoBackedLogger(this.pinoLogger.child(redactSensitiveFields(bindings)));
  }
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const pinoLogger = pino({
    name: options.serviceName,
    level: options.level ?? 'info',
    redact: { paths: PINO_REDACT_PATHS, censor: '[REDACTED]' },
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        }
      : {}),
  });
  return new PinoBackedLogger(pinoLogger);
}
