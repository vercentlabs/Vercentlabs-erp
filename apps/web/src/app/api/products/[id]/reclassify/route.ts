import { previewReclassification, reclassifyItem } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead, productWrite, type ProductRouteParams } from "@/features/items/server/item-http";

// ?categoryId= — the new category's defaults that differ from the item's own settings. Nothing changes.
export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  const categoryId = new URL(request.url).searchParams.get("categoryId") ?? "";
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ preview: await previewReclassification(client, context, id, categoryId) }));
}

// body: { categoryId, adoptDefaults (false | true | [fields]), reason?, expectedVersion? } — a classification change only.
export async function POST(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.reclassify, (client, context, body) => reclassifyItem(client, context, id, body));
}
