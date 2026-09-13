import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** tests/architecture/lib -> tests/architecture -> tests -> repo root. */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

export interface WorkspacePackage {
  name: string;
  dir: string;
  packageJson: {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}

function subDirectories(rootRelative: string): string[] {
  const dir = path.join(REPO_ROOT, rootRelative);
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .map((entry) => path.join(dir, entry))
    .filter((full) => {
      try {
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    });
}

export function loadWorkspacePackages(): WorkspacePackage[] {
  const dirs = [
    ...subDirectories('apps'),
    ...subDirectories('packages'),
    ...subDirectories('platform'),
  ];
  const packages: WorkspacePackage[] = [];

  for (const dir of dirs) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const packageJson = JSON.parse(
        readFileSync(pkgPath, 'utf8'),
      ) as WorkspacePackage['packageJson'];
      packages.push({ name: packageJson.name ?? path.basename(dir), dir, packageJson });
    } catch {
      // not a package directory - skip
    }
  }

  return packages;
}

export function readJsonFile<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')) as T;
}
