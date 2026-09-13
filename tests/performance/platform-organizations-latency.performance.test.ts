import { describe, expect, it } from 'vitest';

/**
 * Requires a running apps/api instance pointed at a Postgres database that
 * already has the erp_runtime role/RLS policies applied, plus a valid
 * test-only trusted-scope header (NODE_ENV must not be 'production' on that
 * instance). Not part of `pnpm verify` or CI - see README.md. This records
 * what was actually measured; it does not assert or imply any production
 * capacity or SLA.
 */
describe.skipIf(!process.env['API_BASE_URL'])('platform organizations list/get latency', () => {
  const baseUrl = process.env['API_BASE_URL'] as string;
  const scopeHeader = Buffer.from(
    JSON.stringify({
      kind: 'platform_operator',
      actor: { actorId: 'perf-operator', actorType: 'user' },
      roles: ['platform_operator'],
      correlationId: 'perf-corr',
      requestId: 'perf-req',
    }),
  ).toString('base64url');

  async function sample(path: string, count: number): Promise<number[]> {
    const durations: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const start = performance.now();
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { 'x-test-trusted-scope': scopeHeader },
      });
      durations.push(performance.now() - start);
      expect(response.status).toBe(200);
    }
    durations.sort((a, b) => a - b);
    return durations;
  }

  it('records p50/p95 for a paginated organizations list (indexed cursor scan)', async () => {
    const durations = await sample('/platform/organizations?limit=25', 20);
    const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? durations.at(-1) ?? 0;
    // eslint-disable-next-line no-console -- deliberate: this is the recorded evidence, not app logging
    console.log(
      `organizations list p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms (n=${durations.length})`,
    );
    expect(p95).toBeGreaterThan(0);
  });
});
