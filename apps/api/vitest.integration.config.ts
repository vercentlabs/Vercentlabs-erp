import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // platform-api.integration.test.ts drops/recreates the shared
    // platform/audit/integration schemas against one real test database in
    // its own beforeAll/afterAll - running files in parallel would let one
    // file's teardown destroy another's fixtures mid-run (see
    // tests/integration/vitest.config.ts for the same constraint).
    fileParallelism: false,
    // AppModule now always wires IdentityModule, so ANY integration test
    // that boots the app (even health.integration.test.ts, which imports
    // AppModule at module-load time, before any file's own beforeAll runs)
    // needs a fully valid ApiEnv. TOTP_ENCRYPTION_KEYS/CURRENT_KEY_VERSION
    // deliberately have no dev default (fail closed, no default key - see
    // ADR-0011) so they must be supplied explicitly here, the same way
    // DATABASE_URL/REDIS_URL are already assumed present in the shell
    // environment for this test run. This is test-only configuration, not
    // a real key, and is never read outside this test process.
    env: {
      TOTP_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 5).toString('base64') }),
      TOTP_ENCRYPTION_CURRENT_KEY_VERSION: '1',
    },
  },
});
