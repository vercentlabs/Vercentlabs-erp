import {
  createAccountingAccount,
  createAccountingDimension,
  createAccountingDimensionValue,
  getAccountingSettings,
  updateAccountingSettings,
  upsertAccountMapping,
} from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function GET(request: Request) {
  try {
    const { context } = await accountingSession();
    const companyId = new URL(request.url).searchParams.get("companyId");
    const settings = await tenantTransaction(context.organizationId, (client) =>
      getAccountingSettings(client, context, companyId),
    );
    return ok({ settings });
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const input = await readJson(request) as Record<string, unknown>;
    const settings = await tenantTransaction(context.organizationId, async (client) => {
      const companyId = String(input.companyId || context.activeCompanyId || "");
      const before = await client.query(
        `SELECT * FROM tenant.accounting_settings WHERE organization_id=$1 AND company_id=$2`,
        [context.organizationId, companyId],
      );
      const updated = await updateAccountingSettings(client, context, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "accounting.settings.updated",
        entityType: "accounting_settings",
        entityId: companyId,
        beforeData: before.rows[0] || null,
        afterData: updated,
        request,
        client,
      });
      return updated;
    });
    return ok({ settings });
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { context } = await accountingSession(true);
    const input = await readJson(request) as Record<string, unknown>;
    if (typeof input.requiredForClasses === "string") input.requiredForClasses = input.requiredForClasses.split(",").map((value) => value.trim()).filter(Boolean);
    const action = String(input.action || "");
    const result = await tenantTransaction(context.organizationId, (client) => {
      switch (action) {
        case "create_account": return createAccountingAccount(client, context, input);
        case "map_account": return upsertAccountMapping(client, context, input);
        case "create_dimension": return createAccountingDimension(client, context, input);
        case "create_dimension_value": return createAccountingDimensionValue(client, context, input);
        default: return Promise.reject(new HttpError(400, "Unsupported accounting settings action."));
      }
    });
    return ok({ result }, 201);
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
