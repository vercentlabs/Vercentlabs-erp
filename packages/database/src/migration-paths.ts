import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

/** Repository root, resolved from this file's location (src -> database -> packages -> root). */
export const REPO_ROOT = path.resolve(currentDir, '../../..');

export const PLATFORM_MIGRATIONS_DIR = path.join(REPO_ROOT, 'database/migrations/platform');
export const TENANT_MIGRATIONS_DIR = path.join(REPO_ROOT, 'database/migrations/tenant');
