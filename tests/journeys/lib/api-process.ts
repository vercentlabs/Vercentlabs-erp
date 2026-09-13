import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';

// Playwright transpiles this directory as CommonJS (no "type": "module" in
// scope), so __dirname is used rather than import.meta.url.
/** tests/journeys/lib -> tests/journeys -> tests -> repo root. */
export const REPO_ROOT = path.resolve(__dirname, '../../..');

export const API_PORT = 3001;
export const API_BASE_URL = `http://localhost:${API_PORT}/api/v1`;

export async function isApiLive(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health/live`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
}

/** Windows-only: this project's local verification environment is Windows. */
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

/** Stops whatever process (if any) is listening on `port` and waits for it to actually go away. */
export async function stopProcessOnPort(port: number): Promise<void> {
  const pid = findPidListeningOnPort(port);
  if (!pid) return;
  try {
    execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
  await waitUntil(async () => findPidListeningOnPort(port) === undefined, 15_000, 200);
}

/** Starts the real compiled apps/api against the local dev Postgres/Redis and waits until it answers. */
export function startApi(): ChildProcess {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'apps/api/dist/main.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      API_PORT: String(API_PORT),
      API_CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL:
        process.env['DATABASE_URL'] ??
        'postgres://vercentlabs:vercentlabs_dev_password@localhost:5442/vercentlabs_erp',
      REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  return child;
}

export async function ensureApiRunning(): Promise<void> {
  if (await isApiLive()) return;
  startApi();
  await waitUntil(isApiLive, 30_000, 300);
}
