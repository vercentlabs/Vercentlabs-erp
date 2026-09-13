import { describe, expect, it } from 'vitest';

/** Requires a running apps/api instance; see README.md. Not part of pnpm verify or CI. */
describe.skipIf(!process.env['API_BASE_URL'])('health endpoint latency smoke check', () => {
  it('p95 latency for GET /health/live over 20 requests stays under 200ms', async () => {
    const baseUrl = process.env['API_BASE_URL'] as string;
    const samples: number[] = [];

    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      const response = await fetch(`${baseUrl}/health/live`);
      samples.push(performance.now() - start);
      expect(response.status).toBe(200);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples.at(-1) ?? 0;
    expect(p95).toBeLessThan(200);
  });
});
