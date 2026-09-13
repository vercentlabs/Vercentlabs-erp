import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractImportSpecifiers, listSourceFiles } from '@vercentlabs/testing';
import { REPO_ROOT } from './lib/workspace-packages.js';

const PLATFORM_API_ROOT = path.join(REPO_ROOT, 'apps/api/src/platform');
const CONTROLLER_FILES = listSourceFiles(PLATFORM_API_ROOT).filter((file) =>
  file.endsWith('.controller.ts'),
);

// Direct DB/ORM query-building a controller must never import - every
// read/write goes through platform/tenancy's or platform/organization's
// exported commands and queries instead, keeping controllers HTTP-shaped
// adapters rather than a second place business rules could live. The
// `drizzle-orm/node-postgres` connection *type* (not the query-builder
// package itself) is allowed - controllers need it purely to type the
// injected `PLATFORM_DB` handle they pass through to command/query calls.
const FORBIDDEN_CONTROLLER_IMPORTS = ['drizzle-orm', 'pg'];
const ALLOWED_CONTROLLER_IMPORTS = ['drizzle-orm/node-postgres'];

describe('apps/api platform controllers stay thin HTTP adapters', () => {
  it('exist (this suite is only meaningful once real controllers are wired up)', () => {
    expect(CONTROLLER_FILES.length).toBeGreaterThan(0);
  });

  it('no controller imports drizzle-orm or pg directly - only PLATFORM_DB plus command/query functions', () => {
    const violations: string[] = [];
    for (const file of CONTROLLER_FILES) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (ALLOWED_CONTROLLER_IMPORTS.includes(specifier)) continue;
        if (
          FORBIDDEN_CONTROLLER_IMPORTS.some(
            (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
          )
        ) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports "${specifier}" directly`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('no controller imports a platform-tenancy or platform-organization schema/table module directly', () => {
    const violations: string[] = [];
    for (const file of CONTROLLER_FILES) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (specifier.includes('/schema.js') || specifier.includes('/repository.js')) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports "${specifier}" directly`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('flags an intentionally bad fixture that imports the drizzle-orm query builder (validates the check itself works)', () => {
    // platform/tenancy's own repository is a real, legitimate consumer of
    // the query-builder package - exactly the kind of import a controller
    // must never have. Reusing it here proves the detector actually catches
    // a real positive case rather than vacuously passing on an empty list.
    const violations: string[] = [];
    for (const specifier of extractImportSpecifiers(
      path.join(REPO_ROOT, 'platform/tenancy/src/repository.ts'),
    )) {
      if (FORBIDDEN_CONTROLLER_IMPORTS.includes(specifier)) violations.push(specifier);
    }
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('trusted-scope construction is confined to the platform auth boundary', () => {
  it('no file outside apps/api/src/platform/auth and test files constructs a literal TrustedScope (`kind: "platform_operator"` / `kind: "organization"`)', () => {
    const searchRoots = [
      path.join(REPO_ROOT, 'apps/api/src'),
      path.join(REPO_ROOT, 'apps/web/app'),
      path.join(REPO_ROOT, 'apps/web/lib'),
    ];
    const allowedDir = path.join(REPO_ROOT, 'apps/api/src/platform/auth');
    const literalPattern = /kind\s*:\s*['"](platform_operator|organization)['"]/;

    const violations: string[] = [];
    for (const root of searchRoots) {
      for (const file of listSourceFiles(root)) {
        if (file.startsWith(allowedDir)) continue;
        if (file.endsWith('.test.ts')) continue;
        const content = readFileSync(file, 'utf8');
        if (literalPattern.test(content)) {
          violations.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('TestTrustedScopeProvider is only referenced from the platform auth module and test files', () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(path.join(REPO_ROOT, 'apps/api/src'))) {
      if (
        file.endsWith('platform-auth.module.ts') ||
        file.endsWith('test-trusted-scope.provider.ts')
      )
        continue;
      for (const specifier of extractImportSpecifiers(file)) {
        if (specifier.includes('test-trusted-scope.provider')) {
          violations.push(
            `${path.relative(REPO_ROOT, file)} imports TestTrustedScopeProvider directly`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
