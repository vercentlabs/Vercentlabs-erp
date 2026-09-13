import { z } from 'zod';
import { loadEnvironment } from './load-environment.js';

const dbUrlSchema = z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres connection string');

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_CORS_ORIGINS: z.string().min(1),
  CORRELATION_HEADER_NAME: z.string().min(1).default('x-correlation-id'),
  DATABASE_URL: dbUrlSchema,
  RUNTIME_DATABASE_URL: dbUrlSchema.optional(),
  PLATFORM_ADMIN_DATABASE_URL: dbUrlSchema.optional(),
  IDENTITY_PIPELINE_DATABASE_URL: dbUrlSchema.optional(),
  IDENTITY_RUNTIME_DATABASE_URL: dbUrlSchema.optional(),
  PLATFORM_DATABASE_SCHEMA: z.string().min(1).default('platform'),
  TENANT_DATABASE_SCHEMA: z.string().min(1).default('tenant'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis connection string'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // --- SP004-SP007 identity/auth (Prompt 002B) ---
  TOTP_ENCRYPTION_KEYS: z.string().min(1),
  TOTP_ENCRYPTION_CURRENT_KEY_VERSION: z.coerce.number().int().min(1),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_EXPECTED_ORIGIN: z.string().url(),
  /** Secure attribute is required outside this explicitly documented local-HTTP-development escape hatch. */
  SESSION_COOKIE_INSECURE_LOCAL_HTTP: z.coerce.boolean().default(false),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const apiEnvDevDefaults: Record<string, string> = {
  API_CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgres://vercentlabs:vercentlabs_dev_password@localhost:5432/vercentlabs_erp',
  REDIS_URL: 'redis://localhost:6379',
  WEBAUTHN_RP_ID: 'localhost',
  WEBAUTHN_EXPECTED_ORIGIN: 'http://localhost:3000',
  SESSION_COOKIE_INSECURE_LOCAL_HTTP: 'true',
};

export function loadApiEnv(source?: NodeJS.ProcessEnv): ApiEnv {
  return loadEnvironment(apiEnvSchema, { devDefaults: apiEnvDevDefaults, source });
}
