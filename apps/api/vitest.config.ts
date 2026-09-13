import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.unit.test.ts'],
    globals: false,
    // health.unit.test.ts imports AppModule at module-load time, which now
    // always wires IdentityModule -> ConfigModule -> apiEnvProvider.
    // TOTP_ENCRYPTION_KEYS/CURRENT_KEY_VERSION deliberately have no dev
    // default (fail closed, no default key - see ADR-0011), so they must be
    // supplied explicitly here, the same way vitest.integration.config.ts
    // does for apps/api's integration tests. Test-only key material, never
    // a real one.
    env: {
      TOTP_ENCRYPTION_KEYS: JSON.stringify({ 1: Buffer.alloc(32, 2).toString('base64') }),
      TOTP_ENCRYPTION_CURRENT_KEY_VERSION: '1',
    },
  },
});
