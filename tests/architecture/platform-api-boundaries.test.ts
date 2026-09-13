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

  it('TestTrustedScopeProvider is never imported from any non-test file in apps/api/src, including platform-auth.module.ts', () => {
    // Prompt 002A-H hardening: an earlier version of platform-auth.module.ts
    // conditionally imported and registered TestTrustedScopeProvider
    // whenever NODE_ENV !== 'production', which meant a plain local `dev`
    // run (or a misconfigured staging deployment, or simply forgetting to
    // set NODE_ENV) would silently accept the test-only header. The fix
    // removed that reference entirely - the ONLY files allowed to import
    // this class now are its own definition file and test files, which
    // activate it exclusively via an explicit
    // `Test.createTestingModule(...).overrideProvider(...)` call.
    const violations: string[] = [];
    for (const file of listSourceFiles(path.join(REPO_ROOT, 'apps/api/src'))) {
      if (file.endsWith('test-trusted-scope.provider.ts')) continue;
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

  it('platform-auth.module.ts always registers FailClosedTrustedScopeProvider as a static useClass, never a conditional expression', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'apps/api/src/platform/auth/platform-auth.module.ts'),
      'utf8',
    );
    expect(source).toContain('useClass: FailClosedTrustedScopeProvider');
    expect(source).not.toMatch(/process\.env(\.|\[)['"]?NODE_ENV/);
  });
});

describe('the platform-administration database connection is confined to organization control-plane code', () => {
  it('only OrganizationsController injects PLATFORM_ADMIN_DB', () => {
    const violations: string[] = [];
    for (const file of CONTROLLER_FILES) {
      const isOrganizationsController = file.endsWith('organizations.controller.ts');
      const content = readFileSync(file, 'utf8');
      const referencesAdminDb = content.includes('PLATFORM_ADMIN_DB');
      if (referencesAdminDb && !isOrganizationsController) {
        violations.push(`${path.relative(REPO_ROOT, file)} references PLATFORM_ADMIN_DB`);
      }
      if (isOrganizationsController && !referencesAdminDb) {
        violations.push(`${path.relative(REPO_ROOT, file)} does not use PLATFORM_ADMIN_DB`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the choice of PLATFORM_ADMIN_DB vs PLATFORM_DB is never derived from request data (no header/cookie/query lookup near the token)', () => {
    // Structural proxy for "never chosen by client-supplied data": the
    // token is injected via a plain constructor @Inject(...), a compile-time
    // decision, not read from `request.headers`/`request.cookies`/`request.query`/`request.body`
    // anywhere in the controller that uses it.
    const organizationsController = CONTROLLER_FILES.find((file) =>
      file.endsWith('organizations.controller.ts'),
    );
    expect(organizationsController).toBeDefined();
    const content = readFileSync(organizationsController as string, 'utf8');
    expect(content).toMatch(/@Inject\(PLATFORM_ADMIN_DB\)/);
    expect(content).not.toMatch(/request\.(headers|cookies|query|body)\s*\[.*(admin|platform)/i);
  });
});
