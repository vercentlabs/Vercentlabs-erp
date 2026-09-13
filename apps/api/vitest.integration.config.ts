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
  },
});
