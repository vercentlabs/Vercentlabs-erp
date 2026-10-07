import { createUnitOfMeasure, listUnitsOfMeasure } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead, productWrite } from "@/features/items/server/item-http";

export async function GET(request: Request) {
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ units: await listUnitsOfMeasure(client, context) }));
}

// body: { code, name, category, decimalPlaces }
export async function POST(request: Request) {
  return productWrite(request, PRODUCT_PERMISSIONS.manageUomMaster, async (client, context, body) => ({ unit: await createUnitOfMeasure(client, context, body) }), 201);
}
