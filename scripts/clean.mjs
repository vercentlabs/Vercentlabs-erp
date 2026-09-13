import { readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Removes only generated build/cache output - never source files, never
 * node_modules (use `pnpm install` semantics for that), never .env or
 * database volumes. Safe to run before a from-scratch rebuild.
 */
const REMOVE_DIR_NAMES = new Set(['dist', '.next', '.turbo']);
const REMOVE_FILE_SUFFIXES = ['.tsbuildinfo'];
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);

let removedDirs = 0;
let removedFiles = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      if (REMOVE_DIR_NAMES.has(entry)) {
        rmSync(fullPath, { recursive: true, force: true });
        removedDirs += 1;
        console.log(`[clean] removed ${path.relative(REPO_ROOT, fullPath)}/`);
        continue;
      }
      walk(fullPath);
    } else if (REMOVE_FILE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) {
      unlinkSync(fullPath);
      removedFiles += 1;
      console.log(`[clean] removed ${path.relative(REPO_ROOT, fullPath)}`);
    }
  }
}

walk(REPO_ROOT);
console.log(`[clean] done - removed ${removedDirs} directories and ${removedFiles} files`);
