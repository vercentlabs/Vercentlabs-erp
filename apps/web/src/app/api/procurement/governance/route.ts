import {
  bulkManageProcurementExceptions,
  deleteProcurementSavedView,
  getProcurementGovernanceDashboard,
  listProcurementSavedViews,
  saveProcurementView,
} from "@vercentlabs/api";

import { procurementSession, tenantTransaction } from "@/lib/procurement-route";
import { assertSameOriginOrMobile } from "@/lib/security";
import { errorResponse, fail, ok, readJson } from "@/lib/http";

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
  ) {
    return fail(error.message, error.status);
  }
  return errorResponse(error);
}

export async function GET() {
  try {
    const { context } = await procurementSession();
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => ({
        dashboard: await getProcurementGovernanceDashboard(client, context),
        savedViews: await listProcurementSavedViews(client, context),
      }),
    );
    return ok(result);
  } catch (error) {
    return governanceError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const { context } = await procurementSession(true);
    const input = inputObject(await readJson(request));
    const action = String(input.action || "");
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        if (action === "save-view") {
          return {
            savedView: await saveProcurementView(
              client,
              context,
              inputObject(input.view),
            ),
          };
        }
        if (action === "delete-view") {
          return {
            result: await deleteProcurementSavedView(
              client,
              context,
              String(input.viewId || ""),
            ),
          };
        }
        if (action === "bulk-exceptions") {
          return {
            result: await bulkManageProcurementExceptions(
              client,
              context,
              input,
            ),
          };
        }
        throw Object.assign(
          new Error("Unsupported Procurement governance action."),
          { status: 400 },
        );
      },
    );
    return ok(result);
  } catch (error) {
    return governanceError(error);
  }
}
