/**
 * Platform module: outbox
 * Shared-platform capabilities: SP015
 * Status: NOT_STARTED - see product/registers/shared-platform.yaml
 *
 * SP015 (the full transactional-outbox-and-delivery platform: dispatcher,
 * retries, dead letters) remains NOT_STARTED. This package currently
 * provides only the minimum reliable write path that SP001-SP003's
 * mutations need (Prompt 002A): one function, called inside the caller's
 * own transaction, that inserts one outbox_events row with delivery_state
 * PENDING. Nothing reads or delivers these rows yet.
 */
export const PLATFORM_MODULE = 'outbox' as const;
export const PLATFORM_MODULE_SP_IDS = ['SP015'] as const;

export * from './schema.js';
export * from './record-outbox-event.js';
