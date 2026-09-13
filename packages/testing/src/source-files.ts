import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', 'coverage']);

/** Recursively lists source files under `rootDir`, skipping build/dependency output. */
export function listSourceFiles(rootDir: string, extensions: string[] = ['.ts', '.tsx']): string[] {
  const results: string[] = [];

  const walk = (dir: string): void => {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const fullPath = path.join(dir, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
      } else if (extensions.some((ext) => entry.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  };

  walk(rootDir);
  return results;
}
