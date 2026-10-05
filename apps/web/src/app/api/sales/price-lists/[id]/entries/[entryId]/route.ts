import { expirePrice, removePrice, updatePrice } from "@vercentlabs/api";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { priceListWrite } from "@/features/sales/price-lists/server/price-list-http";

type Params = { params: Promise<{ id: string; entryId: string }> };

// body: { unitPrice?, validFrom?, validTo? } or { action: "expire", validTo? }
export async function PATCH(request: Request, { params }: Params) {
  const { id, entryId } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsManagePrices, async (client, context, body) => ({
    entry: body.action === "expire" ? await expirePrice(client, context, id, entryId, body) : await updatePrice(client, context, id, entryId, body),
  }));
}

// Takes the price off the list; it stays in the history.
export async function DELETE(request: Request, { params }: Params) {
  const { id, entryId } = await params;
  return priceListWrite(request, SALES_PERMISSIONS.priceListsManagePrices, async (client, context) => ({ entry: await removePrice(client, context, id, entryId) }));
}
