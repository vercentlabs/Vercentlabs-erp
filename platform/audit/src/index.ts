/**
 * Platform module: audit
 * Shared-platform capabilities: SP014
 * Status: NOT_STARTED - see product/registers/shared-platform.yaml
 *
 * SP014 (the full audit-trail platform: query API, retention policy,
 * redaction rules) remains NOT_STARTED. This package currently provides
 * only the minimum reliable append-only write path that SP001-SP003's
 * mutations need (Prompt 002A): one function, called inside the caller's
 * own transaction, that inserts one audit_events row. There is no read/
 * query surface yet.
 */
export const PLATFORM_MODULE = 'audit' as const;
export const PLATFORM_MODULE_SP_IDS = ['SP014'] as const;

export * from './schema.js';
export * from './record-audit-event.js';
