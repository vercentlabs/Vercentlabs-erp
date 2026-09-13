export { toRuntimeConnectionString } from '@vercentlabs/database';

export function requireTestDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be set to run tests/integration.');
  }
  return url;
}
