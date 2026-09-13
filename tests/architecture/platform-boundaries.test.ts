import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractImportSpecifiers, listSourceFiles } from '@vercentlabs/testing';
import { loadWorkspacePackages, REPO_ROOT } from './lib/workspace-packages.js';

const APPROVED_PLATFORM_MODULES = [
  'identity',
  'tenancy',
  'organization',
  'authorization',
  'audit',
  'approvals',
  'automation',
  'notifications',
  'files',
  'search',
  'reporting',
  'integrations',
  'outbox',
  'jobs',
  'feature-flags',
];

const APP_PACKAGE_NAMES = ['@vercentlabs/web', '@vercentlabs/api', '@vercentlabs/worker'];

describe('platform/ module boundary', () => {
  it('contains only the approved shared-platform modules', () => {
    const entries = readdirSync(path.join(REPO_ROOT, 'platform')).filter((entry) =>
      statSync(path.join(REPO_ROOT, 'platform', entry)).isDirectory(),
    );
    expect(entries.sort()).toEqual([...APPROVED_PLATFORM_MODULES].sort());
  });

  it('has no unauthorized top-level business-module tree', () => {
    for (const forbiddenName of ['modules', 'business', 'erp-modules', 'business-modules']) {
      expect(() => statSync(path.join(REPO_ROOT, forbiddenName))).toThrow();
    }
  });

  it('no platform package depends on an application', () => {
    const platformPackages = loadWorkspacePackages().filter((pkg) =>
      pkg.dir.includes(`${path.sep}platform${path.sep}`),
    );
    expect(platformPackages.length).toBe(APPROVED_PLATFORM_MODULES.length);

    const violations: string[] = [];
    for (const pkg of platformPackages) {
      const deps = { ...pkg.packageJson.dependencies, ...pkg.packageJson.devDependencies };
      for (const appName of APP_PACKAGE_NAMES) {
        if (deps[appName])
          violations.push(`${pkg.name} depends on application package "${appName}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('platform packages never deep-import a sibling platform module by relative path', () => {
    const platformPackages = loadWorkspacePackages().filter((pkg) =>
      pkg.dir.includes(`${path.sep}platform${path.sep}`),
    );
    const violations: string[] = [];

    for (const pkg of platformPackages) {
      for (const file of listSourceFiles(path.join(pkg.dir, 'src'))) {
        for (const specifier of extractImportSpecifiers(file)) {
          const reachesAnotherPlatformModule =
            specifier.startsWith('..') &&
            APPROVED_PLATFORM_MODULES.some((name) => specifier.includes(`/${name}/`));
          if (reachesAnotherPlatformModule) {
            violations.push(
              `${path.relative(REPO_ROOT, file)} deep-imports another platform module: "${specifier}"`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
