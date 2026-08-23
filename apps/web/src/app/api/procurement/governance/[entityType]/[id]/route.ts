import {
  assessProcurementRecordReadiness,
  captureProcurementGovernanceSnapshot,
  getProcurementGovernanceTimeline,
  upsertProcurementExceptionCase,
} from "@vercentlabs/api";

import { procurementSession, tenantTransaction } from "@/modules/procurement/server";
import { assertSameOriginOrMobile } from "@/core/security";
import { errorResponse, fail, ok, readJson } from "@/core/http";

function inputObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function governanceError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    "message" in error &&
    typeof error.status === "number" &&
    typeof error.message === "string"
  )
    return fail(error.message, error.status);
  return errorResponse(error);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entityType: string; id: string }> },
) {
  try {
    const { context } = await procurementSession();
    const { entityType, id } = await params;
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => ({
        assessment: await assessProcurementRecordReadiness(
          client,
          context,
          entityType,
          id,
        ),
        timeline: await getProcurementGovernanceTimeline(
          client,
          context,
          entityType,
          id,
        ),
      }),
    );
    return ok(result);
  } catch (error) {
    return governanceError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ entityType: string; id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const { context } = await procurementSession(true);
    const { entityType, id } = await params;
    const input = inputObject(await readJson(request));
    const action = String(input.action || "snapshot");
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (action === "snapshot") {
          return {
            snapshot: await captureProcurementGovernanceSnapshot(
              client,
              context,
              entityType,
              id,
              String(input.capturedFor || "manual"),
            ),
          };
        }
        if (action === "exception") {
          return {
            exceptionCase: await upsertProcurementExceptionCase(
              client,
              context,
              entityType,
              id,
              inputObject(input.case),
            ),
          };
        }
        throw Object.assign(
          new Error("Unsupported Procurement record governance action."),
          { status: 400 },
        );
      },
    );
    return ok(result);
  } catch (error) {
    return governanceError(error);
  }
}
