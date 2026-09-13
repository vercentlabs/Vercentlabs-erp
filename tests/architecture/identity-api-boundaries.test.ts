import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractImportSpecifiers, listSourceFiles } from '@vercentlabs/testing';
import { REPO_ROOT } from './lib/workspace-packages.js';

const IDENTITY_API_ROOT = path.join(REPO_ROOT, 'apps/api/src/identity');
const PLATFORM_API_ROOT = path.join(REPO_ROOT, 'apps/api/src/platform');
const IDENTITY_CONTROLLER_FILES = listSourceFiles(IDENTITY_API_ROOT).filter((file) =>
  file.endsWith('.controller.ts'),
);
const PLATFORM_CONTROLLER_FILES = listSourceFiles(PLATFORM_API_ROOT).filter((file) =>
  file.endsWith('.controller.ts'),
);

/**
 * SP004-SP007's `AuthenticatedIdentity`/`SessionAuthGuard` and SP001-SP003's
 * `TrustedScope`/`TrustedScopeGuard` are two deliberately separate
 * authentication/authorization primitives (see
 * docs/architecture/identity-model.md and
 * product/evidence/PROMPT-002B-SP004-SP007-IDENTITY-AUTH.md). This suite
 * proves the boundary structurally, on both sides, so a future change
 * cannot silently blur it without failing a test.
 */
describe('identity API controllers stay thin HTTP adapters', () => {
  it('exist (this suite is only meaningful once real controllers are wired up)', () => {
    expect(IDENTITY_CONTROLLER_FILES.length).toBeGreaterThan(0);
  });

  it('no identity controller imports drizzle-orm or pg directly - only IDENTITY_*_DB plus command functions', () => {
    const forbidden = ['drizzle-orm', 'pg'];
    const allowed = ['drizzle-orm/node-postgres'];
    const violations: string[] = [];
    for (const file of IDENTITY_CONTROLLER_FILES) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (allowed.includes(specifier)) continue;
        if (forbidden.some((entry) => specifier === entry || specifier.startsWith(`${entry}/`))) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports "${specifier}" directly`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('no identity controller imports a platform-identity schema/repository module directly', () => {
    const violations: string[] = [];
    for (const file of IDENTITY_CONTROLLER_FILES) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (specifier.includes('/schema/') || specifier.includes('/repository/')) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports "${specifier}" directly`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('SP004-SP007 identity auth and SP001-SP003 trusted-scope auth never cross-reference each other', () => {
  // Checked via actual IMPORT SPECIFIERS (module paths), not raw text search
  // over the whole file - both sides' own source comments correctly
  // *describe* the separation from the other primitive by name (e.g. "never
  // touches TrustedScope"), which a plain substring-over-file-content check
  // would misreport as a violation.
  const FORBIDDEN_IN_IDENTITY = [
    'trusted-scope',
    'platform-admin-database.service',
    'platform-database.service',
    'platform-auth.module',
  ];
  const FORBIDDEN_IN_PLATFORM = [
    'identity-pipeline-database.service',
    'identity-runtime-database.service',
    'identity-auth.module',
    'session-auth.guard',
    'current-identity.decorator',
    '@vercentlabs/contracts/identity',
  ];

  it('no identity/* file (controllers, guards, database wiring) imports from the SP001-SP003 trusted-scope/platform-admin modules', () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(IDENTITY_API_ROOT)) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (FORBIDDEN_IN_IDENTITY.some((needle) => specifier.includes(needle))) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('no platform/* (SP001-SP003) file imports from the SP004-SP007 session/identity-auth modules', () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(PLATFORM_API_ROOT)) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (FORBIDDEN_IN_PLATFORM.some((needle) => specifier.includes(needle))) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('no SP001-SP003 platform controller is guarded by SessionAuthGuard/CsrfGuard, and no identity controller is guarded by TrustedScopeGuard', () => {
    const platformViolations: string[] = [];
    for (const file of PLATFORM_CONTROLLER_FILES) {
      const content = readFileSync(file, 'utf8');
      if (/@UseGuards\([^)]*(SessionAuthGuard|CsrfGuard)/.test(content)) {
        platformViolations.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(platformViolations).toEqual([]);

    const identityViolations: string[] = [];
    for (const file of IDENTITY_CONTROLLER_FILES) {
      const content = readFileSync(file, 'utf8');
      if (/@UseGuards\([^)]*TrustedScopeGuard/.test(content)) {
        identityViolations.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(identityViolations).toEqual([]);
  });
});

describe('email provider follows the same explicit-test-override hardening as TrustedScope', () => {
  it('EmailProviderModule always registers FailClosedEmailProvider as a static useClass, never a conditional expression', () => {
    const source = readFileSync(
      path.join(REPO_ROOT, 'apps/api/src/identity/email/email-provider.module.ts'),
      'utf8',
    );
    expect(source).toContain('useClass: FailClosedEmailProvider');
    expect(source).not.toMatch(/process\.env(\.|\[)['"]?NODE_ENV/);
  });

  it('InMemoryEmailProvider is never imported from any non-test apps/api source file', () => {
    // Matched only against an actual `import { ... InMemoryEmailProvider ... }
    // from '@vercentlabs/platform-identity'` statement, not prose - this
    // file's own doc comment on EmailProviderModule correctly *describes*
    // the test-only override pattern by name.
    const importLinePattern =
      /import\s+(?:type\s+)?\{[^}]*\bInMemoryEmailProvider\b[^}]*\}\s+from\s+['"]@vercentlabs\/platform-identity['"]/;
    const violations: string[] = [];
    for (const file of listSourceFiles(path.join(REPO_ROOT, 'apps/api/src'))) {
      const content = readFileSync(file, 'utf8');
      if (importLinePattern.test(content)) {
        violations.push(`${path.relative(REPO_ROOT, file)} imports InMemoryEmailProvider`);
      }
    }
    expect(violations).toEqual([]);
  });
});
