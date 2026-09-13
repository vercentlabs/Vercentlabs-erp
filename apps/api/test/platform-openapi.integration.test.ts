import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const PORT = 3011;
const BASE_URL = `http://localhost:${PORT}/api/v1`;

async function isLive(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health/live`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

/** Windows-only, matching tests/journeys/lib/api-process.ts. */
function findPidListeningOnPort(port: number): string | undefined {
  let output: string;
  try {
    output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  } catch {
    return undefined;
  }
  const line = output
    .split('\n')
    .find((entry) => entry.includes(`:${port} `) && entry.includes('LISTENING'));
  const pid = line?.trim().split(/\s+/).pop();
  return pid && /^\d+$/.test(pid) ? pid : undefined;
}

async function stopOnPort(port: number): Promise<void> {
  const pid = findPidListeningOnPort(port);
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
  await waitUntil(async () => findPidListeningOnPort(port) === undefined, 15_000).catch(() => {
    // best-effort cleanup between tests
  });
}

/** Starts the real compiled dist/main.js with a given (possibly absent) NODE_ENV and waits until it answers. */
function startApi(nodeEnv: string | undefined): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    API_PORT: String(PORT),
    API_CORS_ORIGINS: 'http://localhost:3000',
    DATABASE_URL:
      process.env['DATABASE_URL'] ??
      'postgres://vercentlabs:vercentlabs_dev_password@localhost:5442/vercentlabs_erp',
    REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  };
  if (nodeEnv === undefined) {
    delete env['NODE_ENV'];
  } else {
    env['NODE_ENV'] = nodeEnv;
  }
  return spawn(process.execPath, [path.join(REPO_ROOT, 'apps/api/dist/main.js')], {
    cwd: REPO_ROOT,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
}

const forgedScopeHeader = Buffer.from(
  JSON.stringify({
    kind: 'platform_operator',
    actor: { actorId: 'forged-operator', actorType: 'user' },
    roles: ['platform_operator'],
    correlationId: 'forged-corr',
    requestId: 'forged-req',
  }),
).toString('base64url');

/**
 * Verifies OpenAPI generation and the auth boundary against the REAL
 * `tsc`-compiled dist build, run as its own child process - not the
 * vitest/esbuild-transformed source. apps/api/test/health.unit.test.ts
 * documents why the OpenAPI check specifically needs this: @nestjs/swagger's
 * parameter explorer needs `design:paramtypes` metadata that esbuild-based
 * test transforms do not reliably emit once a controller has decorated
 * method parameters (every platform controller does). Requires
 * `pnpm --filter @vercentlabs/api build` to have produced
 * apps/api/dist/main.js, and PostgreSQL/Redis running.
 *
 * A NORMALLY STARTED process (this file's `startApi`, exactly what
 * `node dist/main.js` does in every real deployment) must never accept the
 * `x-test-trusted-scope` header, under any `NODE_ENV` - see
 * platform-auth.module.ts and product/evidence/PROMPT-002A-H-TENANT-BOUNDARY.md.
 * Only the explicit `Test.createTestingModule(...).overrideProvider(...)`
 * composition in platform-api.integration.test.ts may ever accept it.
 */
describe('platform OpenAPI contract and auth boundary (integration, real compiled build)', () => {
  let child: ChildProcess | undefined;

  afterEach(async () => {
    child?.kill();
    child = undefined;
    await stopOnPort(PORT);
  });

  it('exposes an OpenAPI 3.x document listing every platform organizations/companies/operating-units path', async () => {
    if (await isLive()) throw new Error(`Port ${PORT} is already in use.`);
    child = startApi('development');
    await waitUntil(isLive, 30_000);

    const response = await fetch(`${BASE_URL}/docs-json`);
    expect(response.status).toBe(200);
    const document = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toMatch(/^3\./);

    const platformPaths = Object.keys(document.paths).filter((p) => p.includes('/platform/'));
    expect(platformPaths).toContain('/api/v1/platform/organizations');
    expect(platformPaths).toContain('/api/v1/platform/organizations/{organizationId}');
    expect(platformPaths).toContain('/api/v1/platform/organizations/{organizationId}/companies');
    expect(platformPaths).toContain(
      '/api/v1/platform/organizations/{organizationId}/companies/{companyId}/operating-units',
    );
    expect(platformPaths.length).toBeGreaterThanOrEqual(19);
  }, 40_000);

  it.each([
    ['production', 'production'],
    ['development', 'development'],
    ['test (no explicit test-module override)', 'test'],
    ['missing NODE_ENV', undefined],
  ])(
    'a normal API startup under %s rejects a forged trusted-scope header (401), never opens or accepts it',
    async (_label, nodeEnv) => {
      if (await isLive()) throw new Error(`Port ${PORT} is already in use.`);
      child = startApi(nodeEnv);
      await waitUntil(isLive, 30_000);

      const noHeader = await fetch(`${BASE_URL}/platform/organizations`);
      expect(noHeader.status).toBe(401);

      const forged = await fetch(`${BASE_URL}/platform/organizations`, {
        headers: { 'x-test-trusted-scope': forgedScopeHeader },
      });
      expect(forged.status).toBe(401);
    },
    40_000,
  );
});
