import {
  createProcurementLandedCost,
  createProcurementSubcontractOrder,
  createProcurementRecord,
  generateReorderPurchasingRequests,
  listProcurementPass1Operations,
  upsertSupplierLeadTime,
  upsertSupplierPurchasePrice,
} from "@vercentlabs/api";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { procurementSession, tenantTransaction } from "@/modules/procurement/server";
import { stockContext } from "@/modules/stock";

export async function GET(request: Request) {
  try {
    const { context } = await procurementSession();
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 100 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 250)
      throw new HttpError(400, "limit must be an integer between 1 and 250.");
    const rows = await tenantTransaction(context.organizationId, (client) =>
      listProcurementPass1Operations(client, context, { kind: url.searchParams.get("kind") || "landed-costs", limit }),
    );
    return ok({ rows });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session, context } = await procurementSession(true);
    const rawBody = await readJson(request);
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody))
      throw new HttpError(400, "Procurement operation body must be a JSON object.");
    const body = rawBody as Record<string, unknown>;
    const action = String(body.action || "");
    const rawInput = body.input;
    if (rawInput !== undefined && (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)))
      throw new HttpError(400, "Procurement operation input must be a JSON object.");
    const input = (rawInput || {}) as Record<string, unknown>;
    const record = await tenantTransaction(context.organizationId, async (client) => {
      let result: unknown;
      if (action === "create-landed-cost") result = await createProcurementLandedCost(client, context, input);
      else if (action === "upsert-supplier-price") result = await upsertSupplierPurchasePrice(client, context, input);
      else if (action === "upsert-lead-time") result = await upsertSupplierLeadTime(client, context, input);
      else if (action === "create-subcontract") result = await createProcurementSubcontractOrder(client, context, input);
      else if (action === "generate-reorders") result = await generateReorderPurchasingRequests(client, stockContext(session), context, input);
      else if (action === "create-sourcing-invitation") result = await createProcurementRecord(client, context, "sourcing-invitations", input);
      else if (action === "record-supplier-bid") result = await createProcurementRecord(client, context, "sourcing-bids", input);
      else if (action === "record-sourcing-evaluation") result = await createProcurementRecord(client, context, "sourcing-evaluations", input);
      else if (action === "record-supplier-scorecard") result = await createProcurementRecord(client, context, "supplier-scorecards", input);
      else if (action === "create-purchase-return") result = await createProcurementRecord(client, context, "returns", input);
      else throw new HttpError(400, "Unknown Procurement operation action.");
      const recordLike = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const generatedRows = Array.isArray(recordLike.rows) ? recordLike.rows : [];
      const firstGenerated = generatedRows[0] && typeof generatedRows[0] === "object" ? generatedRows[0] as Record<string, unknown> : {};
      const entityId = String(recordLike.id || firstGenerated.id || "") || null;
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `procurement.pass1.${action.replaceAll("-", "_")}`, entityType: "procurement_operation", entityId, metadata: { action, purchaseOrderId: input.purchaseOrderId || null, receiptId: input.receiptId || null, generatedCount: generatedRows.length || null }, request, client });
      return result;
    });
    return ok({ record }, 201);
  } catch (error) { return errorResponse(error); }
}
