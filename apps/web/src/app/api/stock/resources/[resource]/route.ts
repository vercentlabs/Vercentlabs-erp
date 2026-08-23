import { listStockResource } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/modules/stock/server";
import { errorResponse, ok } from "@/core/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const { resource } = await params;
    const { context } = await stockSession();
    const u = new URL(request.url);
    return ok({
      rows: await tenantTransaction(context.organizationId, (c) =>
        listStockResource(c, context, resource, {
          limit: u.searchParams.get("limit"),
          offset: u.searchParams.get("offset"),
        }),
      ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
