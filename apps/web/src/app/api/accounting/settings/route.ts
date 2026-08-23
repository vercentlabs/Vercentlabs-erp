import {
  createAccountingAccount,
  createAccountingDimension,
  createAccountingDimensionValue,
  getAccountingSettings,
  updateAccountingSettings,
  upsertAccountMapping,
} from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/modules/accounting/server";
import { rethrowAccountingError } from "@/modules/accounting";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

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
    const result = await tenantTransaction(context.organizationId, async (client) => {
      let created: unknown;
      switch (action) {
        case "create_account":
          created = await createAccountingAccount(client, context, input);
          break;
        case "map_account":
          created = await upsertAccountMapping(client, context, input);
          break;
        case "create_dimension":
          created = await createAccountingDimension(client, context, input);
          break;
        case "create_dimension_value":
          created = await createAccountingDimensionValue(client, context, input);
          break;
        default:
          throw new HttpError(400, "Unsupported accounting settings action.");
      }
      const entity = created && typeof created === "object"
        ? created as Record<string, unknown>
        : {};
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: `accounting.settings.${action}`,
        entityType: action,
        entityId: typeof entity.id === "string" ? entity.id : null,
        afterData: created,
        request,
        client,
      });
      return created;
    });
    return ok({ result }, 201);
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
