import { createProduct, listProducts } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productFiltersFromUrl, productRead, productWrite } from "@/features/sales/products/server/product-http";

export async function GET(request: Request) {
  return productRead(request, PRODUCT_PERMISSIONS.view, (client, context) => listProducts(client, context, productFiltersFromUrl(new URL(request.url))));
}

export async function POST(request: Request) {
  return productWrite(request, PRODUCT_PERMISSIONS.create, async (client, context, body) => ({ product: await createProduct(client, context, body) }), 201);
}
