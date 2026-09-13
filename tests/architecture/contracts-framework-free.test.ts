import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractImportSpecifiers, listSourceFiles } from '@vercentlabs/testing';
import { readJsonFile, REPO_ROOT } from './lib/workspace-packages.js';

const FRAMEWORK_OR_DATABASE_SPECIFIERS = [
  'next',
  'react',
  'react-dom',
  '@nestjs/',
  'fastify',
  'express',
  'pg',
  'drizzle-orm',
  'ioredis',
];

function isForbidden(specifier: string): boolean {
  return FRAMEWORK_OR_DATABASE_SPECIFIERS.some(
    (entry) => specifier === entry || specifier.startsWith(entry),
  );
}

describe('packages/contracts stays framework- and database-free', () => {
  it('declares no framework or database dependency in package.json', () => {
    const packageJson = readJsonFile<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>('packages/contracts/package.json');

    const declaredDeps = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    });
    const violations = declaredDeps.filter(isForbidden);
    expect(violations).toEqual([]);
  });

  it('imports no framework or database module from source', () => {
    const violations: string[] = [];
    for (const file of listSourceFiles(path.join(REPO_ROOT, 'packages/contracts/src'))) {
      for (const specifier of extractImportSpecifiers(file)) {
        if (isForbidden(specifier)) {
          violations.push(`${path.relative(REPO_ROOT, file)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
