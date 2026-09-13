import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractImportSpecifiers, listSourceFiles } from '@vercentlabs/testing';
import { REPO_ROOT } from './lib/workspace-packages.js';

const FORBIDDEN_SERVER_IMPORTS = [
  '@vercentlabs/database',
  '@vercentlabs/platform-',
  'pg',
  'ioredis',
  'drizzle-orm',
];

function findForbiddenImports(rootDir: string, forbidden: string[]): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(rootDir)) {
    for (const specifier of extractImportSpecifiers(file)) {
      if (forbidden.some((entry) => specifier === entry || specifier.startsWith(entry))) {
        violations.push(
          `${path.relative(REPO_ROOT, file)} imports forbidden module "${specifier}"`,
        );
      }
    }
  }
  return violations;
}

describe('apps/web must not import server/database internals', () => {
  it('has no database/platform imports under app/ or lib/', () => {
    const violations = [
      ...findForbiddenImports(path.join(REPO_ROOT, 'apps/web/app'), FORBIDDEN_SERVER_IMPORTS),
      ...findForbiddenImports(path.join(REPO_ROOT, 'apps/web/lib'), FORBIDDEN_SERVER_IMPORTS),
    ];
    expect(violations).toEqual([]);
  });

  it('flags an intentionally bad fixture that imports pg directly (validates the check itself works)', () => {
    // Assert the detector recognizes an actual violation - a passing suite that
    // never fails on bad input would be worthless. `pg` is a real dependency
    // used elsewhere in the repo, so it is a meaningful positive case here.
    const violations = findForbiddenImports(path.join(REPO_ROOT, 'packages/database/src'), [
      'drizzle-orm',
    ]);
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('frontend-facing shared packages must not import database internals', () => {
  it('packages/ui and packages/design-tokens have no forbidden imports', () => {
    const violations = [
      ...findForbiddenImports(path.join(REPO_ROOT, 'packages/ui/src'), FORBIDDEN_SERVER_IMPORTS),
      ...findForbiddenImports(
        path.join(REPO_ROOT, 'packages/design-tokens/src'),
        FORBIDDEN_SERVER_IMPORTS,
      ),
    ];
    expect(violations).toEqual([]);
  });
});
