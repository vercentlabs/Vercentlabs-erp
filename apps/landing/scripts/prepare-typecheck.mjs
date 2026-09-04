#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const defaultAppRoot = path.resolve(path.dirname(scriptFile), "..");

/**
 * Remove only ephemeral artifacts written by `next dev` before a standalone
 * TypeScript check. Production-generated `.next/types` are deliberately kept;
 * the release gate later runs `next build`, which regenerates and validates
 * production route/types authoritatively.
 */
export function prepareLandingTypecheck(appRoot = defaultAppRoot) {
  const devTypes = path.join(appRoot, ".next", "dev", "types");
  const incrementalCache = path.join(appRoot, "tsconfig.tsbuildinfo");

  fs.rmSync(devTypes, { recursive: true, force: true });
  fs.rmSync(incrementalCache, { force: true });

  return { devTypes, incrementalCache };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  prepareLandingTypecheck();
  console.log("Prepared landing typecheck: removed ephemeral Next.js dev types and TypeScript incremental cache.");
}
