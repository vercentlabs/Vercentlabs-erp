import { mobileApi } from "@/api/client";
import { failMutation, pendingMutations, resolveMutation } from "./database";

let active: Promise<void> | null = null;
export function flushMutationQueue() {
  if (active) return active;
  active = (async () => {
    for (const item of await pendingMutations()) {
      try {
        const payload = JSON.parse(item.payload) as Record<string, unknown>;
        if (item.operation === "create") await mobileApi.createCrm(item.resource as "leads" | "opportunities" | "activities", payload, item.idempotencyKey);
        else if (item.operation === "complete" && item.recordId) await mobileApi.completeActivity(item.recordId, String(payload.outcome ?? ""), item.idempotencyKey);
        else if (item.operation === "stage" && item.recordId) await mobileApi.moveOpportunity(item.recordId, String(payload.stageId), String(payload.note ?? ""), item.idempotencyKey);
        await resolveMutation(item.id);
      } catch (error) {
        await failMutation(item.id, error instanceof Error ? error.message : "Sync failed");
        if ((error as { retryable?: boolean }).retryable !== false) break;
      }
    }
  })().finally(() => { active = null; });
  return active;
}
