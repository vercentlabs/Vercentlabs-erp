// Briefly restarts the shared dev server (:3001) with
// BILLING_ENFORCEMENT_MODE=enforce set, runs billing-expired-subscription.spec.ts
// against it (the fixture org used by every OTHER spec is currently
// mid-trial, so this is safe for them too), then restarts the server
// again in its normal mode (no override) so the environment is left
// exactly as it was found for any further work this session.
import { spawn, execSync } from "node:child_process";

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() - start > timeoutMs) reject(new Error("server did not start in time"));
        else setTimeout(attempt, 1000);
      });
    };
    attempt();
  });
}

function stopWhateverIsListening() {
  try {
    const netstat = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`).toString();
    const pids = [...new Set(netstat.trim().split("\n").map((line) => line.trim().split(/\s+/).pop()))];
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`);
        console.log(`Stopped PID ${pid} (and its child processes)`);
      } catch {}
    }
  } catch {
    console.log("Nothing currently listening on the port.");
  }
}

async function startServer(env, label) {
  const server = spawn("npx", ["--yes", "pnpm@11.21.0", "dev"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    shell: true,
    stdio: "ignore",
    detached: true,
  });
  server.unref();
  await waitForServer(BASE_URL, 60_000);
  console.log(`${label} server ready on ${BASE_URL}`);
}

stopWhateverIsListening();
await new Promise((r) => setTimeout(r, 1500));

try {
  await startServer({ BILLING_ENFORCEMENT_MODE: "enforce" }, "Enforce-mode");
  try {
    execSync(`npx --yes pnpm@11.21.0 exec playwright test e2e/billing-expired-subscription.spec.ts --project=chromium`, {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    console.log("PASS");
  } catch {
    console.error("TEST FAILED");
    process.exitCode = 1;
  }
} catch (error) {
  console.error("FAIL:", error.message);
  process.exitCode = 1;
} finally {
  stopWhateverIsListening();
  await new Promise((r) => setTimeout(r, 1500));
  await startServer({}, "Normal-mode (restored)");
}
