import { mobileApi } from "@/core/api/client";
import {
  failMutation,
  markMutationSending,
  pendingMutations,
  resolveMutation,
} from "@/core/database/database";

let active: Promise<void> | null = null;

function errorMetadata(error: unknown) {
  const value = error as { retryable?: boolean; status?: number; statusCode?: number };
  return {
    retryable: value?.retryable !== false,
    httpStatus: value?.status ?? value?.statusCode,
  };
}

export function flushMutationQueue() {
  if (active) return active;
  active = (async () => {
    for (const item of await pendingMutations()) {
      try {
        await markMutationSending(item.id);
        const payload = JSON.parse(item.payload) as Record<string, unknown>;
        if (item.operation === "create") {
          await mobileApi.createCrm(
            item.resource as "leads" | "opportunities" | "activities",
            payload,
            item.idempotencyKey,
          );
        } else if (item.operation === "create-call") {
          await mobileApi.createCall(payload, item.idempotencyKey);
        } else if (item.operation === "start-call" && item.recordId) {
          await mobileApi.startCall(
            item.recordId,
            {
              expectedUpdatedAt: typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
              expectedStatus: typeof payload.expectedStatus === "string" ? payload.expectedStatus : undefined,
            },
            item.idempotencyKey,
          );
        } else if (item.operation === "cancel-call" && item.recordId) {
          await mobileApi.cancelCall(
            item.recordId,
            {
              expectedUpdatedAt: typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
              expectedStatus: typeof payload.expectedStatus === "string" ? payload.expectedStatus : undefined,
            },
            item.idempotencyKey,
          );
        } else if (item.operation === "complete-call" && item.recordId) {
          await mobileApi.completeCall(
            item.recordId,
            {
              outcomeCode: String(payload.outcomeCode || ""),
              outcome: typeof payload.outcome === "string" ? payload.outcome : undefined,
              expectedUpdatedAt: typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
              expectedStatus: typeof payload.expectedStatus === "string" ? payload.expectedStatus : undefined,
            },
            item.idempotencyKey,
          );
        } else if (item.operation === "create-meeting") {
          await mobileApi.createMeeting(payload, item.idempotencyKey);
        } else if (item.operation === "start-meeting" && item.recordId) {
          await mobileApi.startMeeting(
            item.recordId,
            {
              expectedUpdatedAt: typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
              expectedStatus: typeof payload.expectedStatus === "string" ? payload.expectedStatus : undefined,
            },
            item.idempotencyKey,
          );
        } else if (item.operation === "cancel-meeting" && item.recordId) {
          await mobileApi.cancelMeeting(
            item.recordId,
            {
              expectedUpdatedAt: typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
              expectedStatus: typeof payload.expectedStatus === "string" ? payload.expectedStatus : undefined,
            },
            item.idempotencyKey,
          );
        } else if (item.operation === "complete-meeting" && item.recordId) {
          const outcomeCode = String(payload.outcomeCode || "");
          if (outcomeCode !== "held" && outcomeCode !== "no_show") {
            const invalid = new Error("Offline Meeting outcome is invalid.") as Error & { retryable?: boolean };
            invalid.retryable = false;
            throw invalid;
          }
          await mobileApi.completeMeeting(
            item.recordId,
            {
              outcomeCode,
              outcome: typeof payload.outcome === "string" ? payload.outcome : undefined,
              expectedUpdatedAt: typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
              expectedStatus: typeof payload.expectedStatus === "string" ? payload.expectedStatus : undefined,
            },
            item.idempotencyKey,
          );
        } else if (item.operation === "complete" && item.recordId) {
          await mobileApi.completeActivity(
            item.recordId,
            String(payload.outcome ?? ""),
            item.idempotencyKey,
            {
              expectedUpdatedAt:
                typeof payload.expectedUpdatedAt === "string"
                  ? payload.expectedUpdatedAt
                  : undefined,
              expectedStatus:
                typeof payload.expectedStatus === "string"
                  ? payload.expectedStatus
                  : undefined,
            },
          );
        } else if (item.operation === "stage" && item.recordId) {
          await mobileApi.moveOpportunity(
            item.recordId,
            String(payload.stageId),
            String(payload.note ?? ""),
            item.idempotencyKey,
            {
              expectedUpdatedAt:
                typeof payload.expectedUpdatedAt === "string"
                  ? payload.expectedUpdatedAt
                  : undefined,
              expectedStageId:
                typeof payload.expectedStageId === "string"
                  ? payload.expectedStageId
                  : undefined,
            },
          );
        } else {
          const unsupported = new Error(
            `Unsupported offline mutation ${item.operation} for ${item.resource}.`,
          ) as Error & { retryable?: boolean };
          unsupported.retryable = false;
          throw unsupported;
        }
        await resolveMutation(item.id);
      } catch (error) {
        const metadata = errorMetadata(error);
        await failMutation(
          item.id,
          error instanceof Error ? error.message : "Sync failed",
          metadata,
        );
        if (metadata.retryable) break;
      }
    }
  })().finally(() => {
    active = null;
  });
  return active;
}
