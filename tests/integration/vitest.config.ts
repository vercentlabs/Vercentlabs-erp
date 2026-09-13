import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each file's beforeAll/afterAll drops and recreates the shared
    // platform/audit/integration schemas against one real database - running
    // files in parallel would let one file's teardown destroy another's
    // fixtures mid-run. Files must run one at a time for determinism.
    fileParallelism: false,
  },
});
