// Mirrors the copy steps in infrastructure/docker/Dockerfile.landing so the
// standalone build can be run and smoke-tested locally, not just inside Docker.
// Next.js's `output: "standalone"` traces only the files server.js needs to run —
// static assets (.next/static) and public/ must be copied in manually.
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standaloneAppDir = path.join(appDir, ".next", "standalone", "apps", "landing");

if (!existsSync(standaloneAppDir)) {
  console.error(
    `Standalone output not found at ${standaloneAppDir}. Run "pnpm build" first (requires next.config.mjs output: "standalone").`,
  );
  process.exit(1);
}

const staticSrc = path.join(appDir, ".next", "static");
const staticDest = path.join(standaloneAppDir, ".next", "static");
const publicSrc = path.join(appDir, "public");
const publicDest = path.join(standaloneAppDir, "public");

rmSync(staticDest, { recursive: true, force: true });
cpSync(staticSrc, staticDest, { recursive: true });

rmSync(publicDest, { recursive: true, force: true });
cpSync(publicSrc, publicDest, { recursive: true });

console.log(`Prepared standalone output at ${standaloneAppDir}`);
