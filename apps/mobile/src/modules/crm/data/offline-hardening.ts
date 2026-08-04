import { mobileApi } from "@/core/api/client";
import {
  failMutation,
  markMutationSending,
  pendingMutations,
  resolveMutation,
} from "@/core/database/database";
type OfflineSyncResult = {
  ok: boolean;
  clientMutationId?: string;
  conflict?: unknown;
  error?: { message?: string; retryable?: boolean };
};
export async function flushCrmOfflineBatch() {
  const rows = await pendingMutations();
  if (!rows.length) return { applied: 0, conflicts: 0, failed: 0 };
  for (const row of rows) await markMutationSending(row.id);
  try {
    const response = await mobileApi.request<{ results: OfflineSyncResult[] }>(
      "/crm/offline-sync",
      {
        method: "POST",
        body: JSON.stringify({
          mutations: rows.map((row) => ({
            clientMutationId: row.id,
            deviceId: "native",
            operation: row.operation,
            resource: row.resource,
            recordId: row.recordId,
            idempotencyKey: row.idempotencyKey,
            payload: JSON.parse(row.payload),
          })),
        }),
      },
    );
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const result = response.results[i];
      if (!row) continue;
      if (result?.ok && !result.conflict) await resolveMutation(row.id);
      else
        await failMutation(
          row.id,
          result?.error?.message || "Offline sync conflict",
          { retryable: result?.error?.retryable !== false },
        );
    }
    return {
      applied: response.results.filter(
        (result) => result.ok && !result.conflict,
      ).length,
      conflicts: response.results.filter((result) => result.conflict).length,
      failed: response.results.filter((result) => !result.ok).length,
    };
  } catch (error) {
    for (const row of rows)
      await failMutation(
        row.id,
        error instanceof Error ? error.message : "Offline batch failed",
        { retryable: true },
      );
    throw error;
  }
}
