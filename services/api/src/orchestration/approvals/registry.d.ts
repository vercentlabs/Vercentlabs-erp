export const APPROVAL_COMMAND_REGISTRY: { keys(): readonly string[]; get(key: string): unknown | null };
export const REGISTERED_APPROVAL_COMMAND_KEYS: readonly string[];
export function approvalHref(commandKey: string, payload: Record<string, unknown> | null | undefined): string | null;
