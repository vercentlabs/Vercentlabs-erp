import {
  captureReleaseReadinessSnapshot,
  getReleaseGovernanceDashboard,
  recordReleaseCheckRun,
  upsertReleaseIncidentCase,
} from "@vercentlabs/api";

import {
  releaseGovernanceSession,
  tenantTransaction,
} from "@/core/release-server";
import { assertSameOriginOrMobile } from "@/core/security";
import { errorResponse, fail, ok, readJson } from "@/core/http";

function inputObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function releaseError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    "message" in error &&
    typeof error.status === "number" &&
    typeof error.message === "string"
  ) {
    return fail(error.message, error.status);
  }
  return errorResponse(error);
}

export async function GET() {
  try {
    const { context } = await releaseGovernanceSession();
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        getReleaseGovernanceDashboard(client, context),
      ),
    );
  } catch (error) {
    return releaseError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const { context } = await releaseGovernanceSession(true);
    const input = inputObject(await readJson(request));
    const action = String(input.action || "");
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (action === "record-check") {
          return {
            check: await recordReleaseCheckRun(
              client,
              context,
              inputObject(input.check),
            ),
          };
        }
        if (action === "capture-snapshot") {
          return {
            snapshot: await captureReleaseReadinessSnapshot(
              client,
              context,
              inputObject(input.snapshot),
            ),
          };
        }
        if (action === "upsert-incident") {
          return {
            incident: await upsertReleaseIncidentCase(
              client,
              context,
              inputObject(input.incident),
            ),
          };
        }
        throw Object.assign(
          new Error("Unsupported enterprise release governance action."),
          { status: 400 },
        );
      },
    );
    return ok(result);
  } catch (error) {
    return releaseError(error);
  }
}
