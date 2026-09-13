import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../architecture/lib/workspace-packages.js';

describe('apps/api CORS configuration', () => {
  const mainTs = readFileSync(path.join(REPO_ROOT, 'apps/api/src/main.ts'), 'utf8');

  it('does not use a wildcard origin', () => {
    expect(mainTs).not.toMatch(/origin:\s*['"]\*['"]/);
    expect(mainTs).not.toMatch(/origin:\s*true/);
  });

  it('derives allowed origins from environment configuration, not a hardcoded literal', () => {
    expect(mainTs).toMatch(/env\.API_CORS_ORIGINS/);
  });
});
