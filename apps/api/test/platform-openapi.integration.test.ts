import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

/**
 * Verifies OpenAPI generation against the REAL `tsc`-compiled dist build,
 * run as its own child process - not the vitest/esbuild-transformed source.
 * apps/api/test/health.unit.test.ts documents why: @nestjs/swagger's
 * parameter explorer needs `design:paramtypes` metadata that esbuild-based
 * test transforms do not reliably emit once a controller has decorated
 * method parameters (every platform controller does). Run via
 * `pnpm test:integration`; requires `pnpm --filter @vercentlabs/api build`
 * to have produced apps/api/dist/main.js, and PostgreSQL/Redis running.
 */
describe('platform OpenAPI contract (integration, real compiled build)', () => {
  let child: ChildProcess;

  beforeAll(async () => {
    if (await isLive()) {
      throw new Error(`Port ${PORT} is already in use - refusing to start a second instance.`);
    }
    child = spawn(process.execPath, [path.join(REPO_ROOT, 'apps/api/dist/main.js')], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'development', // never 'production': this test authenticates via the test-only trusted-scope header
        API_PORT: String(PORT),
        API_CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL:
          process.env['DATABASE_URL'] ??
          'postgres://vercentlabs:vercentlabs_dev_password@localhost:5442/vercentlabs_erp',
        REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitUntil(isLive, 30_000);
  }, 40_000);

  afterAll(async () => {
    const pid = findPidListeningOnPort(PORT);
    if (pid) {
      try {
        execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
      } catch {
        // already gone
      }
    }
    child?.kill();
  });

  it('exposes an OpenAPI 3.x document listing every platform organizations/companies/operating-units path', async () => {
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
  });

  it('fails closed on a protected route with no trusted-scope header, against the real compiled build', async () => {
    const response = await fetch(`${BASE_URL}/platform/organizations`);
    expect(response.status).toBe(401);
  });

  it('serves a real end-to-end request through the compiled build using the test trusted-scope header', async () => {
    const scope = {
      kind: 'platform_operator',
      actor: { actorId: 'openapi-test-operator', actorType: 'user' },
      roles: ['platform_operator'],
      correlationId: 'openapi-test-corr',
      requestId: 'openapi-test-req',
    };
    const header = Buffer.from(JSON.stringify(scope)).toString('base64url');
    const response = await fetch(`${BASE_URL}/platform/organizations?limit=1`, {
      headers: { 'x-test-trusted-scope': header },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });
});
