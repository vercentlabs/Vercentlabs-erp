/**
 * Platform module: tenancy
 * Shared-platform capabilities: SP001
 * Status: NOT_STARTED (in the shared-platform register) - implementation
 * evidence for this prompt lives at
 * product/evidence/PROMPT-002A-SP001-SP003-DOMAIN.md. Final IMPLEMENTED/
 * PRODUCT_READY certification is deferred to Prompt 002D, once SP004-SP010
 * (authentication/authorization) exist to protect these commands for real.
 *
 * Owns organization identity and lifecycle (SP001): the state machine,
 * repository, and commands/queries a trusted platform-operator scope uses
 * to create, activate, suspend, recover, close and read organizations.
 */
export const PLATFORM_MODULE = 'tenancy' as const;
export const PLATFORM_MODULE_SP_IDS = ['SP001'] as const;

export * from './schema.js';
export * from './status.js';
export * from './mappers.js';
export * from './repository.js';
export * from './tx.js';
export * from './command-helpers.js';

export * from './commands/create-organization.js';
export * from './commands/update-organization-display-metadata.js';
export * from './commands/activate-organization.js';
export * from './commands/suspend-organization.js';
export * from './commands/recover-organization.js';
export * from './commands/close-organization.js';

export * from './queries/get-organization.js';
export * from './queries/list-organizations.js';
