#!/usr/bin/env node
// Frees the ports the local dev servers bind to before starting them.
//
// On Windows, `pnpm --parallel dev` spawns `next dev` as an intermediate
// process which spawns its own Next.js server as a grandchild. Stopping the
// parallel run (Ctrl+C, or pnpm killing siblings after one workspace fails)
// does not reliably reach that grandchild on Windows, so it survives and
// keeps its port bound — breaking the next `npm run dev` with EADDRINUSE.
// This script proactively kills whatever holds our dev ports first.
//
// Ownership check: a leaked process is only safe to kill if it actually
// belongs to *this* repo's dev servers. Killing "whatever is on the port"
// unconditionally can take down an unrelated application that happens to
// share 3000/3001/3200/3201 on a shared machine. Before killing anything we
// read the held process's command line and require it to both reference
// this repo's working tree and look like a Next.js/pnpm/turbo dev process.
// If we can't confirm that, we leave it alone and print a clear error
// instead — `next dev` will then fail with its own EADDRINUSE message,
// which is the correct outcome when the port is genuinely in use by
// something else.

import { execSync } from 'node:child_process';
import path from 'node:path';

// apps/landing (3000) and apps/web (3001), plus Next's internal dev-server
// manager ports (app port + 200) that trigger the "another dev server is
// already running" lock.
const PORTS = [3000, 3001, 3200, 3201];
const isWindows = process.platform === 'win32';
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

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

function commandLineFor(pid) {
  try {
    if (isWindows) {
      return execSync(
        `powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    }
    return execSync(`ps -o command= -p ${pid}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function belongsToThisRepo(commandLine) {
  if (!commandLine) return false;
  const normalized = commandLine.toLowerCase();
  const referencesRepo = normalized.includes(REPO_ROOT.toLowerCase());
  const looksLikeDevServer = /next[-\s]?(dev|server)|pnpm|turbo/i.test(normalized);
  if (referencesRepo && looksLikeDevServer) return true;
  // Windows frequently reports a command line relative to the process's own
  // cwd (e.g. ".next/standalone/apps/web/server.js") rather than an
  // absolute path, so the repo-path check above can miss a real dev/E2E
  // server. Fall back to a distinctive Next.js server signature — narrow
  // enough that an unrelated app on the same port is very unlikely to match.
  return /\.next[\\/]standalone[\\/].*server\.js|next[\\/]dist[\\/]bin[\\/]next|next-server/i.test(commandLine);
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

let skipped = 0;
for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    const commandLine = commandLineFor(pid);
    if (!belongsToThisRepo(commandLine)) {
      skipped += 1;
      console.error(
        `[free-ports] port ${port} is held by pid ${pid}, which does not look like this repo's dev server` +
          ` (command: ${commandLine || 'unknown, process may require elevated permissions to inspect'}).` +
          ` Refusing to kill it. If it is actually stale, stop it manually; otherwise "next dev" will report` +
          ` EADDRINUSE and you can investigate what is using the port.`,
      );
      continue;
    }
    killPid(pid);
  }
}

if (skipped > 0) {
  console.error(`[free-ports] left ${skipped} process(es) running because repo ownership could not be confirmed.`);
}
