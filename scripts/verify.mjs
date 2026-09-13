import { execSync } from 'node:child_process';

/**
 * Runs every step even after a failure, so a single `pnpm verify` invocation
 * produces a complete pass/fail report instead of stopping at the first red
 * step. Exits non-zero if anything failed. See root governance rule 13: this
 * script must never be edited to skip or soften a failing step in order to
 * obtain a passing result.
 */
const steps = [
  {
    name: 'lockfile consistency (pnpm install --frozen-lockfile)',
    command: 'pnpm install --frozen-lockfile',
  },
  { name: 'formatting check', command: 'pnpm run format:check' },
  { name: 'lint', command: 'pnpm run lint' },
  { name: 'typecheck', command: 'pnpm run typecheck' },
  { name: 'unit tests', command: 'pnpm run test' },
  { name: 'architecture tests', command: 'pnpm run test:architecture' },
  { name: 'shared-platform register validation', command: 'pnpm run register:validate' },
  { name: 'build (web, api, worker, packages)', command: 'pnpm run build' },
];

const results = [];

for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  try {
    execSync(step.command, { stdio: 'inherit' });
    results.push({ ...step, status: 'PASS' });
  } catch {
    results.push({ ...step, status: 'FAIL' });
  }
}

const passCount = results.filter((r) => r.status === 'PASS').length;
const failCount = results.length - passCount;

process.stdout.write('\n=== pnpm verify summary ===\n');
for (const result of results) {
  process.stdout.write(`${result.status === 'PASS' ? '✓' : '✗'} ${result.name}\n`);
}
process.stdout.write(`\n${passCount}/${results.length} steps passed, ${failCount} failed.\n`);

if (failCount > 0) {
  process.exitCode = 1;
}
