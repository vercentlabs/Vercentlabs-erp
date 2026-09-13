import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../architecture/lib/workspace-packages.js';

const SUSPICIOUS_PATTERNS = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /sk-[a-zA-Z0-9]{20,}/, // OpenAI/Stripe-style secret key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM private key
  /[a-f0-9]{64}/i, // a bare 64-char hex string (typical raw secret/token)
];

describe('.env.example contains no real-looking secrets', () => {
  const contents = readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');

  it('matches no known secret-shaped pattern', () => {
    const violations = SUSPICIOUS_PATTERNS.filter((pattern) => pattern.test(contents));
    expect(violations).toEqual([]);
  });

  it('only uses the documented local development password placeholder', () => {
    const passwordLines = contents.split('\n').filter((line) => /PASSWORD=/.test(line));
    for (const line of passwordLines) {
      expect(line).toMatch(/dev/i);
    }
  });
});

describe('.env is excluded from version control', () => {
  it('.gitignore ignores .env but not .env.example', () => {
    const gitignore = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).not.toMatch(/^\.env\.example$/m);
  });
});
