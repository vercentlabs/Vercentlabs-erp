import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractImportSpecifiers } from '../src/import-graph.js';
import { listSourceFiles } from '../src/source-files.js';

const testDir = fileURLToPath(new URL('.', import.meta.url));

describe('extractImportSpecifiers', () => {
  it('finds both node builtin and workspace package specifiers', () => {
    const specifiers = extractImportSpecifiers(path.join(testDir, 'fixtures/sample-module.ts'));
    expect(specifiers).toContain('node:fs');
    expect(specifiers).toContain('@vercentlabs/observability');
  });
});

describe('listSourceFiles', () => {
  it('lists the fixture file and excludes non-matching extensions', () => {
    const files = listSourceFiles(path.join(testDir, 'fixtures'));
    expect(files.some((file) => file.endsWith('sample-module.ts'))).toBe(true);
  });
});
