import { describe, expect, it } from 'vitest';
import { EnvironmentValidationError } from '../src/load-environment.js';
import { loadApiEnv } from '../src/api-env.js';
import { loadWebEnv } from '../src/web-env.js';
import { loadWorkerEnv } from '../src/worker-env.js';

describe('loadApiEnv', () => {
  it('applies safe development defaults when NODE_ENV is development', () => {
    const env = loadApiEnv({ NODE_ENV: 'development' });
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.API_CORS_ORIGINS).toBe('http://localhost:3000');
  });

  it('fails fast in production when required configuration is missing', () => {
    expect(() => loadApiEnv({ NODE_ENV: 'production' })).toThrow(EnvironmentValidationError);
  });

  it('succeeds in production when all required configuration is supplied', () => {
    const env = loadApiEnv({
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'https://app.vercentlabs.example',
      DATABASE_URL: 'postgres://prod-host/db',
      REDIS_URL: 'redis://prod-host:6379',
    });
    expect(env.NODE_ENV).toBe('production');
  });

  it('rejects a malformed redis url even in development', () => {
    expect(() => loadApiEnv({ NODE_ENV: 'development', REDIS_URL: 'not-a-url' })).toThrow();
  });
});

describe('loadWebEnv', () => {
  it('defaults NEXT_PUBLIC_API_BASE_URL outside production', () => {
    const env = loadWebEnv({ NODE_ENV: 'test' });
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe('http://localhost:3001/api/v1');
  });

  it('fails fast in production without an explicit API base URL', () => {
    expect(() => loadWebEnv({ NODE_ENV: 'production' })).toThrow(EnvironmentValidationError);
  });
});

describe('loadWorkerEnv', () => {
  it('applies safe development defaults', () => {
    const env = loadWorkerEnv({ NODE_ENV: 'development' });
    expect(env.REDIS_URL).toContain('redis://');
  });

  it('fails fast in production when DATABASE_URL is missing', () => {
    expect(() =>
      loadWorkerEnv({ NODE_ENV: 'production', REDIS_URL: 'redis://prod-host:6379' }),
    ).toThrow(EnvironmentValidationError);
  });
});
