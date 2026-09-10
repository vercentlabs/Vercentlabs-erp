// Mirrors apps/landing/scripts/prepare-standalone.mjs's copy steps for
// apps/web's own `output: "standalone"` build (see apps/web/next.config.*).
// Next.js's standalone output traces only the files server.js needs to run
// — static assets (.next/static) must be copied in manually before the
// standalone server can serve a real page (a missing .next/static causes
// every client asset request to 404, which is why `next start` prints
// "does not work with output: standalone" and the app never functions).
// apps/web has no top-level public/ directory today, so that copy step is
// skipped rather than failing.
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standaloneAppDir = path.join(appDir, ".next", "standalone", "apps", "web");

if (!existsSync(standaloneAppDir)) {
  console.error(
    `Standalone output not found at ${standaloneAppDir}. Run "pnpm exec next build" first (requires next.config output: "standalone").`,
  );
  process.exit(1);
}

const staticSrc = path.join(appDir, ".next", "static");
const staticDest = path.join(standaloneAppDir, ".next", "static");
rmSync(staticDest, { recursive: true, force: true });
cpSync(staticSrc, staticDest, { recursive: true });

const publicSrc = path.join(appDir, "public");
const publicDest = path.join(standaloneAppDir, "public");
if (existsSync(publicSrc)) {
  rmSync(publicDest, { recursive: true, force: true });
  cpSync(publicSrc, publicDest, { recursive: true });
}

console.log(`Prepared standalone output at ${standaloneAppDir}`);
