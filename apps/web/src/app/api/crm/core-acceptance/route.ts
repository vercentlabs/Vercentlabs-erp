import {
  captureCrmCoreAcceptanceSnapshot,
  getCrmCoreAcceptanceDashboard,
  recordCrmCoreAcceptanceRun,
} from "@vercentlabs/api";

import {
  crmCoreAcceptanceSession,
  tenantTransaction,
} from "@/lib/crm-core-acceptance-route";
import { errorResponse, fail, ok, readJson } from "@/lib/http";
import { assertSameOriginOrMobile } from "@/lib/security";

function inputObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function acceptanceError(error: unknown) {
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
    const { context } = await crmCoreAcceptanceSession();
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        getCrmCoreAcceptanceDashboard(client, context),
      ),
    );
  } catch (error) {
    return acceptanceError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const { context } = await crmCoreAcceptanceSession(true);
    const input = inputObject(await readJson(request));
    const action = String(input.action || "");
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (action === "record-check") {
          return {
            check: await recordCrmCoreAcceptanceRun(
              client,
              context,
              inputObject(input.check),
            ),
          };
        }
        if (action === "capture-snapshot") {
          return {
            snapshot: await captureCrmCoreAcceptanceSnapshot(
              client,
              context,
              inputObject(input.snapshot),
            ),
          };
        }
        throw Object.assign(
          new Error("Unsupported CRM core acceptance action."),
          {
            status: 400,
          },
        );
      },
    );
    return ok(result);
  } catch (error) {
    return acceptanceError(error);
  }
}
