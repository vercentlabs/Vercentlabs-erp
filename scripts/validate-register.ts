import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  registerSchema,
  EXPECTED_CAPABILITY_IDS,
} from '../product/registers/shared-platform.schema.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REGISTER_PATH = path.join(REPO_ROOT, 'product/registers/shared-platform.yaml');

export function validateRegister(rawYaml: string): string[] {
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = yaml.load(rawYaml);
  } catch (error) {
    return [`Failed to parse YAML: ${(error as Error).message}`];
  }

  const result = registerSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
    return errors;
  }

  const { capabilities } = result.data;

  const occurrences = new Map<string, number>();
  for (const capability of capabilities) {
    occurrences.set(capability.id, (occurrences.get(capability.id) ?? 0) + 1);
  }
  for (const [id, count] of occurrences) {
    if (count > 1) errors.push(`Duplicate id: "${id}" appears ${count} times`);
  }

  const actualIds = new Set(capabilities.map((capability) => capability.id));

  for (const expectedId of EXPECTED_CAPABILITY_IDS) {
    if (!actualIds.has(expectedId)) errors.push(`Missing required id: "${expectedId}"`);
  }
  for (const id of actualIds) {
    if (!EXPECTED_CAPABILITY_IDS.includes(id))
      errors.push(`Unexpected id not in SP001-SP036: "${id}"`);
  }

  for (const capability of capabilities) {
    for (const dependencyId of capability.dependencies) {
      if (!actualIds.has(dependencyId)) {
        errors.push(`"${capability.id}" depends on unknown id: "${dependencyId}"`);
      }
    }
  }

  for (const capability of capabilities) {
    if (
      capability.implementationStatus === 'IMPLEMENTED' &&
      capability.evidencePaths.length === 0
    ) {
      errors.push(`"${capability.id}" is marked IMPLEMENTED but has no evidencePaths`);
    }
  }

  return errors;
}

function main(): void {
  const raw = readFileSync(REGISTER_PATH, 'utf8');
  const errors = validateRegister(raw);

  if (errors.length > 0) {
    console.error(`[register:validate] FAILED with ${errors.length} error(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const capabilityCount = (yaml.load(raw) as { capabilities: unknown[] }).capabilities.length;
  console.log(
    `[register:validate] OK - ${capabilityCount} capabilities validated against shared-platform.schema.ts`,
  );
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main();
}
