#!/usr/bin/env node
// Frees the ports the local dev servers bind to before starting them.
//
// On Windows, `pnpm --parallel dev` spawns `next dev` as an intermediate
// process which spawns its own Next.js server as a grandchild. Stopping the
// parallel run (Ctrl+C, or pnpm killing siblings after one workspace fails)
// does not reliably reach that grandchild on Windows, so it survives and
// keeps its port bound — breaking the next `npm run dev` with EADDRINUSE.
// This script proactively kills whatever holds our dev ports first.

import { execSync } from 'node:child_process';

// apps/landing (3000) and apps/web (3001), plus Next's internal dev-server
// manager ports (app port + 200) that trigger the "another dev server is
// already running" lock.
const PORTS = [3000, 3001, 3200, 3201];
const isWindows = process.platform === 'win32';

function pidsOnPort(port) {
  try {
    const output = isWindows
      ? execSync(`netstat -ano -p tcp`, { encoding: 'utf8' })
      : execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' });

    if (!isWindows) {
      return output.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    }

    const pids = new Set();
    for (const line of output.split('\n')) {
      const match = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (match && Number(match[1]) === port) {
        pids.add(match[2]);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (isWindows) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
    console.log(`[free-ports] killed stale process ${pid}`);
  } catch {
    // Process may have exited already between lookup and kill — fine.
  }
}

for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    killPid(pid);
  }
}
