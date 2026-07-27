import { createAsset, listAssets } from "@vercentlabs/api";
import { accountingSession, tenantTransaction } from "@/lib/accounting-route";
import { rethrowAccountingError } from "@/lib/accounting";
import { assetSchema } from "@/lib/accounting-validation";
import { errorResponse, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";

export async function GET(request: Request) {
  try {
    const { context } = await accountingSession();
    const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
    const assets = await tenantTransaction(context.organizationId, (client) => listAssets(client, context, filters));
    return ok({ assets });
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session, context } = await accountingSession(true);
    const input = assetSchema.parse(await readJson(request));
    const asset = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createAsset(client, context, input);
      const id = String((created as { asset?: { id?: unknown } }).asset?.id || "");
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "accounting.asset.created", entityType: "fixed_asset", entityId: id, afterData: input, request, client });
      return created;
    });
    return ok({ asset, message: "Fixed asset created." }, 201);
  } catch (error) {
    try { rethrowAccountingError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
