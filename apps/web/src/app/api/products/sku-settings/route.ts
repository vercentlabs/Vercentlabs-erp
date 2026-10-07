import { getSkuSettings, updateSkuSettings } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead, productWrite } from "@/features/items/server/item-http";

// How SKUs are given: manual, automatic or either, the default prefix, separator, number length and year.
export async function GET(request: Request) {
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ settings: await getSkuSettings(client, context) }));
}

// body: { mode, defaultPrefix, separator, padding, includeYear, useCategoryPrefix, allowSkuChanges, expectedVersion }
export async function PATCH(request: Request) {
  return productWrite(request, PRODUCT_PERMISSIONS.configureSkuNumbering, async (client, context, body) => ({ settings: await updateSkuSettings(client, context, body) }));
}
