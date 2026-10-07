import { createItemCategory, listItemCategories } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { productRead, productWrite } from "@/features/items/server/item-http";

// The category tree in order. ?search=, ?status=active|inactive, ?parentId= (root for the top level), ?hasItems= / ?hasChildren= yes|no,
// ?profileId=; ?active=true leaves out inactive categories.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const param = (key: string) => url.searchParams.get(key) ?? "";
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({
    categories: await listItemCategories(client, context, {
      search: param("search"), includeInactive: param("active") !== "true", status: param("status"), parentId: param("parentId"),
      hasItems: param("hasItems"), hasChildren: param("hasChildren"), profileId: param("profileId"),
    }),
  }));
}

export async function POST(request: Request) {
  return productWrite(request, PRODUCT_PERMISSIONS.manageCategories, async (client, context, body) => ({ category: await createItemCategory(client, context, body) }), 201);
}
