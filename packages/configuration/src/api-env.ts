import { z } from 'zod';
import { loadEnvironment } from './load-environment.js';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_CORS_ORIGINS: z.string().min(1),
  CORRELATION_HEADER_NAME: z.string().min(1).default('x-correlation-id'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres connection string'),
  RUNTIME_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres connection string')
    .optional(),
  PLATFORM_ADMIN_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres connection string')
    .optional(),
  PLATFORM_DATABASE_SCHEMA: z.string().min(1).default('platform'),
  TENANT_DATABASE_SCHEMA: z.string().min(1).default('tenant'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis connection string'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const apiEnvDevDefaults: Record<string, string> = {
  API_CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgres://vercentlabs:vercentlabs_dev_password@localhost:5432/vercentlabs_erp',
  REDIS_URL: 'redis://localhost:6379',
};

export function loadApiEnv(source?: NodeJS.ProcessEnv): ApiEnv {
  return loadEnvironment(apiEnvSchema, { devDefaults: apiEnvDevDefaults, source });
}
