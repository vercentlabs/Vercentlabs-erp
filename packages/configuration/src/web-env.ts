import { z } from 'zod';
import { loadEnvironment } from './load-environment.js';

export const webEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const webEnvDevDefaults: Record<string, string> = {
  NEXT_PUBLIC_API_BASE_URL: 'http://localhost:3001/api/v1',
};

export function loadWebEnv(source?: NodeJS.ProcessEnv): WebEnv {
  return loadEnvironment(webEnvSchema, { devDefaults: webEnvDevDefaults, source });
}
