#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const defaultAppRoot = path.resolve(path.dirname(scriptFile), "..");

/**
 * Remove stale dev-only Next type artifacts before a standalone TypeScript
 * check, unless a live `next dev` process owns `.next/dev`. Production-generated
 * `.next/types` are deliberately kept; the release gate later runs `next build`,
 * which regenerates and validates production route/types authoritatively.
 */
export function prepareLandingTypecheck(appRoot = defaultAppRoot) {
  const devRoot = path.join(appRoot, ".next", "dev");
  const devLock = path.join(devRoot, "lock");
  const devTypes = path.join(devRoot, "types");
  const incrementalCache = path.join(appRoot, "tsconfig.tsbuildinfo");

  const nextDevIsRunning = fs.existsSync(devLock);
  if (!nextDevIsRunning) {
    fs.rmSync(devTypes, { recursive: true, force: true });
  }
  fs.rmSync(incrementalCache, { force: true });

  return { devTypes, incrementalCache, skippedDevTypes: nextDevIsRunning };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  const result = prepareLandingTypecheck();
  const devTypesStatus = result.skippedDevTypes
    ? "kept live Next.js dev types"
    : "removed stale Next.js dev types";
  console.log(`Prepared landing typecheck: ${devTypesStatus} and removed TypeScript incremental cache.`);
}
