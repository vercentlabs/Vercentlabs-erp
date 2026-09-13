/**
 * Platform module: approvals
 * Shared-platform capabilities: SP012
 * Status: NOT_STARTED - see product/registers/shared-platform.yaml
 *
 * No implementation exists yet. This package exists so the module
 * boundary is enforced by architecture tests (platform packages cannot
 * depend on apps; modules interact only through public commands, queries
 * and events - root governance rule 8) from day one, before any business
 * logic lands here.
 */
export const PLATFORM_MODULE = 'approvals' as const;
export const PLATFORM_MODULE_SP_IDS = ['SP012'] as const;
