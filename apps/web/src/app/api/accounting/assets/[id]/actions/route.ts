import { capitalizeAsset, changeAssetSuspension, disposeAsset, impairAsset, postAssetDepreciation, transferAsset } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { assetActionSchema } from "@/lib/accounting-validation";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { session, context } = await accountingSession(true);
    const { id } = await route.params;
    const input = assetActionSchema.parse(await readJson(request));
    const result = await tenantTransaction(context.organizationId, async (client) => {
      let value: unknown;
      if (input.action === "capitalize") value = await capitalizeAsset(client, context, id, input);
      else if (input.action === "post_depreciation") {
        if (!input.scheduleId) throw new HttpError(400, "Depreciation schedule is required.");
        value = await postAssetDepreciation(client, context, input.scheduleId);
      } else if (input.action === "dispose" || input.action === "writeoff") {
        value = await disposeAsset(client, context, id, { ...input, writeoff: input.action === "writeoff" });
      } else if (input.action === "transfer") {
        value = await transferAsset(client, context, id, input);
      } else if (input.action === "impair") {
        value = await impairAsset(client, context, id, input);
      } else if (input.action === "suspend" || input.action === "resume") {
        value = await changeAssetSuspension(client, context, id, { ...input, suspend: input.action === "suspend" });
      } else throw new HttpError(400, "Unsupported asset action.");
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `accounting.asset.${input.action}`, entityType: "fixed_asset", entityId: id, afterData: value, request, client });
      return value;
    });
    return ok({ result });
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
