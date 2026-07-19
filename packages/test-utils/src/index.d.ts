export const TEST_TENANTS: Readonly<Record<"alpha" | "beta", Readonly<{ organizationId: string; companyId: string; userId: string }>>>;
export function createQueryRecorder(responses?: Array<{ rows: unknown[]; rowCount?: number }>): { calls: Array<{ text: string; values: unknown[] }>; query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number }> };
export function productionGuard(environment?: Record<string, string | undefined>): void;
