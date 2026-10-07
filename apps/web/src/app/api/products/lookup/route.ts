import { findItemByIdentifier } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead } from "@/features/items/server/item-http";

// ?code= — the item a scanned or typed SKU / barcode belongs to, or null.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ match: await findItemByIdentifier(client, context, code) }));
}
