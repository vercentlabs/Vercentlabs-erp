import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { validateRegister } from '../../scripts/validate-register.js';
import {
  EXPECTED_CAPABILITY_IDS,
  registerSchema,
} from '../../product/registers/shared-platform.schema.js';
import { REPO_ROOT } from './lib/workspace-packages.js';

const REGISTER_PATH = path.join(REPO_ROOT, 'product/registers/shared-platform.yaml');
const rawRegister = readFileSync(REGISTER_PATH, 'utf8');

describe('shared-platform register integrity', () => {
  it('validates with zero errors', () => {
    expect(validateRegister(rawRegister)).toEqual([]);
  });

  it('contains exactly the 36 expected SP ids, each exactly once', () => {
    const parsed = registerSchema.parse(yaml.load(rawRegister));
    const ids = parsed.capabilities.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...EXPECTED_CAPABILITY_IDS].sort());
  });

  it('every IMPLEMENTED capability has at least one evidence path', () => {
    const parsed = registerSchema.parse(yaml.load(rawRegister));
    for (const capability of parsed.capabilities) {
      if (capability.implementationStatus === 'IMPLEMENTED') {
        expect(capability.evidencePaths.length).toBeGreaterThan(0);
      }
    }
  });

  it('SP001-SP036 all remain NOT_STARTED after this foundation prompt', () => {
    const parsed = registerSchema.parse(yaml.load(rawRegister));
    expect(
      parsed.capabilities.every((capability) => capability.implementationStatus === 'NOT_STARTED'),
    ).toBe(true);
  });
});

describe('validateRegister detects real defects (not just a rubber stamp)', () => {
  const validCapability = {
    id: 'SP001',
    title: 'Organization and tenant lifecycle',
    priority: 'P0',
    specificationStatus: 'SPECIFICATION_READY',
    implementationStatus: 'NOT_STARTED',
    productStatus: 'NOT_READY',
    dependencies: [],
    evidencePaths: ['product/evidence/SP001-example.md'],
  };

  function toYaml(capabilities: unknown[]): string {
    return yaml.dump({ version: 1, capabilities });
  }

  it('fails on a duplicate id', () => {
    const errors = validateRegister(toYaml([validCapability, validCapability]));
    expect(errors.some((error) => error.includes('Duplicate id'))).toBe(true);
  });

  it('fails when a required id is missing', () => {
    const errors = validateRegister(toYaml([validCapability]));
    expect(errors.some((error) => error.includes('Missing required id'))).toBe(true);
  });

  it('fails on an unexpected id outside SP001-SP036', () => {
    const capabilities = EXPECTED_CAPABILITY_IDS.map((id) => ({ ...validCapability, id }));
    capabilities.push({ ...validCapability, id: 'SP999' });
    const errors = validateRegister(toYaml(capabilities));
    expect(errors.some((error) => error.includes('Unexpected id'))).toBe(true);
  });

  it('fails on an invalid status value', () => {
    const errors = validateRegister(toYaml([{ ...validCapability, implementationStatus: 'DONE' }]));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails on a missing title', () => {
    const { title: _title, ...withoutTitle } = validCapability;
    const errors = validateRegister(toYaml([withoutTitle]));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails on a missing evidence field', () => {
    const errors = validateRegister(toYaml([{ ...validCapability, evidencePaths: [] }]));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails on a dependency referencing an unknown id', () => {
    const errors = validateRegister(toYaml([{ ...validCapability, dependencies: ['SP999'] }]));
    expect(errors.some((error) => error.includes('unknown id'))).toBe(true);
  });
});
