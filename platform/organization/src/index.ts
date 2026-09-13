/**
 * Platform module: organization
 * Shared-platform capabilities: SP002, SP003
 * Status: NOT_STARTED (in the shared-platform register) - implementation
 * evidence for this prompt lives at
 * product/evidence/PROMPT-002A-SP001-SP003-DOMAIN.md. Final IMPLEMENTED/
 * PRODUCT_READY certification is deferred to Prompt 002D.
 *
 * Owns companies (SP002) and operating units - branches/sites (SP003):
 * their state machines, repositories, and the commands/queries a trusted
 * organization scope uses to manage them. Depends on platform/tenancy's
 * public organization read for parent-organization validation, never on
 * its private tables directly.
 */
export const PLATFORM_MODULE = 'organization' as const;
export const PLATFORM_MODULE_SP_IDS = ['SP002', 'SP003'] as const;

export * from './schema.js';
export * from './status.js';
export * from './mappers.js';
export * from './tx.js';
export * from './command-helpers.js';
export * from './organization-guard.js';
export * from './repository.js';

export * from './commands/company-commands.js';
export * from './commands/operating-unit-commands.js';

export * from './queries/company-queries.js';
export * from './queries/operating-unit-queries.js';
