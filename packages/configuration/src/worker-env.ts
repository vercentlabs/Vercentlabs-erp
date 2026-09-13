import { z } from 'zod';
import { loadEnvironment } from './load-environment.js';

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres connection string'),
  PLATFORM_DATABASE_SCHEMA: z.string().min(1).default('platform'),
  TENANT_DATABASE_SCHEMA: z.string().min(1).default('tenant'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis connection string'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const workerEnvDevDefaults: Record<string, string> = {
  DATABASE_URL: 'postgres://vercentlabs:vercentlabs_dev_password@localhost:5432/vercentlabs_erp',
  REDIS_URL: 'redis://localhost:6379',
};

export function loadWorkerEnv(source?: NodeJS.ProcessEnv): WorkerEnv {
  return loadEnvironment(workerEnvSchema, { devDefaults: workerEnvDevDefaults, source });
}
