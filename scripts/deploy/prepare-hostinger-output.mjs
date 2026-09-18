import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const landingDir = path.join(repoRoot, "apps", "landing");
const standaloneDir = path.join(landingDir, ".next", "standalone");
const standaloneServer = path.join(standaloneDir, "apps", "landing", "server.js");
const outputDir = path.join(repoRoot, "dist");

if (!existsSync(standaloneServer)) {
  throw new Error(`Landing standalone server was not generated at ${standaloneServer}`);
}

rmSync(outputDir, { recursive: true, force: true });
cpSync(standaloneDir, outputDir, { recursive: true });
// Next.js's standalone output deliberately excludes .next/static and
// public/ (they live outside the traced dependency graph it bundles) --
// its own docs require copying both manually. apps/landing's own "build"
// script already does this (scripts/prepare-standalone.mjs runs right
// after `next build`, so by the time this script's cpSync above runs,
// standaloneDir already has both) -- these two extra copies are
// deliberately redundant, not the fix for a live bug: they make this
// script correct on its own if it's ever invoked after a bare `next
// build` (skipping prepare-standalone.mjs), rather than silently
// depending on an upstream script having already run first.
cpSync(path.join(landingDir, ".next", "static"), path.join(outputDir, "apps", "landing", ".next", "static"), { recursive: true });
cpSync(path.join(landingDir, "public"), path.join(outputDir, "apps", "landing", "public"), { recursive: true });
writeFileSync(
  path.join(outputDir, "server.js"),
  '// Hostinger runtime entry point.\nrequire("./apps/landing/server.js");\n',
  "utf8",
);

console.log(`Prepared Hostinger runtime output at ${outputDir}`);
