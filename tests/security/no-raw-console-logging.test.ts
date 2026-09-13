import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listSourceFiles } from '@vercentlabs/testing';
import { REPO_ROOT } from '../architecture/lib/workspace-packages.js';

/**
 * `console.log`/`console.info` bypass the structured logger's redaction
 * pipeline (packages/observability). `console.error` is still allowed for
 * unrecoverable bootstrap failures (see apps/api/src/main.ts,
 * apps/worker/src/main.ts) since nothing else can log at that point.
 */
describe('apps/api and apps/worker never bypass the structured logger with console.log/info', () => {
  it('has no console.log or console.info calls outside eslint-disabled bootstrap lines', () => {
    const violations: string[] = [];
    for (const dir of ['apps/api/src', 'apps/worker/src']) {
      for (const file of listSourceFiles(path.join(REPO_ROOT, dir))) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (
            /console\.(log|info)\(/.test(line) &&
            !/eslint-disable/.test(lines[index - 1] ?? '')
          ) {
            violations.push(`${path.relative(REPO_ROOT, file)}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(violations).toEqual([]);
  });
});
