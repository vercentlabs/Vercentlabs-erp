/**
 * Platform module: identity
 * Shared-platform capabilities: SP004, SP005, SP006, SP007
 * Status: NOT_STARTED - see product/registers/shared-platform.yaml
 *
 * No implementation exists yet. This package exists so the module
 * boundary is enforced by architecture tests (platform packages cannot
 * depend on apps; modules interact only through public commands, queries
 * and events - root governance rule 8) from day one, before any business
 * logic lands here.
 */
export const PLATFORM_MODULE = 'identity' as const;
export const PLATFORM_MODULE_SP_IDS = ['SP004', 'SP005', 'SP006', 'SP007'] as const;
